import Anthropic from "@anthropic-ai/sdk";
import type { VercelResponse } from "@vercel/node";

// Claude as a character's brain (see brain.ts): turns the conversation, kept in the
// OpenAI Responses shape the site uses, into a Claude request and streams the reply
// as the same newline-separated JSON events. The leading underscore keeps this file
// from becoming a function of its own (the Hobby plan allows only 12).

export const CLAUDE_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

type Item = { role?: string; content?: unknown; type?: string; name?: string; arguments?: string; output?: unknown };
type FunctionTool = { type: string; name?: string; description?: string; parameters?: Record<string, unknown> };

let client: Anthropic | null = null;

function send(res: VercelResponse, event: object) {
    res.write(`${JSON.stringify(event)}\n`);
}

function describeCall(item: Item) {
    try {
        const args = JSON.parse(item.arguments ?? "{}") as { request?: string };
        return `[You drew a sketch on the whiteboard: ${args.request ?? item.name}]`;
    } catch {
        return `[You used ${item.name}]`;
    }
}

/**
 * The conversation as Claude messages. Notes for the character go into the system prompt.
 * Earlier sketches are told as text: replaying them as tool calls would need the thinking
 * that came with them, which the site does not keep.
 */
function toClaude(instructions: string, input: Item[]) {
    const notes: string[] = [];
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const item of input) {
        if (item.role === "developer" && typeof item.content === "string") notes.push(item.content);
        else if ((item.role === "user" || item.role === "assistant") && typeof item.content === "string") {
            messages.push({ role: item.role, content: item.content });
        } else if (item.type === "function_call") messages.push({ role: "assistant", content: describeCall(item) });
        else if (item.type === "function_call_output") messages.push({ role: "user", content: `[Whiteboard: ${String(item.output)}]` });
    }
    if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "[The conversation starts.]" });
    // A last assistant message would be taken as the start of the reply, which these models refuse.
    if (messages.at(-1)?.role !== "user") messages.push({ role: "user", content: "[It is your turn again.]" });
    return { system: [instructions, ...notes].join("\n\n"), messages };
}

export async function streamClaude(
    model: string,
    instructions: string,
    input: unknown[],
    functions: FunctionTool[],
    res: VercelResponse,
    effort: "low" | "high",
    /** Web searches that fit the time forecast; 0 leaves the tool out. */
    searches = 3,
) {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).send("ANTHROPIC_API_KEY is not set");
    client ??= new Anthropic();
    const { system, messages } = toClaude(instructions, input as Item[]);
    const tools: Anthropic.Beta.BetaToolUnion[] = [
        ...(searches ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: searches }] : []),
        ...functions.filter((tool) => tool.name).map((tool) => ({
            name: tool.name!,
            description: tool.description,
            input_schema: { type: "object" as const, ...tool.parameters },
        })),
    ];
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
        let wroteText = false;
        // A long web search can pause the turn; it then continues where it stopped.
        for (let round = 0; round < 3; round++) {
            const stream = client.beta.messages.stream({
                model,
                max_tokens: 16000,
                system,
                messages,
                tools,
                // Conversation needs speed more than deep deliberation; a work session gets more thought.
                output_config: { effort },
                // Readable summaries of its thinking, shown while the user waits.
                thinking: { type: "adaptive", display: "summarized" },
                // Should a safety check decline, a related model answers instead of nobody.
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
            });
            // The query of a web search arrives in pieces.
            let query: string | null = null;
            for await (const event of stream) {
                if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
                    // The query comes either whole with the start of the block or in pieces after it.
                    const start = (event.content_block.input as { query?: string } | undefined)?.query;
                    if (start) send(res, { type: "search", text: start });
                    else query = "";
                }
                if (event.type === "content_block_delta" && event.delta.type === "input_json_delta" && query !== null) query += event.delta.partial_json;
                if (event.type === "content_block_stop" && query !== null) {
                    try {
                        const text = (JSON.parse(query) as { query?: string }).query;
                        if (text) send(res, { type: "search", text });
                    } catch {
                        // Not a search with a query.
                    }
                    query = null;
                }
                if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") send(res, { type: "thought", text: event.delta.thinking });
                if (event.type === "content_block_start" && event.content_block.type === "text" && wroteText) {
                    // Text around a web search comes in separate blocks.
                    send(res, { type: "delta", text: " " });
                }
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                    wroteText = true;
                    send(res, { type: "delta", text: event.delta.text });
                }
            }
            const message = await stream.finalMessage();
            for (const block of message.content) {
                if (block.type === "tool_use") {
                    send(res, { type: "call", name: block.name, callId: block.id, arguments: JSON.stringify(block.input) });
                }
            }
            if (message.stop_reason !== "pause_turn") break;
            messages.push({ role: "assistant", content: message.content });
        }
    } catch (error) {
        if (error instanceof Anthropic.APIError) console.error("Claude error", error.status, error.message.slice(0, 500));
        else console.error("Claude stream failed", error);
        send(res, { type: "error" });
    }
    send(res, { type: "done" });
    res.end();
}
