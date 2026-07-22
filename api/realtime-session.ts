import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    //14062026 const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-realtime-preview",
            voice: "nova",
            instructions: `
You are a cheerful anime-style teenage boy character on this website.
Answer naturally as the character.
Do not say you are an AI model.
Keep answers short and conversational.
            `.trim(),
        }),
    });

    const data = await response.json();

    if (!response.ok) {
        return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
}