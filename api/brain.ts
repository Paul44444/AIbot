import type { VercelRequest, VercelResponse } from "@vercel/node";

// Writes a character's reply with a stronger text model than the realtime one,
// for characters who need substance (reasoning, concrete ideas, web search).
// Streams newline-separated JSON events, so speech can start after the first sentence:
//   {"type":"delta","text":"…"}  {"type":"call","name":"…","callId":"…","arguments":"…"}  {"type":"done"}  {"type":"error"}
// task "react": a small fast model decides at once whether to answer right away (then streams that
// reply as deltas) or to think (then names a sound to make meanwhile), first sending
//   {"type":"decision","mode":"reply"|"think","sound":"…"}
// task "remember": condenses the memory journal into notes.

const MODELS = new Set(["gpt-6.1-sol"]);
const MAX_INSTRUCTIONS = 30_000;
const MAX_INPUT_ITEMS = 120;

type Body = {
    model?: string;
    instructions?: string;
    input?: unknown[];
    /** Function tools the character may call (e.g. draw_diagram); web search is always available. */
    tools?: { type: string; name?: string }[];
};

const MEMORY_MODEL = "gpt-5.4-mini";
const MEMORY_PROMPT = `You keep the long-term memory of a group of three AI friends (Jenny the warm host, Jinx the smug trickster,
Smyth the calm scientist) who talk with one user. You get the current notes and a timestamped journal of what was said
since. Rewrite the notes so they include what matters from the journal. Write in English (quote titles and names as they
are), plain text, these sections, each a few short bullet points:

About the user: lasting facts, situation, likes and dislikes, plans, people in their life.
Open threads: things to follow up on, with the date and which friend it belongs to (whoever recommended, promised or
was told it), e.g. "Jinx recommended the film The Thing (Sat 18 Oct); Jinx should ask whether they watched it",
"user has a job interview on Tue 21 Oct; told Jenny they are nervous". Drop threads that were resolved.
Recent conversations: one line per conversation (lines without a long pause belong to the same one), newest first,
with date and time of day, who the user talked with, what it was about and the user's mood. Keep the last ten.
Patterns: only when the journal and the recent conversations show it on at least three different days
(e.g. "low and bored on Saturday evenings: 4, 11 and 18 Oct"); otherwise leave this section out.

Keep everything that is still relevant from the old notes, merge duplicates, drop trivia and small talk, and stay under
600 words. Never invent anything.`;

const REACT_MODEL = "gpt-5.4-mini";
const REACT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    // Mode and sound first: they are acted on before the reply is complete.
    required: ["mode", "sound", "reply"],
    properties: { mode: { type: "string", enum: ["reply", "think"] }, sound: { type: "string" }, reply: { type: "string" } },
};

function reactPrompt(sounds: { id: string; vibe: string }[], recent: string[]) {
    return `

[Quick reaction]
Decide how to answer the user's last message, right now.
- "reply": a good answer is short and needs no research or careful thought (greetings, small talk, a quick reaction,
  banter, a joke, a simple question you can answer off the top of your head). Write the whole reply, in character, in "reply".
- "think": the message deserves real thought, specifics, advice, research or detail (a decision, a problem, a plan,
  something to explain properly). Leave "reply" empty; another part of you writes the answer.
"sound": what you do out loud the moment the user stops talking, matching the mood (amused, annoyed, curious,
surprised, thoughtful, sympathetic). For "think" pick one that fits, or "none" when a plain pause is more natural;
for "reply" use "none". Vary it: never one of the recently used, and "none" is often right.
Sounds: ${sounds.map((sound) => `${sound.id} (${sound.vibe})`).join(", ")}.
Recently used: ${recent.length ? recent.join(", ") : "nothing yet"}.`;
}

/** The decoded start of a JSON string value beginning at `from`, and whether its closing quote has arrived. */
function jsonStringPrefix(json: string, from: number) {
    let text = "";
    for (let index = from; index < json.length; index++) {
        const char = json[index];
        if (char === "\"") return { text, complete: true };
        if (char !== "\\") {
            text += char;
            continue;
        }
        const next = json[index + 1];
        if (next === undefined) break;
        if (next === "u") {
            const hex = json.slice(index + 2, index + 6);
            if (hex.length < 4) break;
            text += String.fromCharCode(parseInt(hex, 16));
            index += 5;
            continue;
        }
        text += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[next] ?? next;
        index += 1;
    }
    return { text, complete: false };
}

