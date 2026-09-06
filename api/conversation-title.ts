import type { VercelRequest, VercelResponse } from "@vercel/node";

type ConversationMetadata = {
    title: string;
    summary: string;
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

    const messages = Array.isArray(req.body?.messages)
        ? req.body.messages
            .slice(0, 16)
            .filter((message: any) => message?.role === "user" || message?.role === "assistant")
            .map((message: any) => ({
                role: message.role,
                content: typeof message.content === "string"
                    ? message.content.trim().slice(0, 700)
                    : "",
            }))
            .filter((message: any) => message.content)
        : [];

    if (messages.length < 2) {
        return res.status(400).json({ error: "At least two messages are required" });
    }

    try {
        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                instructions: "Create concise English metadata for a language-learning conversation. The title must describe the actual subject discussed, use 2 to 6 words, and never use generic titles such as New Discussion, Conversation, or Language Practice. The summary must be one short sentence describing the main content.",
                input: messages.map((message: any) => `${message.role}: ${message.content}`).join("\n"),
                max_output_tokens: 120,
                text: {
                    format: {
                        type: "json_schema",
                        name: "conversation_metadata",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                summary: { type: "string" },
                            },
                            required: ["title", "summary"],
                            additionalProperties: false,
                        },
                    },
                },
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("Conversation title OpenAI error:", data);
            return res.status(response.status).json({ error: "Title generation failed" });
        }

        const metadata = JSON.parse(extractOutputText(data)) as ConversationMetadata;
        return res.status(200).json({
            title: metadata.title.trim().slice(0, 70),
            summary: metadata.summary.trim().slice(0, 220),
        });
    } catch (error) {
        console.error("Conversation title error:", error);
        return res.status(500).json({ error: "Title generation failed" });
    }
}
