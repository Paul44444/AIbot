import type { VercelRequest, VercelResponse } from "@vercel/node";

// Expressive speech for characters whose replies come as text with stage
// directions such as [laughs] or [whispers]: ElevenLabs v3 performs them.
// GET, so an <audio> element can play the stream while it is still arriving.

/** Voices the site may use; anything else would let others spend the quota on any voice. */
const VOICES = new Set([
    "N2lVS1w4EtoT3dr4eOWO", // Callum: husky trickster
    "TX3LPaxmHKxFdv7VOQHJ", // Liam: young, energetic
    "bIHbv24MWmeRgasZH58o", // Will: young, relaxed
    "SOYHLrjzK2X1ezoPC6cr", // Harry: young, fierce
]);
const MAX_TEXT = 700;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");
    const text = String(req.query.text ?? "").trim().slice(0, MAX_TEXT);
    const voice = String(req.query.voice ?? "");
    if (!text || !VOICES.has(voice)) return res.status(400).send("Missing text or unknown voice");
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).send("ELEVENLABS_API_KEY is not set");
    // ElevenLabs accepts 0.7–1.2; the site's slider goes down to 0.55.
    const speed = Math.min(1.2, Math.max(0.7, Number(req.query.speed) || 1));

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_v3",
            // v3 knows 0 (creative), 0.5 (natural) and 1 (robust); lower follows the directions more freely.
            voice_settings: { stability: 0.5, speed },
        }),
    });
    if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        console.error("ElevenLabs error", upstream.status, detail.slice(0, 500));
        return res.status(502).send(`Voice service error ${upstream.status}`);
    }

    res.setHeader("Content-Type", "audio/mpeg");
    // The same line at the same speed sounds the same; let the edge answer repeats.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(Buffer.from(chunk));
    res.end();
}
