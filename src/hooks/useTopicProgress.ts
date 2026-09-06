import { useState, useEffect } from "react";
import type { TopicProgress } from "../data/topicTree";

const STORAGE_KEY = "language-learning-topic-progress";
const UPDATE_EVENT = "language-learning-topic-progress-updated";

function saveAndBroadcast(progress: TopicProgress) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (error) {
        console.error("Failed to save topic progress:", error);
    }

    queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent<TopicProgress>(UPDATE_EVENT, {
            detail: progress,
        }));
    });
}

export function useTopicProgress() {
    const [progress, setProgress] = useState<TopicProgress>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.error("Failed to load topic progress:", error);
            return {};
        }
    });

    // Keep every useTopicProgress instance synchronized in the same tab.
    // The native storage event only fires in other tabs, not this one.
    useEffect(() => {
        const syncProgress = (event: Event) => {
            const next = (event as CustomEvent<TopicProgress>).detail;
            if (next) setProgress(next);
        };

        window.addEventListener(UPDATE_EVENT, syncProgress);
        return () => window.removeEventListener(UPDATE_EVENT, syncProgress);
    }, []);

    const incrementTopicConversation = (topicId: string, conversationsNeeded: number) => {
        setProgress((prev) => {
            const current = prev[topicId] || { conversationCount: 0, completed: false };
            const newCount = current.conversationCount + 1;
            const isCompleted = newCount >= conversationsNeeded;

            const next = {
                ...prev,
                [topicId]: {
                    conversationCount: newCount,
                    completed: isCompleted,
                    lastVisited: new Date().toISOString(),
                },
            };
            saveAndBroadcast(next);
            return next;
        });
    };

    const resetProgress = () => {
        localStorage.removeItem(STORAGE_KEY);
        setProgress({});
        window.dispatchEvent(new CustomEvent<TopicProgress>(UPDATE_EVENT, {
            detail: {},
        }));
    };

    const markTopicVisited = (topicId: string) => {
        setProgress((prev) => {
            const next = {
                ...prev,
                [topicId]: {
                    ...(prev[topicId] || { conversationCount: 0, completed: false }),
                    lastVisited: new Date().toISOString(),
                },
            };
            saveAndBroadcast(next);
            return next;
        });
    };

    return {
        progress,
        incrementTopicConversation,
        resetProgress,
        markTopicVisited,
    };
}
