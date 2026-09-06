import type { VercelRequest, VercelResponse } from "@vercel/node";

type WordInfo = {
    word: string;
    translation: string;
    pronunciation: string;
};

function extractOutputText(data: any): string {
    if (typeof data?.output_text === "string") return data.output_text;

    for (const item of data?.output ?? []) {
        for (const content of item?.content ?? []) {
            if (typeof content?.text === "string") return content.text;
        }
    }

    return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const word = typeof req.body?.word === "string" ? req.body.word.trim().slice(0, 80) : "";
    const context = typeof req.body?.context === "string" ? req.body.context.trim().slice(0, 500) : "";

    if (!word) return res.status(400).json({ error: "A word is required" });

    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                instructions: "You are a concise language-learning dictionary. Translate the selected word into English based on its sentence context. Give its learner-friendly pronunciation: use numbered-tone pinyin for Chinese, and a simple phonetic pronunciation for other languages. Do not explain anything else.",
                input: `Selected word: ${word}\nSentence context: ${context || word}`,
                max_output_tokens: 120,
                text: {
                    format: {
                        type: "json_schema",
                        name: "word_info",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                word: { type: "string" },
                                translation: { type: "string" },
                                pronunciation: { type: "string" },
                            },
                            required: ["word", "translation", "pronunciation"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Word lookup OpenAI error:", data);
            return res.status(response.status).json({ error: "Word lookup failed" });
        }

        const info = JSON.parse(extractOutputText(data)) as WordInfo;
        return res.status(200).json(info);
    } catch (error) {
        console.error("Word lookup error:", error);
        return res.status(500).json({ error: "Word lookup failed" });
    }
}