/** Streams a Responses API call, handing each text delta to `onText`; returns false if the call failed. */
async function streamModel(request: object, res: VercelResponse, onText: (delta: string) => void, onEvent?: (event: StreamEvent) => void) {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, store: false, stream: true }),
    });
    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        console.error("Model error", upstream.status, detail.slice(0, 500));
        res.status(502).send(`Model error ${upstream.status}`);
        return false;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event: StreamEvent;
            try {
                event = JSON.parse(line.slice(6));
            } catch {
                continue;
            }
            if (event.type === "response.output_text.delta" && event.delta) onText(event.delta);
            if (event.type === "response.failed" || event.type === "error") {
                console.error("Model stream error", line.slice(0, 500));
                send(res, { type: "error" });
            }
            onEvent?.(event);
        }
    }
    send(res, { type: "done" });
    res.end();
    return true;
}

type StreamEvent = { type?: string; delta?: string; item?: { type?: string; name?: string; call_id?: string; arguments?: string } };

function send(res: VercelResponse, event: object) {
    res.write(`${JSON.stringify(event)}\n`);
}

/** Answers at once or decides to think, see the header comment. */
async function react(body: Body & { sounds?: { id: string; vibe: string }[]; recent?: string[] }, res: VercelResponse) {
    const sounds = (body.sounds ?? []).filter((sound) => typeof sound?.id === "string" && typeof sound.vibe === "string").slice(0, 40);
    const recent = (body.recent ?? []).filter((id) => typeof id === "string").slice(-6);
    let json = "";
    let decided = false;
    let replied = 0;
    await streamModel({
        model: REACT_MODEL,
        instructions: `${body.instructions}${reactPrompt(sounds, recent)}`,
        input: body.input,
        reasoning: { effort: "none" },
        text: { format: { type: "json_schema", name: "reaction", strict: true, schema: REACT_SCHEMA } },
    }, res, (delta) => {
        json += delta;
        if (!decided) {
            const mode = json.match(/"mode"\s*:\s*"(reply|think)"/)?.[1];
            const sound = json.match(/"sound"\s*:\s*"([^"]*)"/)?.[1];
            if (!mode || sound === undefined) return;
            decided = true;
            send(res, { type: "decision", mode, sound });
        }
        const start = json.search(/"reply"\s*:\s*"/);
        if (start < 0) return;
        const { text } = jsonStringPrefix(json, json.indexOf("\"", json.indexOf(":", start)) + 1);
        if (text.length > replied) {
            send(res, { type: "delta", text: text.slice(replied) });
            replied = text.length;
        }
    });
}

/** Condenses the journal into the group's long-term notes (see src/utils/memory.ts). */
async function remember(body: { notes?: unknown; journal?: unknown; now?: unknown }, res: VercelResponse) {
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 8_000) : "";
    const journal = typeof body.journal === "string" ? body.journal.slice(-40_000) : "";
    if (!journal.trim()) return res.status(400).json({ error: "Nothing to remember" });
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: MEMORY_MODEL,
            instructions: MEMORY_PROMPT,
            input: `Now: ${typeof body.now === "string" ? body.now : "unknown"}\n\nCurrent notes:\n${notes || "(none yet)"}\n\nJournal:\n${journal}`,
            store: false,
        }),
    });
    const data = await response.json() as { output?: { content?: { type?: string; text?: string }[] }[]; error?: unknown };
    if (!response.ok) {
        console.error("Memory error", response.status, JSON.stringify(data.error).slice(0, 500));
        return res.status(502).json({ error: "Memory model failed" });
    }
    const text = (data.output ?? []).flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text).join("");
    return res.status(200).json({ notes: text.trim() });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");
    // Remembering shares this route: the Hobby plan allows only 12 functions.
    const task = (req.body as { task?: string } | undefined)?.task;
    if (task === "remember") return remember(req.body, res);
    const body = (req.body ?? {}) as Body;
    if (typeof body.instructions !== "string" || !Array.isArray(body.input)) {
        return res.status(400).send("Missing instructions/input");
    }
    if (body.instructions.length > MAX_INSTRUCTIONS || body.input.length > MAX_INPUT_ITEMS) {
        return res.status(413).send("Conversation too long");
    }
    if (task === "react") return react(body, res);
    const model = body.model ?? "";
    if (!MODELS.has(model)) return res.status(400).send("Unknown model");
    const functions = (body.tools ?? []).filter((tool) => tool?.type === "function");

    await streamModel({
        model,
        instructions: body.instructions,
        input: body.input,
        tools: [{ type: "web_search" }, ...functions],
        // The lowest effort this model takes; conversation needs speed more than deep deliberation.
        reasoning: { effort: "low" },
    }, res, (delta) => send(res, { type: "delta", text: delta }), (event) => {
        if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
            send(res, { type: "call", name: event.item.name, callId: event.item.call_id, arguments: event.item.arguments ?? "{}" });
        }
    });
}
