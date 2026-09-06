// src/data/conversationStorage.ts

import {
    exampleConversations,
    type ChatMessage,
    type ExampleConversation,
} from "./exampleConversations";

const STORAGE_KEY = "topicGraphConversations";

export type StoredConversation = ExampleConversation & {
    createdAt: number;
    updatedAt: number;
    aiTitleGenerated?: boolean;
};

const metadataRequests = new Set<string>();

export function loadStoredConversations(): StoredConversation[] {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
        return [];
    }

    try {
        const conversations = JSON.parse(raw) as StoredConversation[];

        return conversations.map((conversation) => ({
            ...conversation,
            title: conversation.title === "New Discussion"
                ? createFallbackTitle(conversation.messages)
                : conversation.title,
            createdAt: conversation.createdAt ?? conversation.updatedAt ?? Date.now(),
        }));
    } catch {
        return [];
    }
}

export function loadAllConversations(): ExampleConversation[] {
    return [
        ...exampleConversations,
        ...loadStoredConversations(),
    ];
}

export function upsertConversationNode(
    id: string,
    messages: ChatMessage[]
) {
    if (messages.length === 0) return;

    const existing = loadStoredConversations();
    const oldNode = existing.find((node) => node.id === id);

    const newNode = createConversationNode(messages);

    const updatedNode = {
        ...newNode,
        id,
        title: oldNode?.aiTitleGenerated ? oldNode.title : newNode.title,
        summary: oldNode?.aiTitleGenerated ? oldNode.summary : newNode.summary,
        x: oldNode?.x ?? newNode.x,
        y: oldNode?.y ?? newNode.y,
        createdAt: oldNode?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        aiTitleGenerated: oldNode?.aiTitleGenerated ?? false,
    };

    const next = [
        ...existing.filter((node) => node.id !== id),
        updatedNode,
    ];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("conversation-history-updated"));

    if (!updatedNode.aiTitleGenerated && !metadataRequests.has(id)) {
        metadataRequests.add(id);
        void generateConversationMetadata(id, messages);
    }
}

async function generateConversationMetadata(id: string, messages: ChatMessage[]) {
    try {
        const response = await fetch("/api/conversation-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
        });

        if (!response.ok) throw new Error(`Conversation title failed: ${response.status}`);

        const metadata = await response.json() as { title: string; summary: string };
        const conversations = loadStoredConversations();
        const current = conversations.find((conversation) => conversation.id === id);

        if (!current) return;

        const next = conversations.map((conversation) => conversation.id === id
            ? {
                ...conversation,
                title: metadata.title,
                summary: metadata.summary,
                aiTitleGenerated: true,
            }
            : conversation
        );

        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event("conversation-history-updated"));
    } catch (error) {
        console.error("Could not generate conversation title:", error);
    } finally {
        metadataRequests.delete(id);
    }
}

function createConversationNode(messages: ChatMessage[]): StoredConversation {
    const fullText = messages
        .map((message) => message.content)
        .join(" ")
        .toLowerCase();

    const topic = detectTopic(fullText);

    return {
        id: crypto.randomUUID(),
        title: topic.title === "New Discussion" ? createFallbackTitle(messages) : topic.title,
        summary: messages[0]?.content.slice(0, 140) ?? topic.title,
        icon: topic.icon,
        x: topic.x + Math.random() * 80 - 40,
        y: topic.y + Math.random() * 80 - 40,
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function createFallbackTitle(messages: ChatMessage[]) {
    const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();

    if (!firstUserMessage) return "Conversation";

    const compact = firstUserMessage.replace(/\s+/g, " ").replace(/[.!?。！？]+$/u, "");
    const words = compact.split(" ");

    if (words.length > 1) {
        const title = words.slice(0, 6).join(" ");
        return title.length > 48 ? `${title.slice(0, 45).trim()}…` : title;
    }

    return compact.length > 28 ? `${compact.slice(0, 27).trim()}…` : compact;
}

function detectTopic(text: string) {
    if (
        text.includes("realtime") ||
        text.includes("voice") ||
        text.includes("webrtc")
    ) {
        return {
            title: "Realtime Voice",
            icon: "🎙️",
            x: 60,
            y: -80,
        };
    }

    if (
        text.includes("vrm") ||
        text.includes("avatar") ||
        text.includes("animation")
    ) {
        return {
            title: "VRM Avatar",
            icon: "🧍",
            x: -120,
            y: -80,
        };
    }

    if (
        text.includes("chinese") ||
        text.includes("language") ||
        text.includes("中文")
    ) {
        return {
            title: "Language Learning",
            icon: "🗣️",
            x: -150,
            y: 40,
        };
    }

    if (
        text.includes("vite") ||
        text.includes("vercel") ||
        text.includes("deploy")
    ) {
        return {
            title: "Web Deployment",
            icon: "🌐",
            x: 140,
            y: 30,
        };
    }

    if (
        text.includes("ai") ||
        text.includes("llm") ||
        text.includes("chatgpt")
    ) {
        return {
            title: "AI Research",
            icon: "🧠",
            x: 20,
            y: 130,
        };
    }

    return {
        title: "New Discussion",
        icon: "💬",
        x: Math.random() * 500 - 250,
        y: Math.random() * 350 - 175,
    };
}
