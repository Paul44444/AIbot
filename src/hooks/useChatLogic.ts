import { useState } from "react";

import type {
    Message,
    ChatResponse,
} from "../types/chat";

import { speakText } from "../utils/speakText";
import { sendRealtimeText } from "../utils/realtimeVoice";
import { FREE_CONVERSATION_TOPIC_ID } from "../data/topicTree";

function getTopicInstructions(topicId: string): string {
    const topicGuides: Record<string, string> = {
        greetings: "Focus on greetings and farewells. Practice hello, goodbye, good morning, good evening, and 'how are you' expressions. Introduce basic polite phrases.",
        introductions: "Focus on self-introductions. Practice introducing yourself, asking for names, talking about age (if appropriate), and where you're from. Use simple present tense.",
        daily_life: "Focus on daily routines, morning/evening activities, household tasks, and everyday life. Ask about their daily schedule, habits, and routines. Introduce vocabulary related to time, activities, and household items.",
        food: "Focus on food, cooking, restaurants, and dining experiences. Ask about favorite foods, cooking methods, meal times, and eating habits. Introduce vocabulary related to ingredients, tastes, and dining etiquette.",
        numbers_time: "Focus on numbers, counting, telling time, dates, and schedules. Practice saying numbers, asking about time, talking about appointments and schedules.",
        travel: "Focus on travel, transportation, and places. Ask about trips, modes of transport, destinations, and travel experiences. Introduce vocabulary related to airports, hotels, directions, and sightseeing.",
        hobbies: "Focus on hobbies, interests, and leisure activities. Ask about what they enjoy doing in their free time, sports, arts, music, or other pastimes. Introduce relevant vocabulary for different activities.",
        shopping: "Focus on shopping, stores, and purchases. Ask about shopping habits, favorite stores, recent purchases, and shopping preferences. Introduce vocabulary related to stores, prices, and shopping expressions.",
        work: "Focus on work, school, studies, and professional life. Ask about their job, studies, career goals, and daily work/school routine. Introduce vocabulary related to professions, education, and workplace situations.",
        weather: "Focus on weather, seasons, and climate. Ask about current weather, favorite seasons, weather preferences, and weather-related activities. Introduce vocabulary for weather conditions and seasonal activities.",
        health: "Focus on health, fitness, and wellness. Ask about exercise routines, healthy habits, sports activities, and well-being. Introduce vocabulary related to body parts, exercises, and health-related activities.",
    };

    return topicGuides[topicId] || topicGuides.greetings;
}

export function useChatLogic(
    realtimeDc: RTCDataChannel | null,
    selectedTopic: string = FREE_CONVERSATION_TOPIC_ID
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
                const topicGuidance = selectedTopic === FREE_CONVERSATION_TOPIC_ID
                    ? "The user chose free conversation mode. Follow their interests and let them change subjects naturally. Do not steer them toward any particular topic."
                    : `TOPIC FOCUS: ${getTopicInstructions(selectedTopic)}\nGently guide the conversation toward this topic. Ask relevant questions and use appropriate vocabulary.\nIf the user goes off-topic, acknowledge their response briefly and guide back to the topic naturally.`;

                const characterSystemMessage: Message = {
                    role: "system",
                    content: `
                            You are the 3D anime character on this website, helping users practice language skills.
                            Answer as the character, not as an AI model.
                            Do not say that you are an AI algorithm.
                            If the user asks how you feel, answer naturally from the character's perspective.
                            Keep answers friendly, conversational, and short.
                            Answer in 1 short sentence.

                            ${topicGuidance}
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

