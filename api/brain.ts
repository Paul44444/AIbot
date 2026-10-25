import type { VercelRequest, VercelResponse } from "@vercel/node";

// Writes a character's reply with a stronger text model than the realtime one,
// for characters who need substance (reasoning, concrete ideas, web search).
// Streams newline-separated JSON events, so speech can start after the first sentence:
//   {"type":"delta","text":"…"}  {"type":"call","name":"…","callId":"…","arguments":"…"}  {"type":"done"}  {"type":"error"}

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
    if ((req.body as { task?: string } | undefined)?.task === "remember") return remember(req.body, res);
    const body = (req.body ?? {}) as Body;
    const model = body.model ?? "";
    if (!MODELS.has(model) || typeof body.instructions !== "string" || !Array.isArray(body.input)) {
        return res.status(400).send("Unknown model or missing instructions/input");
    }
    if (body.instructions.length > MAX_INSTRUCTIONS || body.input.length > MAX_INPUT_ITEMS) {
        return res.status(413).send("Conversation too long");
    }
    const functions = (body.tools ?? []).filter((tool) => tool?.type === "function");

    const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            instructions: body.instructions,
            input: body.input,
            tools: [{ type: "web_search" }, ...functions],
            // The lowest effort this model takes; conversation needs speed more than deep deliberation.
            reasoning: { effort: "low" },
            store: false,
            stream: true,
        }),
    });
    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        console.error("Brain error", upstream.status, detail.slice(0, 500));
        return res.status(502).send(`Model error ${upstream.status}`);
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event: { type?: string; delta?: string; item?: { type?: string; name?: string; call_id?: string; arguments?: string } };
            try {
                event = JSON.parse(line.slice(6));
            } catch {
                continue;
            }
            if (event.type === "response.output_text.delta" && event.delta) send({ type: "delta", text: event.delta });
            if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
                send({ type: "call", name: event.item.name, callId: event.item.call_id, arguments: event.item.arguments ?? "{}" });
            }
            if (event.type === "response.failed" || event.type === "error") {
                console.error("Brain stream error", line.slice(0, 500));
                send({ type: "error" });
            }
        }
    }
    send({ type: "done" });
    res.end();
}
