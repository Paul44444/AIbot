import type { VercelRequest, VercelResponse } from "@vercel/node";

// After each reply, decides which other group members want to raise their hand
// and what short teaser they show. Most turns nobody should interject.

type Line = { speaker: string; text: string };
type Member = { id: string; name: string; summary: string };
type DirectorRequest = { lines?: Line[]; members?: Member[]; lastSpeakerId?: string };

const MAX_LINES = 12;
const MAX_CHARS = 600;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const body = (req.body ?? {}) as DirectorRequest;
    const members = (body.members ?? []).slice(0, 6);
    const lines = (body.lines ?? []).slice(-MAX_LINES).map((line) => ({
        speaker: String(line.speaker).slice(0, 40),
        text: String(line.text).slice(0, MAX_CHARS),
    }));
    const candidates = members.filter((member) => member.id !== body.lastSpeakerId);
    if (!lines.length || !candidates.length) return res.status(200).json({ hands: [] });

    const prompt = `You direct a lively but friendly group conversation between a user and AI friends.
Friends who could jump in now:
${candidates.map((m) => `- id "${m.id}": ${m.name}, ${m.summary}`).join("\n")}

Recent conversation (latest last):
${lines.map((l) => `${l.speaker}: ${l.text}`).join("\n")}

Decide who would naturally want to interject right after the latest line, like in a real group discussion:
disagreement, a different angle, a joke, a related idea. Be selective: in roughly half of the turns nobody raises a hand,
and never more than two. Only raise a hand when that friend's personality has something genuinely different to add.
For each hand, write a teaser of at most 8 words, spoken in that friend's personality and in the same language as the
conversation. It should make the user curious rather than give the whole point away, and may name another friend,
e.g. "I have a terrible idea, and you will love it.", "Hmm, the numbers tell another story." or "I think Jenny is too optimistic."

Reply as JSON: {"hands": [{"id": "<friend id>", "teaser": "<teaser>"}]}`;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.9,
                max_tokens: 120,
            }),
        });
        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        if (!response.ok) {
            console.error("Director error:", data);
            return res.status(200).json({ hands: [] });
        }

        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { hands?: { id?: string; teaser?: string }[] };
        const allowed = new Set(candidates.map((m) => m.id));
        const seen = new Set<string>();
        const hands = (parsed.hands ?? [])
            .filter((hand) => hand.id && allowed.has(hand.id) && hand.teaser && !seen.has(hand.id) && seen.add(hand.id))
            .slice(0, 2)
            .map((hand) => ({ id: hand.id, teaser: String(hand.teaser).slice(0, 80) }));
        return res.status(200).json({ hands });
    } catch (error) {
        console.error("Director failed:", error);
        // Interjections are optional; the conversation continues without them.
        return res.status(200).json({ hands: [] });
    }
}
