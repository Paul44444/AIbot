import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: any, res: any) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, speed = 1 } = req.body;

    if (!text) {
        return res.status(400).json({ error: "Missing text" });
    }

    const mp3 = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input: text,
        speed: Math.min(4, Math.max(0.25, Number(speed) || 1)),
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
}
