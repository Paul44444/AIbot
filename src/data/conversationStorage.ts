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
};

export function loadStoredConversations(): StoredConversation[] {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
        return [];
    }

    try {
        return JSON.parse(raw);
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
        x: oldNode?.x ?? newNode.x,
        y: oldNode?.y ?? newNode.y,
        createdAt: oldNode?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
    };

    const next = [
        ...existing.filter((node) => node.id !== id),
        updatedNode,
    ];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function createConversationNode(messages: ChatMessage[]): StoredConversation {
    const fullText = messages
        .map((message) => message.content)
        .join(" ")
        .toLowerCase();

    const topic = detectTopic(fullText);

    return {
        id: crypto.randomUUID(),
        title: topic.title,
        summary: messages[0]?.content.slice(0, 140) ?? topic.title,
        icon: topic.icon,
        x: topic.x + Math.random() * 80 - 40,
        y: topic.y + Math.random() * 80 - 40,
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
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