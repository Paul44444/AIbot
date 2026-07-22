import { useState } from "react";

import type {
    Message,
    ChatResponse,
} from "../types/chat";

import { speakText } from "../utils/speakText";
import { sendRealtimeText } from "../utils/realtimeVoice";

export function useChatLogic(
    realtimeDc: RTCDataChannel | null
) {

    const [messages, setMessages] =
        useState<Message[]>([]);

    const [input, setInput] =
        useState("");

    const [loading, setLoading] =
        useState(false);

    const [speakingText, setSpeakingText] =
        useState<string | null>(null);

    const sendMessage = async () => {

        if (
            realtimeDc &&
            realtimeDc.readyState === "open"
        ) {

            sendRealtimeText(
                realtimeDc,
                input
            );

            setInput("");

            return;
        }

        // -----------------------------------

        if (!input.trim()) return;

        const newUserMessage: Message = {
            role: "user",
            content: input,
        };

        const updatedMessages = [
            ...messages,
            newUserMessage,
        ];

        setMessages(updatedMessages);

        setInput("");

        setLoading(true);

        try {
                const characterSystemMessage: Message = {
                    role: "system",
                    content: `
                            You are the 3D anime character on this website.
                            Answer as the character, not as an AI model.
                            Do not say that you are an AI algorithm.
                            If the user asks how you feel, answer naturally from the character's perspective.
                            Keep answers friendly, conversational, and short.
                            Answer in 1 short sentence.
                        `.trim(),
                };

                const response = await fetch(
                "/api/chat",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        messages: [characterSystemMessage, ...updatedMessages],
                    }),
                }
            );

            const data: ChatResponse =
                await response.json();

            const assistantMessage: Message = {
                role: "assistant",
                content: data.reply,
            };

            speakText(
                data.reply,

                () => {

                    setLoading(false);

                    setMessages((prev) => [
                        ...prev,
                        assistantMessage,
                    ]);

                    setSpeakingText(data.reply);
                },

                () => {
                    setSpeakingText(null);
                }

            ).catch(console.error);

        } catch (error) {

            console.error(
                "Chat error:",
                error
            );
        }
    };

    return {

        messages,
        setMessages,

        input,
        setInput,

        loading,

        speakingText,

        sendMessage,
    };
}

