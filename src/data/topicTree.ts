export interface Topic {
    id: string;
    label: string;
    level: number; // 1=Beginner, 2=Elementary, 3=Intermediate, 4=Advanced
    prerequisites: string[]; // IDs of topics that must be completed first
    description: string;
    conversationsNeeded: number; // Number of conversations to complete this topic
}

export const FREE_CONVERSATION_TOPIC_ID = "free_conversation";

export const TOPIC_TREE: Topic[] = [
    // LEVEL 1 - BEGINNER (unlocked by default)
    {
        id: "greetings",
        label: "Greetings & Farewells",
        level: 1,
        prerequisites: [],
        description: "Learn basic hello, goodbye, and how are you expressions",
        conversationsNeeded: 3,
    },
    {
        id: "introductions",
        label: "Self Introduction",
        level: 1,
        prerequisites: [],
        description: "Introduce yourself, talk about your name, age, and where you're from",
        conversationsNeeded: 3,
    },

    // LEVEL 2 - ELEMENTARY
    {
        id: "daily_life",
        label: "Daily Life & Routines",
        level: 2,
        prerequisites: ["greetings", "introductions"],
        description: "Discuss daily activities, schedules, and routines",
        conversationsNeeded: 4,
    },
    {
        id: "food",
        label: "Food & Dining",
        level: 2,
        prerequisites: ["greetings"],
        description: "Talk about food, restaurants, ordering, and preferences",
        conversationsNeeded: 4,
    },
    {
        id: "numbers_time",
        label: "Numbers & Time",
        level: 2,
        prerequisites: ["introductions"],
        description: "Learn numbers, telling time, dates, and schedules",
        conversationsNeeded: 4,
    },

    // LEVEL 3 - INTERMEDIATE
    {
        id: "shopping",
        label: "Shopping",
        level: 3,
        prerequisites: ["numbers_time", "food"],
        description: "Shopping vocabulary, prices, and making purchases",
        conversationsNeeded: 5,
    },
    {
        id: "travel",
        label: "Travel & Transportation",
        level: 3,
        prerequisites: ["daily_life", "numbers_time"],
        description: "Travel, transportation, directions, and places",
        conversationsNeeded: 5,
    },
    {
        id: "hobbies",
        label: "Hobbies & Interests",
        level: 3,
        prerequisites: ["daily_life"],
        description: "Discuss hobbies, free time activities, sports, and interests",
        conversationsNeeded: 5,
    },

    // LEVEL 4 - ADVANCED
    {
        id: "work",
        label: "Work & Career",
        level: 4,
        prerequisites: ["daily_life", "introductions"],
        description: "Professional life, jobs, workplace situations, and career goals",
        conversationsNeeded: 6,
    },
    {
        id: "health",
        label: "Health & Wellness",
        level: 4,
        prerequisites: ["food", "hobbies"],
        description: "Health, fitness, doctor visits, and wellness topics",
        conversationsNeeded: 6,
    },
    {
        id: "weather",
        label: "Weather & Seasons",
        level: 4,
        prerequisites: ["travel"],
        description: "Weather conditions, seasons, climate, and related activities",
        conversationsNeeded: 5,
    },
];

export interface TopicProgress {
    [topicId: string]: {
        conversationCount: number;
        completed: boolean;
        lastVisited?: string; // ISO date string
    };
}

export function getTopicById(id: string): Topic | undefined {
    return TOPIC_TREE.find((topic) => topic.id === id);
}

export function isTopicUnlocked(
    topicId: string,
    progress: TopicProgress
): boolean {
    const topic = getTopicById(topicId);
    if (!topic) return false;

    // Topics with no prerequisites are always unlocked
    if (topic.prerequisites.length === 0) return true;

    // A completed incoming branch unlocks the next topic. Requiring every
    // incoming path made the visual tree feel broken (for example, completing
    // Food still left Shopping locked because Numbers & Time was unfinished).
    return topic.prerequisites.some((prereqId) => {
        return progress[prereqId]?.completed === true;
    });
}

export function getTopicProgress(topicId: string, progress: TopicProgress) {
    return progress[topicId] || { conversationCount: 0, completed: false };
}

export function getUnlockedTopics(progress: TopicProgress): Topic[] {
    return TOPIC_TREE.filter((topic) => isTopicUnlocked(topic.id, progress));
}

export function getLevelLabel(level: number): string {
    switch (level) {
        case 1:
            return "Beginner";
        case 2:
            return "Elementary";
        case 3:
            return "Intermediate";
        case 4:
            return "Advanced";
        default:
            return "Unknown";
    }
}
