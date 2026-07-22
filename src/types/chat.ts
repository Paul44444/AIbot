export type Role = "user" | "assistant" | "system";

export interface Message {
    role: Role;
    content: string;
}

export interface ChatRequest {
    messages: Message[];
}

export interface ChatResponse {
    reply: string;
}