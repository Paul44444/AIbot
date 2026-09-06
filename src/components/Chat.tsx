import { lazy, Suspense, useImperativeHandle, useState } from "react";
import type { Ref } from "react";
import type { Message } from "../types/chat";

//08062026A import { useEffect, useRef } from 'react'
import { useEffect, useRef } from 'react'

import { upsertConversationNode } from "../data/conversationStorage";
import { Mic, MicOff, Lock, Check, LoaderCircle, Pause, Play } from "lucide-react";
import { useTopicProgress } from "../hooks/useTopicProgress";
import {
    FREE_CONVERSATION_TOPIC_ID,
    TOPIC_TREE,
    isTopicUnlocked,
    getTopicProgress,
    getLevelLabel,
    type Topic,
} from "../data/topicTree";

//upsertConversationNode(
//    conversationNodeIdRef.current,
//    currentMessages
//);

//11062026 import { loadMixamoAnimation }
//11062026   from "../utils/loadMixamoAnimation";

//import { startRealtimeVoiceSession } from "../utils/realtimeVoice";
import { useChatLogic }
    from "../hooks/useChatLogic";
import {
    cancelSpeech,
    pauseSpeech,
    primeSpeechPlayback,
    resumeSpeech,
    seekSpeechToTextPosition,
    speakText as speakSynthesizedText,
    subscribeSpeechPlayback,
    type SpeechPlaybackState,
} from "../utils/speakText";

//import { startRealtimeVoiceSession } from "../utils/realtimeVoice";
import {
    startRealtimeVoiceSession,
    sendRealtimeText
}

//void sendRealtimeText
from "../utils/realtimeVoice";

//import ChatTranscript from "./ChatTranscript";

//08062026 import { useFBX, useAnimations } from '@react-three/drei'
//08062026 import { useEffect, useRef } from 'react'

//08062026 import { VRMLoaderPlugin } from "@pixiv/three-vrm"

import {
    DICTIONARY_BASE,
    getCachedWordInfo,
    lookupWordInfo,
    prefetchWordDictionary,
    type WordInfo,
} from "../utils/wordLookup";

type GapWord = {
    original: string;
    translation: string;
    pronunciation: string;
};

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function InteractiveText({
                             text,
                             onWord,
                             onWordClick,
                         }: {
    text: string;
    onWord: (word: string, context: string) => void;
    onWordClick?: (characterIndex: number) => void;
}) {
    return Array.from(wordSegmenter.segment(text)).map((part, index) =>
        part.isWordLike ? (
            <button
                className="transcriptWord"
                type="button"
                key={`${part.index}-${index}`}
                onMouseEnter={() => onWord(part.segment, text)}
                onFocus={() => onWord(part.segment, text)}
                onClick={() => {
                    onWord(part.segment, text);
                    onWordClick?.(part.index);
                }}
            >
                {part.segment}
            </button>
        ) : (
            <span key={`${part.index}-${index}`}>{part.segment}</span>
        )
    );
}

function ChatTranscript({
                            messages,
                            loading,
                            assistantName,
                        }: {
    messages: Message[];
    loading: boolean;
    assistantName: string;
}) {
    const [wordInfo, setWordInfo] = useState<WordInfo | null>(null);
    const [lookupWord, setLookupWord] = useState<string | null>(null);
    const [lookupError, setLookupError] = useState(false);
    const lookupIdRef = useRef(0);

    useEffect(() => {
        const controller = new AbortController();
        const words = messages.flatMap((message) =>
            Array.from(wordSegmenter.segment(message.content))
                .filter((part) => part.isWordLike)
                .map((part) => part.segment)
        );
        void prefetchWordDictionary(words, controller.signal);
        return () => { controller.abort(); };
    }, [messages]);

    useEffect(() => () => { lookupIdRef.current += 1; }, []);

    const showWordInfo = (word: string, context: string) => {
        const lookupId = ++lookupIdRef.current;
        setLookupWord(word);
        setLookupError(false);
        const cached = getCachedWordInfo(word, context);
        setWordInfo(cached);
        if (cached) return;

        // Start immediately; shared requests prevent duplicate focus/hover calls.
        void lookupWordInfo(word, context).then((info) => {
            if (lookupId === lookupIdRef.current) setWordInfo(info);
        }).catch((error) => {
            console.error(error);
            if (lookupId === lookupIdRef.current) setLookupError(true);
        });
    };

    return (
        <>
            <div className="uiAnswer">
                {messages.map((msg, index) => (
                    <div className={`transcriptMessage transcriptMessage-${msg.role}`} key={index}>
                        <strong>{msg.role === "user" ? "You" : assistantName}:</strong>{" "}
                        <InteractiveText
                            text={msg.content}
                            onWord={showWordInfo}
                            onWordClick={msg.role === "assistant" ? (characterIndex) => {
                                void seekSpeechToTextPosition(msg.content, characterIndex).catch((error) => {
                                    console.error("Could not seek speech:", error);
                                });
                            } : undefined}
                        />
                    </div>
                ))}

                {loading && <div>Thinking...</div>}
            </div>

            {lookupWord && (
                <aside className="wordInfoBox" aria-live="polite">
                    <small>WORD HELPER</small>
                    <strong>{lookupWord}</strong>
                    {!wordInfo && !lookupError && <span className="wordInfoLoading">Looking it up…</span>}
                    {lookupError && <span className="wordInfoError">Could not load this word.</span>}
                    {wordInfo && (
                        <>
                            <span className="wordPronunciation">{wordInfo.pronunciation}</span>
                            <span className="wordTranslation">{wordInfo.translation}</span>
                            {wordInfo.source === "dictionary" && (
                                <small>
                                    Dictionary · <a href="https://www.mdbg.net/chinese/dictionary?page=cedict" target="_blank" rel="noreferrer">CC-CEDICT</a>
                                    {" · "}<a href={`${DICTIONARY_BASE}/NOTICE.txt`} target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
                                </small>
                            )}
                        </>
                    )}
                </aside>
            )}
        </>
    );
}

