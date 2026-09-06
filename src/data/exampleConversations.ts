// src/data/exampleConversations.ts

export type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

export type ExampleConversation = {
    id: string;
    title: string;
    summary: string;
    icon: string;
    x: number;
    y: number;
    messages: ChatMessage[];
    createdAt?: number;
};

export const exampleConversations: ExampleConversation[] = [
    {
        id: "openai-realtime",
        title: "Realtime Voice",
        summary: "Realtime API and WebRTC voice conversation.",
        icon: "🎙️",
        x: 60,
        y: -80,
        messages: [
            { role: "user", content: "How do I make the bot answer instantly by voice?" },
            { role: "assistant", content: "Use the OpenAI Realtime API with WebRTC." },
        ],
    },
    {
        id: "vrm-avatar",
        title: "VRM Avatar",
        summary: "VRM character animation and expressions.",
        icon: "🧍",
        x: -120,
        y: -80,
        messages: [
            { role: "user", content: "Can my AI bot use a VRM avatar?" },
            { role: "assistant", content: "Yes. You can load a VRM model and animate expressions." },
        ],
    },
    {
        id: "language-learning",
        title: "Language Learning",
        summary: "Practicing Chinese, Japanese and English with the AI character.",
        icon: "🗣️",
        x: -150,
        y: 40,
        messages: [
            { role: "user", content: "Can this bot help me practice Chinese?" },
            { role: "assistant", content: "Yes. It can roleplay conversations and correct your language naturally." },
        ],
    },
    {
        id: "web-deployment",
        title: "Web Deployment",
        summary: "Deploying the Vite React chatbot project to Vercel.",
        icon: "🌐",
        x: 140,
        y: 30,
        messages: [
            { role: "user", content: "How do I deploy my Vite project?" },
            { role: "assistant", content: "You can push it to GitHub and import the repository in Vercel." },
        ],
    },
    {
        id: "ai-research",
        title: "AI Research",
        summary: "LLMs, computer vision, diffusion models and agentic AI research topics.",
        icon: "🧠",
        x: 20,
        y: 130,
        messages: [
            { role: "user", content: "What are good AI research topics in 2026?" },
            { role: "assistant", content: "Promising areas include agentic AI, LLM evaluation, efficient vision models and synthetic data." },
        ],
    },
];
