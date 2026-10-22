export type Role = "user" | "assistant" | "system";

export interface Message {
    role: Role;
    content: string;
    /** Stable key for a reply that is still streaming. */
    id?: string;
    /** Which group member said an assistant message. */
    speaker?: string;
}

export interface ChatRequest {
    messages: Message[];
}

export interface ChatResponse {
    reply: string;
}