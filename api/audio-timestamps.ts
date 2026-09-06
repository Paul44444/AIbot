import OpenAI, { toFile } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: any, res: any) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const audio = typeof req.body?.audio === "string" ? req.body.audio : "";
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 2000) : "";

    if (!audio || audio.length > 8_000_000) {
        return res.status(400).json({ error: "Invalid audio" });
    }

    try {
        const buffer = Buffer.from(audio, "base64");
        const transcription = await openai.audio.transcriptions.create({
            file: await toFile(buffer, "speech.mp3", { type: "audio/mpeg" }),
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["word"],
            prompt: text,
        });

        const words = ((transcription as any).words ?? []).map((word: any) => ({
            word: String(word.word ?? ""),
            start: Number(word.start ?? 0),
            end: Number(word.end ?? 0),
        }));

        return res.status(200).json({ words });
    } catch (error) {
        console.error("Audio timestamp error:", error);
        return res.status(500).json({ error: "Could not align audio" });
    }
}