function LanguagePanel({
                           open,
                           onClose,
                           set1sentence,
                           set2sentence,
                           set4sentence,
                           selectedTopic,
                           onTopicChange,
                           progress,
                           onResetProgress,
                       }: {
    open: boolean;
    onClose: () => void;
    set1sentence: () => void;
    set2sentence: () => void;
    set4sentence: () => void;
    selectedTopic: string;
    onTopicChange: (topic: string) => void;
    progress: any;
    onResetProgress: () => void;
}) {
    if (!open) return null;

    // Group topics by level
    const topicsByLevel: { [level: number]: Topic[] } = {};
    TOPIC_TREE.forEach((topic) => {
        if (!topicsByLevel[topic.level]) {
            topicsByLevel[topic.level] = [];
        }
        topicsByLevel[topic.level].push(topic);
    });

    return (
        <div
            id="language-panel"
            className="languagePanel"
            style={{
                position: "fixed",
                top: 80,
                right: 20,
                width: 400,
                maxHeight: "calc(100vh - 100px)",
                backgroundColor: "rgba(30,30,30,0.95)",
                color: "white",
                padding: 20,
                borderRadius: 12,
                zIndex: 9999,
                backdropFilter: "blur(8px)",
                overflowY: "auto",
            }}
        >
            <h2 style={{ marginTop: 0 }}>Language Learning Path</h2>

            <button
                type="button"
                onClick={() => onTopicChange(FREE_CONVERSATION_TOPIC_ID)}
                aria-pressed={selectedTopic === FREE_CONVERSATION_TOPIC_ID}
                style={{
                    width: "100%",
                    marginBottom: 20,
                    padding: "12px",
                    border: selectedTopic === FREE_CONVERSATION_TOPIC_ID
                        ? "2px solid #7dc4ff"
                        : "1px solid #52637e",
                    borderRadius: 8,
                    color: "white",
                    backgroundColor: selectedTopic === FREE_CONVERSATION_TOPIC_ID
                        ? "#2874b8"
                        : "#3b4659",
                    cursor: "pointer",
                    fontWeight: selectedTopic === FREE_CONVERSATION_TOPIC_ID ? "bold" : "normal",
                }}
            >
                💬 Free conversation — no topic guidance
            </button>

            {[1, 2, 3, 4].map((level) => {
                const topics = topicsByLevel[level] || [];
                if (topics.length === 0) return null;

                return (
                    <div key={level} style={{ marginBottom: 20 }}>
                        <h3
                            style={{
                                fontSize: "0.9rem",
                                color: "#aaa",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: 10,
                            }}
                        >
                            {getLevelLabel(level)}
                        </h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {topics.map((topic) => {
                                const unlocked = isTopicUnlocked(topic.id, progress);
                                const topicProg = getTopicProgress(topic.id, progress);
                                const isActive = selectedTopic === topic.id;
                                const isCompleted = topicProg.completed;

                                return (
                                    <button
                                        key={topic.id}
                                        onClick={() => unlocked && onTopicChange(topic.id)}
                                        disabled={!unlocked}
                                        style={{
                                            padding: "12px",
                                            backgroundColor: isActive
                                                ? "#4a90e2"
                                                : isCompleted
                                                ? "#2d7a3e"
                                                : unlocked
                                                ? "#555"
                                                : "#333",
                                            border: isActive ? "2px solid #6ab0ff" : "1px solid #444",
                                            borderRadius: "8px",
                                            color: unlocked ? "white" : "#888",
                                            cursor: unlocked ? "pointer" : "not-allowed",
                                            fontWeight: isActive ? "bold" : "normal",
                                            textAlign: "left",
                                            position: "relative",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            opacity: unlocked ? 1 : 0.6,
                                        }}
                                        title={
                                            unlocked
                                                ? topic.description
                                                : `Locked. Complete one of: ${topic.prerequisites.join(", ")}`
                                        }
                                    >
                                        {!unlocked && <Lock size={16} />}
                                        {isCompleted && <Check size={16} color="#7cf57c" />}
                                        <div style={{ flex: 1 }}>
                                            <div>{topic.label}</div>
                                            {unlocked && (
                                                <div
                                                    style={{
                                                        fontSize: "0.75rem",
                                                        color: "#bbb",
                                                        marginTop: 4,
                                                    }}
                                                >
                                                    {topicProg.conversationCount} /{" "}
                                                    {topic.conversationsNeeded} conversations
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            <h3 style={{ marginTop: 20, fontSize: "0.9rem" }}>Sentences per answer:</h3>
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={set1sentence} style={{ flex: 1 }}>1</button>
                <button onClick={set2sentence} style={{ flex: 1 }}>2</button>
                <button onClick={set4sentence} style={{ flex: 1 }}>4</button>
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
                <button
                    onClick={onResetProgress}
                    style={{
                        flex: 1,
                        backgroundColor: "#d9534f",
                        fontSize: "0.85rem",
                    }}
                >
                    Reset Progress
                </button>
                <button onClick={onClose} style={{ flex: 1 }}>
                    Close
                </button>
            </div>
        </div>
    );
}

function ChatInput({
                           input,
                           setInput,
                           sendMessage,
                           microphoneEnabled,
                           microphoneConnecting,
                           toggleMicrophone,
                       }: {
        input: string;
        setInput: (value: string) => void;
        sendMessage: () => void | Promise<void>;
        microphoneEnabled: boolean;
        microphoneConnecting: boolean;
        toggleMicrophone: () => void | Promise<void>;
    }) {
        const [microphonePromptDismissed, setMicrophonePromptDismissed] = useState(false);

        return (
            <div className="uiOverlay">
                <div className="chatInputRow">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void sendMessage();
                            }
                        }}
                    />

                    <button
                        className="sendButton"
                        onClick={() => void sendMessage()}
                        type="button"
                    >
                        Send
                    </button>

                    <div className="microphoneControl">
                        {!microphoneEnabled && !microphonePromptDismissed && (
                            <div className="microphonePrompt" role="status">
                                <button
                                    className="microphonePromptAction"
                                    type="button"
                                    onClick={() => void toggleMicrophone()}
                                >
                                    <Mic size={17} aria-hidden="true" />
                                    Activate microphone
                                </button>
                                <button
                                    className="microphonePromptClose"
                                    type="button"
                                    onClick={() => setMicrophonePromptDismissed(true)}
                                    aria-label="Dismiss microphone prompt"
                                    title="Dismiss"
                                >
                                    ×
                                </button>
                            </div>
                        )}

                        <button
                            className={`microphoneButton ${
                                microphoneEnabled
                                    ? "microphoneOn"
                                    : "microphoneOff"
                            }`}
                            onClick={() => void toggleMicrophone()}
                            type="button"
                            disabled={microphoneConnecting}
                            aria-label={
                                microphoneConnecting
                                    ? "Microphone is on — connecting"
                                    : microphoneEnabled
                                    ? "Turn microphone off"
                                    : "Turn microphone on"
                            }
                            title={
                                microphoneConnecting
                                    ? "Microphone is active — connecting to the conversation"
                                    : microphoneEnabled
                                    ? "Microphone is on — click to mute"
                                    : "Microphone is off — click to activate"
                            }
                            aria-pressed={microphoneEnabled}
                        >
                            {microphoneEnabled ? (
                                <Mic size={23} aria-hidden="true" />
                            ) : (
                                <MicOff size={23} aria-hidden="true" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
}

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

function detectExpression(text: string) {

    const lower = text.toLowerCase();

    if (
        lower.includes("great") ||
        lower.includes("nice") ||
        lower.includes("wonderful") ||
        lower.includes("happy") ||
        lower.includes("yay")
    ) {
        return "happy";
    }

    if (
        lower.includes("sorry") ||
        lower.includes("sad") ||
        lower.includes("unfortunately")
    ) {
        return "sad";
    }

    if (
        lower.includes("wow") ||
        lower.includes("surprising")
    ) {
        return "Surprised";
    }

    return "relaxed";
}

function waitForDataChannelOpen(dc: RTCDataChannel): Promise<void> {
    if (dc.readyState === "open") {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            reject(new Error("Realtime data channel did not open"));
        }, 10_000);

        const handleOpen = () => {
            window.clearTimeout(timeout);
            dc.removeEventListener("open", handleOpen);
            dc.removeEventListener("error", handleError);
            resolve();
        };

        const handleError = () => {
            window.clearTimeout(timeout);
            dc.removeEventListener("open", handleOpen);
            dc.removeEventListener("error", handleError);
            reject(new Error("Realtime data channel error"));
        };

        dc.addEventListener("open", handleOpen);
        dc.addEventListener("error", handleError);
    });
}

import type { ChatMessage } from "../data/exampleConversations";

export type ChatHandle = { startNewConversation: () => void };

type ChatProps = {
    ref?: Ref<ChatHandle>;
    loadedMessages?: ChatMessage[] | null;
    selectedTopic?: string;
    onTopicChange?: (topicId: string) => void;
    pauseSceneStartup?: boolean;
};

const LazySceneView = lazy(() => import("./SceneView"));

type AvatarId = "male" | "jenny";

const AVATAR_URLS: Record<AvatarId, string> = {
    male: "/model/human11.vrm",
    jenny: "/model/jenny.vrm",
};

function setSessionMicrophoneEnabled(
    session: any,
    enabled: boolean
) {
    const pc = session?.pc as RTCPeerConnection | undefined;

    if (!pc) {
        return;
    }

    for (const sender of pc.getSenders()) {
        if (sender.track?.kind === "audio") {
            sender.track.enabled = enabled;
        }
    }
}

function limitTextToSentences(text: string, maximumSentences: number): string {
    const minimumMeaningfulCharacters = 15;
    const sentenceEnding = /[.!?。！？]+(?:["'”’」』)\]]*)/gu;
    let sentenceCount = 0;
    let segmentStart = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceEnding.exec(text)) !== null) {
        const segment = text.slice(segmentStart, match.index);
        const meaningfulCharacters = Array.from(segment).filter((character) =>
            /[\p{L}\p{N}]/u.test(character)
        ).length;

        if (meaningfulCharacters < minimumMeaningfulCharacters) {
            continue;
        }

        sentenceCount += 1;
        segmentStart = match.index + match[0].length;

        if (sentenceCount >= maximumSentences) {
            return text.slice(0, match.index + match[0].length).trim();
        }
    }

    return text.trim();
}

export default function Chat({
    ref,
    loadedMessages,
    selectedTopic = FREE_CONVERSATION_TOPIC_ID,
    onTopicChange,
    pauseSceneStartup = false,
}: ChatProps) {
    //1206026 const [messages, setMessages] = useState<Message[]>([]);
    //12062026A const [speakingText, setSpeakingText] = useState<string | null>(null);
    //1206026 const [input, setInput] = useState<string>("");
    //12062026A const [loading, setLoading] = useState<boolean>(false);
    const [realtimeSpeaking, setRealtimeSpeaking] = useState(false);
    const [speechPreparing, setSpeechPreparing] = useState(false);
    const [speechPlaybackState, setSpeechPlaybackState] =
        useState<SpeechPlaybackState>("idle");
    const [realtimeDc, setRealtimeDc] =
        useState<RTCDataChannel | null>(null);
    const [showLanguagePanel, setShowLanguagePanel] =
        useState(false);
    const [currentExpression, setCurrentExpression] =
        useState("relaxed");
    const [sceneStarted, setSceneStarted] = useState(false);
    void setCurrentExpression;
    void detectExpression;

    useEffect(() => {
        if (sceneStarted || pauseSceneStartup || showLanguagePanel) return;

        let startTimer = 0;
        let idleCallback = 0;
        const scheduleAfterQuietPeriod = () => {
            window.clearTimeout(startTimer);
            if (idleCallback && "cancelIdleCallback" in window) window.cancelIdleCallback(idleCallback);
            startTimer = window.setTimeout(() => {
                if ("requestIdleCallback" in window) {
                    idleCallback = window.requestIdleCallback(() => setSceneStarted(true));
                } else {
                    setSceneStarted(true);
                }
            }, 800);
        };

        scheduleAfterQuietPeriod();
        window.addEventListener("pointerdown", scheduleAfterQuietPeriod, { passive: true });
        window.addEventListener("keydown", scheduleAfterQuietPeriod);
        window.addEventListener("focusin", scheduleAfterQuietPeriod);

        return () => {
            window.clearTimeout(startTimer);
            if (idleCallback && "cancelIdleCallback" in window) window.cancelIdleCallback(idleCallback);
            window.removeEventListener("pointerdown", scheduleAfterQuietPeriod);
            window.removeEventListener("keydown", scheduleAfterQuietPeriod);
            window.removeEventListener("focusin", scheduleAfterQuietPeriod);
        };
    }, [sceneStarted, pauseSceneStartup, showLanguagePanel]);

    const { progress, incrementTopicConversation, resetProgress, markTopicVisited } =
        useTopicProgress();

    const conversationAbortRef = useRef(new AbortController());
    const [conversationVersion, setConversationVersion] = useState(0);
    const realtimeSessionRef = useRef<any>(null);
    const realtimeStartPromiseRef = useRef<Promise<any> | null>(null);
    const realtimeModeRef = useRef<"voice" | "text" | null>(null);
    const lastSavedMessageCountRef = useRef(0);
    const conversationNodeIdRef = useRef<string>(crypto.randomUUID());
    // No microphone track exists until a voice session has actually started.
    // Starting this as `true` made the UI look live while spoken audio was
    // silently ignored (notably when permission had not already been granted).
    const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
    const [microphoneConnecting, setMicrophoneConnecting] = useState(false);
    const [avatar, setAvatar] = useState<AvatarId>("jenny");
    const [speechRate, setSpeechRate] = useState(0.55);
    const speechRateRef = useRef(speechRate);
    const [sentenceCount, setSentenceCount] = useState(1);
    const sentenceCountRef = useRef(sentenceCount);
    const [gapWords, setGapWords] = useState<GapWord[]>([]);
    const [gapWordsLoading, setGapWordsLoading] = useState(false);
    const [gapWordsError, setGapWordsError] = useState(false);
    const lastGapTranscriptRef = useRef("");
    const gapWordsRequestRef = useRef(0);
    const selectedTopicLabel = selectedTopic === FREE_CONVERSATION_TOPIC_ID
        ? "Free conversation"
        : TOPIC_TREE.find((topic) => topic.id === selectedTopic)?.label ?? "Free conversation";

    const detectGapWords = async (transcript: string) => {
        const normalized = transcript.trim();
        if (!normalized || normalized === lastGapTranscriptRef.current) return;

        lastGapTranscriptRef.current = normalized;
        const requestId = ++gapWordsRequestRef.current;
        setGapWordsLoading(true);
        setGapWordsError(false);

        try {
            const response = await fetch("/api/gap-words", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transcript: normalized }),
            });

            if (!response.ok) throw new Error(`Gap-word detection failed: ${response.status}`);

            const data = await response.json() as { words: GapWord[] };
            if (requestId === gapWordsRequestRef.current) setGapWords(data.words);
        } catch (error) {
            console.error(error);
            if (requestId === gapWordsRequestRef.current) setGapWordsError(true);
        } finally {
            if (requestId === gapWordsRequestRef.current) setGapWordsLoading(false);
        }
    };

    const selectAvatar = (nextAvatar: AvatarId) => {
        setAvatar(nextAvatar);
        localStorage.setItem("selected-avatar", nextAvatar);
    };

    const startRealtimeIfNeeded = async (microphone: boolean = true) => {
            const requestedMode = microphone ? "voice" : "text";

            if (
                realtimeSessionRef.current &&
                realtimeSessionRef.current.dc?.readyState === "open"
            ) {
                // Existing voice session can also handle typed text.
                if (realtimeModeRef.current === "voice") {
                    return realtimeSessionRef.current;
                }

                // Existing text-only session can handle typed text.
                if (
                    realtimeModeRef.current === "text" &&
                    requestedMode === "text"
                ) {
                    return realtimeSessionRef.current;
                }

                // If we currently have text-only mode but now want voice,
                // close text-only and start a new microphone session.
                if (
                    realtimeModeRef.current === "text" &&
                    requestedMode === "voice"
                ) {
                    try {
                        realtimeSessionRef.current.dispose?.();
                    } catch {
                        // ignore
                    }

                    realtimeSessionRef.current = null;
                    realtimeModeRef.current = null;
                    setRealtimeDc(null);
                }
            }

            if (realtimeStartPromiseRef.current) {
                return realtimeStartPromiseRef.current;
            }

            const signal = conversationAbortRef.current.signal;
            const startPromise = (async () => {
                let currentAssistantText = "";
                let currentAssistantIndex: number | null = null;
                let speechStartedForCurrentResponse = false;

                const playAssistantSpeech = (text: string) => {
                    if (signal.aborted || !text || speechStartedForCurrentResponse) return;

                    speechStartedForCurrentResponse = true;
                    setSpeechPreparing(true);
                    void speakSynthesizedText(
                        text,
                        () => {
                            if (signal.aborted) return;
                            setSpeechPreparing(false);
                            setRealtimeSpeaking(true);
                        },
                        () => {
                            if (signal.aborted) return;
                            setSpeechPreparing(false);
                            setRealtimeSpeaking(false);
                        },
                        speechRateRef.current
                    ).catch((error) => {
                        if (signal.aborted) return;
                        setSpeechPreparing(false);
                        setRealtimeSpeaking(false);
                        console.error("Speech playback failed:", error);
                    });
                };

                const session = await startRealtimeVoiceSession({
                    microphone,
                    signal,
                    muteRemoteAudio: true,
                    onMicrophoneReady: () => setMicrophoneEnabled(true),

                    onUserSpeechStart: () => {
                        cancelSpeech();
                        setSpeechPreparing(false);
                        currentAssistantText = "";
                    },

                    onUserTextDone: (text) => {
                        void detectGapWords(text);
                        setRealtimeMessages((prev) => {
                            return [
                                ...prev,
                                {
                                    role: "user",
                                    content: text,
                                },
                            ];
                        });

                        currentAssistantText = "";
                        speechStartedForCurrentResponse = false;
                    },

                    onAssistantTextDelta: (delta) => {
                        if (!currentAssistantText && currentAssistantIndex === null) {
                            speechStartedForCurrentResponse = false;
                        }

                        currentAssistantText += delta;
                        const limitedText = limitTextToSentences(
                            currentAssistantText,
                            sentenceCountRef.current
                        );

                        setCurrentExpression(
                            detectExpression(currentAssistantText)
                        );

                        setRealtimeMessages((prev) => {
                            const next = [...prev];

                            if (currentAssistantIndex === null) {
                                currentAssistantIndex = next.length;

                                next.push({
                                    role: "assistant",
                                    content: limitedText,
                                });
                            } else {
                                next[currentAssistantIndex] = {
                                    role: "assistant",
                                    content: limitedText,
                                };
                            }

                            return next;
                        });
                    },

                    onAssistantTextDone: () => {
                        const completedText = limitTextToSentences(
                            currentAssistantText,
                            sentenceCountRef.current
                        );
                        const completedAssistantIndex = currentAssistantIndex;
                        currentAssistantText = "";
                        currentAssistantIndex = null;
                        console.log("Assistant text done");

                        if (completedAssistantIndex !== null) {
                            setRealtimeMessages((prev) => {
                                const next = [...prev];
                                const message = next[completedAssistantIndex];

                                if (message?.role === "assistant") {
                                    next[completedAssistantIndex] = {
                                        ...message,
                                        content: completedText,
                                    };
                                }

                                return next;
                            });
                        }

                        playAssistantSpeech(completedText);
                    },
                });

                signal.throwIfAborted();
                realtimeSessionRef.current = session;
                realtimeModeRef.current = requestedMode;

                setRealtimeSession(session);
                setRealtimeDc(session.dc);

                await waitForDataChannelOpen(session.dc);

                return session;
            })();

            realtimeStartPromiseRef.current = startPromise;
            try {
                return await startPromise;
            } finally {
                if (realtimeStartPromiseRef.current === startPromise) realtimeStartPromiseRef.current = null;
            }
        };

    const toggleMicrophone = async () => {
        // This runs synchronously inside the user's tap and unlocks delayed TTS
        // playback on iPhone Safari.
        primeSpeechPlayback();
        const signal = conversationAbortRef.current.signal;
        try {
            const existingSession = realtimeSessionRef.current;

            /*
             * If the voice session has not been started yet,
             * the first click starts it and leaves the microphone on.
             */
            if (
                !existingSession ||
                existingSession.pc?.connectionState === "closed" ||
                realtimeModeRef.current !== "voice"
            ) {
                setMicrophoneConnecting(true);

                try {
                    const session = await startRealtimeIfNeeded(true);

                    signal.throwIfAborted();
                    setSessionMicrophoneEnabled(session, true);
                    setMicrophoneEnabled(true);
                } finally {
                    if (!signal.aborted) setMicrophoneConnecting(false);
                }

                return;
            }

            const nextEnabled = !microphoneEnabled;

            setSessionMicrophoneEnabled(
                existingSession,
                nextEnabled
            );

            setMicrophoneEnabled(nextEnabled);
        } catch (error) {
            if (signal.aborted) return;
            console.error(
                "Could not toggle realtime microphone:",
                error
            );

            setMicrophoneEnabled(false);
        }
    };

    const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);

    const lastMessageCountRef = useRef(0);

    const updateRealtimeSession = (count?: number, topic?: string, rate?: number) => {
        const sentenceCountToUse = count !== undefined ? count : sentenceCount;
        const topicToUse = topic !== undefined ? topic : selectedTopic;
        const speechRateToUse = rate !== undefined ? rate : speechRate;

        if (count !== undefined) {
            setSentenceCount(count);
            sentenceCountRef.current = count;
        }

        if (!realtimeDc || realtimeDc.readyState !== "open") {
            return;
        }

        const topicGuidance = topicToUse === FREE_CONVERSATION_TOPIC_ID
            ? "The user chose free conversation mode. Follow their interests and let them change subjects naturally. Do not steer them toward any particular topic."
            : `TOPIC FOCUS: ${getTopicInstructions(topicToUse)}\nGently guide the conversation toward this topic. Ask relevant questions and use appropriate vocabulary.\nIf the user goes off-topic, acknowledge their response briefly and guide back to the topic naturally.`;
        const paceInstruction = speechRateToUse < 0.7
            ? "Speak very slowly and clearly. Pause briefly between phrases and pronounce every word distinctly."
            : speechRateToUse < 0.9
            ? "Speak slowly and clearly. Use a calm pace with small pauses between phrases."
            : "Speak at a natural conversational pace while remaining clear.";

        realtimeDc.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["text"],
                instructions: `
You are a cheerful anime-style character on this website, helping users practice language skills.
Answer naturally as the character.
Do not say you are an AI model.
Keep answers friendly and conversational.
Always answer with no more than ${sentenceCountToUse} sentence${sentenceCountToUse === 1 ? "" : "s"}.
Finish each sentence with normal sentence-ending punctuation. Do not use semicolons or run-on sentences to evade this limit.
Each answer must contain useful conversational content, not only a short reaction such as "Great idea!" or "That sounds nice!".
${paceInstruction}
Aim for approximately ${Math.round(speechRateToUse * 100)}% of a normal conversational speaking rate.

${topicGuidance}
            `.trim(),
            },
        }));
    };

    const set1sentence = () => updateRealtimeSession(1);
    const set2sentence = () => updateRealtimeSession(2);
    const set4sentence = () => updateRealtimeSession(4);

    const changeSpeechRate = (nextRate: number) => {
        setSpeechRate(nextRate);
        speechRateRef.current = nextRate;
        updateRealtimeSession(undefined, undefined, nextRate);
    };

    const handleTopicChange = (topic: string) => {
        onTopicChange?.(topic);
        updateRealtimeSession(undefined, topic);
        if (topic !== FREE_CONVERSATION_TOPIC_ID) {
            markTopicVisited(topic);
        }
    };

    useEffect(() => {
        updateRealtimeSession(undefined, selectedTopic);
        if (selectedTopic !== FREE_CONVERSATION_TOPIC_ID) {
            markTopicVisited(selectedTopic);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTopic, realtimeDc]);

    //const [currentAnimation, setCurrentAnimation] =
    //    useState("Idle")

    /*12062026 const mypath1 = "None";//"/model/human11.vrm";//"/model/vrm1.glb";

    const [currentModel, setCurrentModel] =
        useState(mypath1)//"/model/boy1.glb")//useState("/model/Idle.fbx")
    void currentModel;*/

    //const [currentModel, setCurrentModel] =
    //    useState(mypath1)//"/model/boy1.glb")//useState("/model/Idle.fbx")

    //const gestures = [
    //    "Idle",
    //    "Jump"
    //]

    //const randomGesture =
    //    gestures[Math.floor(Math.random() * gestures.length)]

    //setCurrentAnimation(randomGesture)
    /*12062026
    const sendMessage = async () => {
        if (!input.trim()) return;

        const newUserMessage: Message = {
            role: "user",
            content: input,
        };

        const updatedMessages = [...messages, newUserMessage];
        setMessages(updatedMessages);
        setInput("");
        setLoading(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ messages: updatedMessages }),
            });

            const data: ChatResponse = await response.json();

            const assistantMessage: Message = {
                role: "assistant",
                content: data.reply,
            };



            //setMessages((prev) => [...prev, assistantMessage]);
            speakText(
                data.reply,
                () => {
                    setLoading(false);
                    setMessages((prev) => [...prev, assistantMessage]);
                    setSpeakingText(data.reply);
                },
                () => {
                    setSpeakingText(null);
                }
            ).catch(console.error);
        } catch (error) {
            console.error("Chat error:", error);
        } finally {
            //setLoading(false);
        }
    };*/

    const {
        messages,
        setMessages,
        input,
        setInput,
        loading,
        speakingText,
    } = useChatLogic(realtimeDc, selectedTopic);

    const displayedMessages = (loadedMessages ?? [...messages, ...realtimeMessages])
        .filter((message) => !(message.role === "user" && message.content.trim() === "..."));

    const [realtimeSession, setRealtimeSession] =
        useState<any>(null);
    void realtimeSession;

    useEffect(() => {
        if (conversationAbortRef.current.signal.aborted) conversationAbortRef.current = new AbortController();
        return () => {
            conversationAbortRef.current.abort();
            cancelSpeech();
        };
    }, []);

    useImperativeHandle(ref, () => ({
        startNewConversation() {
            const currentMessages = [...messages, ...realtimeMessages].filter(
                (message): message is ChatMessage =>
                    (message.role === "user" || message.role === "assistant")
                    && message.content.trim() !== "..."
            );
            if (currentMessages.length) {
                upsertConversationNode(conversationNodeIdRef.current, currentMessages);
            }
            // Stop old callbacks before clearing UI and assigning a fresh history ID.
            conversationAbortRef.current.abort();
            conversationAbortRef.current = new AbortController();
            cancelSpeech();
            realtimeSessionRef.current = null;
            realtimeStartPromiseRef.current = null;
            realtimeModeRef.current = null;
            setRealtimeSession(null);
            setRealtimeDc(null);
            setMicrophoneEnabled(false);
            setMicrophoneConnecting(false);
            setRealtimeSpeaking(false);
            setSpeechPreparing(false);
            setCurrentExpression("relaxed");
            gapWordsRequestRef.current += 1;
            lastGapTranscriptRef.current = "";
            setGapWords([]);
            setGapWordsLoading(false);
            setGapWordsError(false);
            setMessages([]);
            setRealtimeMessages([]);
            setInput("");
            conversationNodeIdRef.current = crypto.randomUUID();
            lastSavedMessageCountRef.current = 0;
            lastMessageCountRef.current = 0;
            setConversationVersion((version) => version + 1);
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".uiOverlay input")?.focus());
        },
    }));

    const sendTypedMessage = async () => {
            const signal = conversationAbortRef.current.signal;
            const text = input.trim();

            if (!text) return;

            cancelSpeech();
            setInput("");
            void detectGapWords(text);

            /*setRealtimeMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: text,
                },
            ]);*/

            try {
                const session = await startRealtimeIfNeeded(false);
                const dc = session.dc as RTCDataChannel;

                await waitForDataChannelOpen(dc);

                console.log("Sending typed text to Realtime:", text);

                signal.throwIfAborted();
                sendRealtimeText(dc, text);
            } catch (error) {
                if (signal.aborted) return;
                console.error("Could not send typed realtime message:", error);

                setRealtimeMessages((prev) => [
                    ...prev,
                    {
                        role: "assistant",
                        content:
                            "Sorry, I could not send your typed message. Please check the console.",
                    },
                ]);
            }
        };
    /*18062026
    useEffect(() => {
            const handleFirstClick = async () => {
                await startRealtimeIfNeeded(true);
                window.removeEventListener("click", handleFirstClick);
            };

            window.addEventListener("click", handleFirstClick);

            return () => {
                window.removeEventListener("click", handleFirstClick);
            };
        }, [realtimeDc]);*/

    useEffect(() => subscribeSpeechPlayback(setSpeechPlaybackState), []);

    const toggleSpeechPlayback = () => {
        if (speechPlaybackState === "playing") {
            pauseSpeech();
        } else if (speechPlaybackState === "paused") {
            void resumeSpeech().catch((error) => {
                console.error("Could not resume speech:", error);
            });
        }
    };

    useEffect(() => {
        const handleSpace = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.repeat || speechPlaybackState === "idle") return;

            const target = event.target as HTMLElement | null;
            if (target?.matches("input, textarea, select, button") || target?.isContentEditable) return;

            event.preventDefault();
            if (speechPlaybackState === "playing") pauseSpeech();
            else void resumeSpeech().catch(console.error);
        };

        window.addEventListener("keydown", handleSpace);
        return () => window.removeEventListener("keydown", handleSpace);
    }, [speechPlaybackState]);

    // Microphone activation is explicit even when browser permission is already
    // granted, so the invitation remains until activated or dismissed.

    useEffect(() => {
        if (loadedMessages) return;

        const currentMessages = [...messages, ...realtimeMessages]
            .filter(
                (message): message is ChatMessage =>
                    (message.role === "user" || message.role === "assistant") &&
                    !(message.role === "user" && message.content.trim() === "...")
            );

        if (currentMessages.length < 2) return;

        if (currentMessages.length === lastSavedMessageCountRef.current) {
            return;
        }

        lastSavedMessageCountRef.current = currentMessages.length;

        upsertConversationNode(
            conversationNodeIdRef.current,
            currentMessages
        );
    }, [messages, realtimeMessages, loadedMessages]);

    // Track topic progress based on conversation exchanges
    useEffect(() => {
        const allMessages = [...messages, ...realtimeMessages];
        const assistantMessageCount = allMessages.filter(
            (msg) => msg.role === "assistant"
        ).length;

        // Increment progress when a new assistant message appears
        if (assistantMessageCount > lastMessageCountRef.current) {
            const topic = TOPIC_TREE.find((t) => t.id === selectedTopic);
            if (topic) {
                incrementTopicConversation(selectedTopic, topic.conversationsNeeded);
            }
            lastMessageCountRef.current = assistantMessageCount;
        }
    }, [messages, realtimeMessages, selectedTopic, incrementTopicConversation]);

    return (
        <div style={{ maxWidth: 1800, margin: "0 auto", padding: 20}}>
            {sceneStarted && (
                <Suspense fallback={null}>
                    <LazySceneView
                        isSpeaking={speakingText !== null || realtimeSpeaking}
                        expression={currentExpression}
                        avatarUrl={AVATAR_URLS[avatar]}
                    />
                </Suspense>
            )}

            <div className="avatarSwitcher" aria-label="Choose character">
                <button
                    type="button"
                    className={avatar === "male" ? "isActive" : ""}
                    onClick={() => selectAvatar("male")}
                    aria-pressed={avatar === "male"}
                >
                    <span className="avatarFullLabel">Male · Bob</span>
                    <span className="avatarShortLabel" aria-hidden="true">B</span>
                </button>
                <button
                    type="button"
                    className={avatar === "jenny" ? "isActive" : ""}
                    onClick={() => selectAvatar("jenny")}
                    aria-pressed={avatar === "jenny"}
                >
                    <span className="avatarFullLabel">Female · Jenny</span>
                    <span className="avatarShortLabel" aria-hidden="true">J</span>
                </button>
            </div>

            <div className="movementHint" aria-hidden="true">
                Click the room, then use <span>WASD</span> or arrow keys to walk
            </div>

            <div className="audioControls" aria-label="Voice playback controls">
                <button
                className="speechPlaybackButton"
                type="button"
                onClick={toggleSpeechPlayback}
                disabled={speechPreparing || speechPlaybackState === "idle"}
                aria-label={speechPreparing
                    ? "Preparing AI speech"
                    : speechPlaybackState === "playing" ? "Pause AI speech" : "Resume AI speech"}
                title={speechPreparing
                    ? "Preparing voice…"
                    : speechPlaybackState === "idle" ? "No AI speech to play" : "Pause or resume AI speech (Space)"}
            >
                    {speechPreparing ? (
                        <>
                            <LoaderCircle className="speechPreparingIcon" size={18} aria-hidden="true" />
                            <span className="speechPreparingBar" aria-hidden="true"><span /></span>
                        </>
                    ) : speechPlaybackState === "playing" ? (
                        <Pause size={19} fill="currentColor" />
                    ) : (
                        <Play size={19} fill="currentColor" />
                    )}
                </button>

                <label className="speechRateControl">
                    <span>Voice speed <strong>{Math.round(speechRate * 100)}%</strong></span>
                    <input
                        type="range"
                        min="0.55"
                        max="1"
                        step="0.05"
                        value={speechRate}
                        onChange={(event) => changeSpeechRate(Number(event.target.value))}
                        aria-label="Voice speaking speed"
                    />
                    <small><span>Slower</span><span>Normal</span></small>
                </label>
            </div>

            <ChatTranscript key={conversationVersion}
                messages={displayedMessages}
                loading={loading}
                assistantName={avatar === "jenny" ? "Jenny" : "Bob"}
            />

            {(gapWordsLoading || gapWordsError || gapWords.length > 0) && (
                <aside className="gapWordsPanel" aria-live="polite" aria-label="English word translations">
                    <div className="gapWordsHeader">
                        <div>
                            <small>WORDS YOU NEEDED</small>
                            <strong>English → target language</strong>
                        </div>
                        <button type="button" onClick={() => {
                            setGapWords([]);
                            setGapWordsError(false);
                        }} aria-label="Close word translations">×</button>
                    </div>
                    {gapWordsLoading && <span className="wordInfoLoading">Checking your vocabulary…</span>}
                    {gapWordsError && <span className="wordInfoError">Could not check this sentence.</span>}
                    {!gapWordsLoading && gapWords.map((word) => (
                        <div className="gapWordRow" key={`${word.original}-${word.translation}`}>
                            <span>{word.original}</span>
                            <strong>{word.translation}</strong>
                            <small>{word.pronunciation}</small>
                        </div>
                    ))}
                </aside>
            )}

            <button
                className="openPanelButton"
                type="button"
                onClick={() => setShowLanguagePanel((previous) => !previous)}
                aria-expanded={showLanguagePanel}
                aria-controls="language-panel"
                aria-label={`${selectedTopicLabel}. ${showLanguagePanel ? "Close" : "Open"} topic panel`}
                title={`${showLanguagePanel ? "Close" : "Open"} topic selection`}
            >
                <span>{selectedTopicLabel}</span>
                <span className="openPanelChevron" aria-hidden="true">
                    {showLanguagePanel ? "▴" : "▾"}
                </span>
            </button>

            <LanguagePanel
                open={showLanguagePanel}
                onClose={() => setShowLanguagePanel(false)}
                set1sentence={set1sentence}
                set2sentence={set2sentence}
                set4sentence={set4sentence}
                selectedTopic={selectedTopic}
                onTopicChange={handleTopicChange}
                progress={progress}
                onResetProgress={resetProgress}
            />

            <ChatInput key={conversationVersion}
                input={input}
                setInput={setInput}
                sendMessage={sendTypedMessage}
                microphoneEnabled={microphoneEnabled}
                microphoneConnecting={microphoneConnecting}
                toggleMicrophone={toggleMicrophone}
            />

        </div>
    );
}
