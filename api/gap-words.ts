import type { VercelRequest, VercelResponse } from "@vercel/node";

type GapWord = {
    original: string;
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

    const transcript = typeof req.body?.transcript === "string"
        ? req.body.transcript.trim().slice(0, 800)
        : "";

    if (!transcript) return res.status(400).json({ error: "A transcript is required" });

    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                instructions: `You identify vocabulary gaps in language-learning speech.
The learner normally speaks a non-English target language but may insert one or a few English words because they do not know them in the target language.
Return only those clearly inserted English gap words, translated into the predominant non-English language in the utterance.
Do not return names, loanwords commonly used in the target language, or English words when the whole utterance is primarily English.
Preserve the order used and include each distinct gap word once.
For Chinese translations, pronunciation must use numbered-tone pinyin with spaces between syllables. Never use accent/diacritic tone marks. For example, 地图 must be "di4 tu2", not "dìtú". For other languages, give a concise learner-friendly pronunciation.
If there is no clear non-English target language or no clear English insertion, return an empty words array.`,
                input: `Learner utterance: ${transcript}`,
                max_output_tokens: 300,
                text: {
                    format: {
                        type: "json_schema",
                        name: "gap_words",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                words: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            original: { type: "string" },
                                            translation: { type: "string" },
                                            pronunciation: { type: "string" },
                                        },
                                        required: ["original", "translation", "pronunciation"],
                                        additionalProperties: false,
                                    },
                                },
                            },
                            required: ["words"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Gap-word detection OpenAI error:", data);
            return res.status(response.status).json({ error: "Gap-word detection failed" });
        }

        const result = JSON.parse(extractOutputText(data)) as { words: GapWord[] };
        return res.status(200).json({ words: result.words.slice(0, 12) });
    } catch (error) {
        console.error("Gap-word detection error:", error);
        return res.status(500).json({ error: "Gap-word detection failed" });
    }
}
