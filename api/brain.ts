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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");
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
