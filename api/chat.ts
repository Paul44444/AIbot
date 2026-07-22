import type { VercelRequest, VercelResponse } from "@vercel/node";

type RateEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateEntry>();

function getClientIp(req: VercelRequest): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
    return (req.socket?.remoteAddress ?? "unknown").toString();
}

function rateLimit(ip: string, limit: number, windowMs: number) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        const resetAt = now + windowMs;
        rateLimitMap.set(ip, { count: 1, resetAt });
        return { allowed: true, remaining: limit - 1, resetAt };
    }

    if (entry.count >= limit) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    rateLimitMap.set(ip, entry);
    return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

interface ChatRequestBody {
    messages: Message[];
}

interface OpenAIResponse {
    choices: { message: { content: string } }[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Rate limit early (best-effort on serverless)
    const ip = getClientIp(req);
    const rl = rateLimit(ip, 20, 10 * 60 * 1000); // 20 requests / 10 minutes

    if (!rl.allowed) {
        res.setHeader("Retry-After", Math.ceil((rl.resetAt - Date.now()) / 1000));
        return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { messages } = req.body as ChatRequestBody;

        if (!Array.isArray(messages)) {
            return res.status(400).json({ error: "Invalid messages format" });
        }

        // Sanitize incoming messages
        const cleanedMessages: Message[] = messages
            .filter((m) => m && typeof m.content === "string" && m.content.trim() !== "")
            .map((m) => ({ role: m.role, content: m.content.trim() }));

        if (cleanedMessages.length === 0) {
            return res.status(400).json({ error: "No valid messages provided" });
        }

        // Cost control caps
        const MAX_MESSAGES = 20;
        const MAX_CHARS_PER_MESSAGE = 2000;
        const MAX_OUTPUT_TOKENS = 80;//400;

        const limitedMessages: Message[] = cleanedMessages
            .slice(-MAX_MESSAGES)
            .map((m) => ({
                role: m.role,
                content: m.content.slice(0, MAX_CHARS_PER_MESSAGE),
            }));

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: limitedMessages,
                max_tokens: MAX_OUTPUT_TOKENS,
            }),
        });

        const data = (await response.json()) as any;

        if (!response.ok) {
            console.error("OpenAI error:", data);
            // Return the real OpenAI error to help debugging
            return res.status(response.status).json({ error: data });
        }

        const reply = (data as OpenAIResponse).choices?.[0]?.message?.content ?? "";
        return res.status(200).json({ reply });
    } catch (error) {
        console.error("Server error:", error);
        return res.status(500).json({ error: "Server error" });
    }
}