import type { VercelRequest, VercelResponse } from "@vercel/node";

// Plans a schematic diagram as structured data. The browser lays it out and
// draws it, so the model only has to get the content and structure right.

type Line = { speaker: string; text: string };
type DiagramRequest = { request?: string; depth?: "simple" | "rich"; lines?: Line[]; artist?: string };

// Rich overviews (e.g. literature maps) are worth the stronger, slower model.
const MODELS = { simple: "gpt-5.4-mini", rich: "gpt-5.5" };
const COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "red", "gray"];
const nullableString = { type: ["string", "null"] };

const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["title", "subtitle", "direction", "groups", "nodes", "edges", "takeaway"],
    properties: {
        title: { type: "string" },
        subtitle: nullableString,
        direction: { type: "string", enum: ["LR", "TB"] },
        groups: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label", "color"],
                properties: { id: { type: "string" }, label: { type: "string" }, color: { type: "string", enum: COLORS } },
            },
        },
        nodes: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label", "detail", "icon", "group", "emphasis"],
                properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    detail: nullableString,
                    icon: nullableString,
                    group: nullableString,
                    emphasis: { type: "string", enum: ["normal", "key", "note"] },
                },
            },
        },
        edges: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["from", "to", "label", "dashed"],
                properties: { from: { type: "string" }, to: { type: "string" }, label: nullableString, dashed: { type: "boolean" } },
            },
        },
        takeaway: nullableString,
    },
};

const GUIDE = `You design clear, insightful schematic diagrams, like a great slide in a talk.
Plan the diagram as data; it will be laid out and drawn automatically.

Good diagrams:
- Show structure, not prose, and stay readable at a glance: 5–10 nodes for simple questions, at most 16 for
  rich overviews. Rich means more insight per node (better details), not more nodes.
- Have one clear main flow. Use at most about 1.2 edges per node; never connect one node to everything.
  Notes and caveats link to the one or two nodes they concern, or stand alone.
- Node labels have at most 4 words. "detail" is optional, at most 12 words, and adds a key fact.
- "icon" is one fitting emoji, or null.
- Use groups (2–5) for clusters such as research strands, phases or categories; give each a distinct colour.
- Edges carry meaning: cause, leads to, builds on, contradicts, feeds into. Label them briefly (1–3 words) when it helps.
  Use dashed edges for weak, debated or indirect links.
- Mark the 1–3 most important nodes with emphasis "key"; use "note" for caveats or open questions.
- Choose "LR" for processes, timelines and cause chains; "TB" for hierarchies and overviews (the viewer may flip it to fit).
- "takeaway" is one sentence with the main insight.
- Write in the language of the conversation.
- Only name specific papers, authors or numbers you are confident are real. Otherwise describe the idea or
  research strand without inventing citations.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const body = (req.body ?? {}) as DiagramRequest;
    const request = String(body.request ?? "").slice(0, 1500);
    if (!request.trim()) return res.status(400).json({ error: "Missing request" });
    const lines = (body.lines ?? []).slice(-14).map((line) => `${String(line.speaker).slice(0, 40)}: ${String(line.text).slice(0, 700)}`);

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODELS[body.depth === "rich" ? "rich" : "simple"],
                reasoning_effort: "low",
                max_completion_tokens: 6000,
                response_format: { type: "json_schema", json_schema: { name: "diagram", strict: true, schema: SCHEMA } },
                messages: [
                    { role: "system", content: GUIDE },
                    {
                        role: "user",
                        content: `Recent conversation:\n${lines.join("\n") || "(none)"}\n\n${body.artist ?? "A friend"} wants to sketch: ${request}`,
                    },
                ],
            }),
        });
        const data = (await response.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; error?: unknown };
        if (!response.ok) {
            console.error("Diagram error:", data);
            return res.status(502).json({ error: "Diagram model failed" });
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content) return res.status(502).json({ error: data.choices?.[0]?.message?.refusal ?? "Empty diagram" });
        return res.status(200).json(JSON.parse(content));
    } catch (error) {
        console.error("Diagram failed:", error);
        return res.status(500).json({ error: "Diagram failed" });
    }
}
