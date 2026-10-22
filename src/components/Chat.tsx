import { lazy, Suspense, useImperativeHandle, useMemo, useState } from "react";
import type { CSSProperties, Ref } from "react";
import type { Message } from "../types/chat";

//08062026A import { useEffect, useRef } from 'react'
import { useEffect, useRef } from 'react'

import { loadStoredConversations, upsertConversationNode } from "../data/conversationStorage";
import { Mic, MicOff, Lock, Check, LoaderCircle, Pause, Play, PencilLine, MonitorPlay } from "lucide-react";
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
    subscribeSpeechPlayback,
    type SpeechPlaybackState,
} from "../utils/speakText";

import { GroupConversation, type DiagramRequest, type RaisedHand } from "../utils/groupConversation";
import type { DiagramSpec } from "../types/diagram";
import type { DiagramState, SketchEntry, SketchLibrary } from "./DiagramPanel";
import type { YouTubeHandle } from "./YouTubePanel";
import { formatTime, type VideoDetails } from "../types/youtube";
import { CHARACTERS, CHARACTER_BY_ID, type CharacterId } from "../data/characters";

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
                            onOpenDiagram,
                        }: {
    messages: Message[];
    loading: boolean;
    assistantName: string;
    onOpenDiagram: (message: Message) => void;
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
                        <strong style={msg.speaker && msg.speaker in CHARACTER_BY_ID ? { color: CHARACTER_BY_ID[msg.speaker as CharacterId].color } : undefined}>
                            {msg.role === "user" ? "You" : CHARACTER_BY_ID[msg.speaker as CharacterId]?.name ?? assistantName}:
                        </strong>{" "}
                        {msg.diagram ? (
                            <button type="button" className="transcriptSketch" onClick={() => onOpenDiagram(msg)}>
                                {msg.content} <span>Open sketch</span>
                            </button>
                        ) : <InteractiveText
                            text={msg.content}
                            onWord={showWordInfo}
                            onWordClick={msg.role === "assistant" ? (characterIndex) => {
                                void seekSpeechToTextPosition(msg.content, characterIndex).catch((error) => {
                                    console.error("Could not seek speech:", error);
                                });
                            } : undefined}
                        />}
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

/**
 * The group at a glance: tap someone to talk to them. When a friend raises
 * their hand, their teaser appears and the user decides whether they speak.
 */
function GroupBar({
    addressee,
    speakingId,
    hands,
    onAddress,
    onLetSpeak,
    onDismissHand,
}: {
    addressee: CharacterId;
    speakingId: CharacterId | null;
    hands: RaisedHand[];
    onAddress: (id: CharacterId) => void;
    onLetSpeak: (hand: RaisedHand) => void;
    onDismissHand: (id: CharacterId) => void;
}) {
    return (
        <div className="groupBar" aria-label="Group members">
            {hands.length > 0 && (
                <div className="raisedHands" role="status" aria-live="polite">
                    {hands.map((hand) => {
                        const character = CHARACTER_BY_ID[hand.id];
                        return (
                            <div className="raisedHand" key={hand.id} style={{ "--member-color": character.color } as CSSProperties}>
                                <span className="raisedHandText"><strong>{character.name} ✋</strong> “{hand.teaser}”</span>
                                <button type="button" className="raisedHandAllow" onClick={() => onLetSpeak(hand)}>
                                    Let {character.name} speak
                                </button>
                                <button
                                    type="button"
                                    className="raisedHandDismiss"
                                    onClick={() => onDismissHand(hand.id)}
                                    aria-label={`Not now, ${character.name}`}
                                    title="Not now"
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="groupMembers">
                {CHARACTERS.map((character) => {
                    const hasHand = hands.some((raised) => raised.id === character.id);
                    const isAddressed = addressee === character.id;
                    return (
                        <button
                            type="button"
                            key={character.id}
                            style={{ "--member-color": character.color } as CSSProperties}
                            className={`groupMemberButton${isAddressed ? " isAddressed" : ""}${speakingId === character.id ? " isSpeaking" : ""}`}
                            onClick={() => onAddress(character.id)}
                            aria-pressed={isAddressed}
                            title={isAddressed ? `You are talking to ${character.name}` : `Talk to ${character.name}`}
                        >
                            <span className="groupMemberName">{character.name}{hasHand && <span aria-hidden="true"> ✋</span>}</span>
                            <small>{isAddressed ? "Talking to you" : character.role}</small>
                        </button>
                    );
                })}
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
                           onFocusInput,
                       }: {
        input: string;
        setInput: (value: string) => void;
        sendMessage: () => void | Promise<void>;
        microphoneEnabled: boolean;
        microphoneConnecting: boolean;
        toggleMicrophone: () => void | Promise<void>;
        onFocusInput: () => void;
    }) {
        const [microphonePromptDismissed, setMicrophonePromptDismissed] = useState(false);

        return (
            <div className="uiOverlay">
                <div className="chatInputRow">
                    <input
                        value={input}
                        onFocus={onFocusInput}
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
const LazyDiagramPanel = lazy(() => import("./DiagramPanel"));
const LazyYouTubePanel = lazy(() => import("./YouTubePanel"));

/** What the group is told about the video the user is watching. */
function videoContext(video: VideoDetails) {
    const chapters = video.chapters.map((chapter) => `${formatTime(chapter.start)} ${chapter.title}`).join("; ");
    return [
        `[Video] The user is now watching on YouTube: "${video.title}" by ${video.channelTitle}`
            + (video.duration ? ` (${formatTime(video.duration)})` : "") + ` — https://youtu.be/${video.id}`,
        video.description && `Description: ${video.description.slice(0, 1500)}`,
        chapters && `Chapters: ${chapters}`,
    ].filter(Boolean).join("\n");
}
let sceneLoadingHideTimer = 0;

function updateSceneLoadingProgress(progress: number) {
    const percentage = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    document.documentElement.style.setProperty("--scene-progress", `${percentage}%`);
    const progressCard = document.querySelector<HTMLElement>(".sceneLoading");
    if (progressCard) {
        progressCard.dataset.progress = String(percentage);
        progressCard.setAttribute("aria-label", `${progressCard.dataset.label}: ${percentage}%`);
    }

    if (percentage === 100 && document.documentElement.dataset.avatarLoading === "true") {
        window.clearTimeout(sceneLoadingHideTimer);
        sceneLoadingHideTimer = window.setTimeout(() => {
            delete document.documentElement.dataset.avatarLoading;
        }, 450);
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
    const [showLanguagePanel, setShowLanguagePanel] =
        useState(false);
    const [currentExpression, setCurrentExpression] =
        useState("relaxed");
    const [sceneStarted, setSceneStarted] = useState(false);
    void setCurrentExpression;
    void detectExpression;

    useEffect(() => {
        updateSceneLoadingProgress(0.14);
    }, []);

    useEffect(() => {
        if (sceneStarted || pauseSceneStartup || showLanguagePanel) return;

        // Start once the first paint has settled. Interaction no longer postpones
        // it: the room is cheap now and loads quietly behind the poster.
        const start = () => {
            updateSceneLoadingProgress(0.24);
            setSceneStarted(true);
        };
        let startTimer = 0;
        let idleCallback = 0;
        // Safari has no requestIdleCallback.
        const hasIdleCallback = typeof window.requestIdleCallback === "function";
        if (hasIdleCallback) {
            idleCallback = window.requestIdleCallback(start, { timeout: 1500 });
        } else {
            startTimer = window.setTimeout(start, 300);
        }

        return () => {
            window.clearTimeout(startTimer);
            if (hasIdleCallback) window.cancelIdleCallback(idleCallback);
        };
    }, [sceneStarted, pauseSceneStartup, showLanguagePanel]);

    const { progress, incrementTopicConversation, resetProgress, markTopicVisited } =
        useTopicProgress();

    const conversationAbortRef = useRef(new AbortController());
    const [conversationVersion, setConversationVersion] = useState(0);
    const lastSavedMessageCountRef = useRef(0);
    const conversationNodeIdRef = useRef<string>(crypto.randomUUID());
    // No microphone track exists until a voice session has actually started.
    // Starting this as `true` made the UI look live while spoken audio was
    // silently ignored (notably when permission had not already been granted).
    const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
    const [microphoneConnecting, setMicrophoneConnecting] = useState(false);
    // Who the microphone and typed messages go to; others join when given the floor.
    const [addressee, setAddressee] = useState<CharacterId>("jenny");
    const [speakingId, setSpeakingId] = useState<CharacterId | null>(null);
    const [hands, setHands] = useState<RaisedHand[]>([]);
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

    const [diagram, setDiagram] = useState<DiagramState | null>(null);

    const drawDiagram = async (request: DiagramRequest) => {
        const signal = conversationAbortRef.current.signal;
        const artist = CHARACTER_BY_ID[request.id];
        const sketch = { artistName: artist.name, artistColor: artist.color, request: request.request };
        setDiagram({ ...sketch, status: "drawing" });
        try {
            const response = await fetch("/api/diagram", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request: request.request, depth: request.depth, lines: request.lines, artist: artist.name }),
                signal,
            });
            if (!response.ok) throw new Error(`Diagram failed: ${response.status}`);
            const spec = await response.json() as DiagramSpec;
            if (signal.aborted) return;
            const messageId = crypto.randomUUID();
            setDiagram({ ...sketch, status: "ready", spec, key: messageId });
            setRealtimeMessages((prev) => [...prev, { id: messageId, role: "assistant", speaker: request.id, content: `✏️ ${spec.title}`, diagram: spec }]);
            groupRef.current?.finishDiagram(request.id, request.callId, {
                ok: true,
                title: spec.title,
                boxes: spec.nodes.map((node) => node.label),
                takeaway: spec.takeaway,
            });
        } catch (error) {
            if (signal.aborted) return;
            console.error("Could not draw the sketch:", error);
            setDiagram({ ...sketch, status: "error" });
            groupRef.current?.finishDiagram(request.id, request.callId, { ok: false, error: "The whiteboard sketch failed this time." });
        }
    };

    const [youtubeOpen, setYoutubeOpen] = useState(false);
    const [video, setVideo] = useState<VideoDetails | null>(null);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const youtubeRef = useRef<YouTubeHandle>(null);
    const videoRef = useRef<VideoDetails | null>(null);
    videoRef.current = video;

    const videoPosition = () => {
        const playback = youtubeRef.current?.playback();
        const current = videoRef.current;
        if (!playback || !current) return null;
        const chapter = current.chapters.filter((item) => item.start <= playback.seconds).at(-1);
        return `${formatTime(playback.seconds)}${current.duration ? ` of ${formatTime(current.duration)}` : ""}, `
            + `${playback.playing ? "playing" : "paused"}${chapter ? `, chapter "${chapter.title}"` : ""}`;
    };

    const groupRef = useRef<GroupConversation | null>(null);
    const settingsRef = useRef("");
    // Message id of each character's reply that is still streaming.
    const replyIdsRef = useRef(new Map<CharacterId, string>());

    const ensureGroup = () => {
        if (groupRef.current) return groupRef.current;
        const replyIds = replyIdsRef.current;
        const group = new GroupConversation({
            onUserSpeechStart: () => {
                cancelSpeech();
                setSpeechPreparing(false);
            },
            onUserText: (text) => {
                void detectGapWords(text);
                // Replies start when speech ends, so the transcript often arrives
                // after a reply began; keep the user's line above that reply.
                const streaming = new Set(replyIds.values());
                setRealtimeMessages((prev) => {
                    const next = [...prev];
                    const insertAt = next.findIndex((message) => message.id !== undefined && streaming.has(message.id));
                    next.splice(insertAt === -1 ? next.length : insertAt, 0, { role: "user", content: text });
                    return next;
                });
                if (!streaming.size) setSpeechPreparing(true);
            },
            onReplyDelta: (id, text) => {
                let messageId = replyIds.get(id);
                if (!messageId) {
                    messageId = crypto.randomUUID();
                    replyIds.set(id, messageId);
                }
                const content = limitTextToSentences(text, sentenceCountRef.current);
                const replyId = messageId;
                setCurrentExpression(detectExpression(text));
                setSpeechPreparing(false);
                setRealtimeMessages((prev) => prev.some((message) => message.id === replyId)
                    ? prev.map((message) => message.id === replyId ? { ...message, content } : message)
                    : [...prev, { id: replyId, role: "assistant", speaker: id, content }]);
            },
            onReplyDone: (id, text) => {
                const replyId = replyIds.get(id);
                replyIds.delete(id);
                const content = limitTextToSentences(text, sentenceCountRef.current);
                setRealtimeMessages((prev) => replyId && prev.some((message) => message.id === replyId)
                    ? prev.map((message) => message.id === replyId ? { ...message, content } : message)
                    : [...prev, { id: crypto.randomUUID(), role: "assistant", speaker: id, content }]);
            },
            onReplyStopped: (id) => { replyIds.delete(id); },
            onSpeakingChange: (id) => {
                setSpeakingId(id);
                setRealtimeSpeaking(id !== null);
                setSpeechPlaybackState(id ? "playing" : "idle");
                if (id) setSpeechPreparing(false);
            },
            onHands: setHands,
            onAddresseeChange: setAddressee,
            onDiagramRequest: (request) => { void drawDiagram(request); },
            onConnectionError: (id, error) => {
                console.error(`${CHARACTER_BY_ID[id].name} could not join:`, error);
                setSpeechPreparing(false);
                setRealtimeMessages((prev) => [...prev, {
                    role: "assistant",
                    speaker: id,
                    content: "Sorry, I could not connect just now. Please try again.",
                }]);
            },
        }, conversationAbortRef.current.signal);
        group.updateSettings(settingsRef.current);
        if (videoRef.current) group.setVideoContext(videoContext(videoRef.current), videoPosition);
        groupRef.current = group;
        return group;
    };

    const addressCharacter = (id: CharacterId) => {
        primeSpeechPlayback();
        void ensureGroup().setAddressee(id).catch((error) => console.error("Could not switch speaker:", error));
    };

    const letCharacterSpeak = (hand: RaisedHand) => {
        primeSpeechPlayback();
        cancelSpeech();
        void ensureGroup().letSpeak(hand.id, hand.teaser).catch((error) => {
            if (!conversationAbortRef.current.signal.aborted) console.error("Could not give the floor:", error);
        });
    };

    const toggleMicrophone = async () => {
        // This runs synchronously inside the user's tap and unlocks delayed
        // playback on iPhone Safari.
        primeSpeechPlayback();
        const signal = conversationAbortRef.current.signal;
        const group = ensureGroup();

        // The mic pauses while a video plays; pressing it means "pause and let me talk".
        if (videoPlaying) {
            youtubeRef.current?.pause();
            if (microphoneEnabled) return;
        }

        if (microphoneEnabled) {
            group.setMicrophoneMuted(true);
            setMicrophoneEnabled(false);
            return;
        }

        setMicrophoneConnecting(true);
        try {
            await group.enableMicrophone();
            if (!signal.aborted) setMicrophoneEnabled(true);
        } catch (error) {
            if (signal.aborted) return;
            console.error("Could not enable the microphone:", error);
            setMicrophoneEnabled(false);
        } finally {
            if (!signal.aborted) setMicrophoneConnecting(false);
        }
    };

    const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);

    useEffect(() => {
        groupRef.current?.setVideoContext(video ? videoContext(video) : null, videoPosition);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video]);

    // The browser cannot cancel the YouTube player's sound from the microphone,
    // so the mic pauses while a video plays; otherwise the group answers the video.
    useEffect(() => {
        if (microphoneEnabled) groupRef.current?.setMicrophoneMuted(videoPlaying);
    }, [videoPlaying, microphoneEnabled]);

    const lastMessageCountRef = useRef(0);

    const updateRealtimeSession = (count?: number, topic?: string, rate?: number) => {
        const sentenceCountToUse = count !== undefined ? count : sentenceCount;
        const topicToUse = topic !== undefined ? topic : selectedTopic;
        const speechRateToUse = rate !== undefined ? rate : speechRate;

        if (count !== undefined) {
            setSentenceCount(count);
            sentenceCountRef.current = count;
        }

        const topicGuidance = topicToUse === FREE_CONVERSATION_TOPIC_ID
            ? "The user chose free conversation mode. Follow their interests and let them change subjects naturally. Do not steer them toward any particular topic."
            : `TOPIC FOCUS: ${getTopicInstructions(topicToUse)}\nGently guide the conversation toward this topic. Ask relevant questions and use appropriate vocabulary.\nIf the user goes off-topic, acknowledge their response briefly and guide back to the topic naturally.`;
        const paceInstruction = speechRateToUse < 0.7
            ? "Speak very slowly and clearly. Pause briefly between phrases and pronounce every word distinctly."
            : speechRateToUse < 0.9
            ? "Speak slowly and clearly. Use a calm pace with small pauses between phrases."
            : "Speak at a natural conversational pace while remaining clear.";

        settingsRef.current = `
Always answer with no more than ${sentenceCountToUse} sentence${sentenceCountToUse === 1 ? "" : "s"}, unless you were given the floor to jump in.
Finish each sentence with normal sentence-ending punctuation. Do not use semicolons or run-on sentences to evade this limit.
Each answer must contain useful conversational content, not only a short reaction such as "Great idea!" or "That sounds nice!".
${paceInstruction}
Aim for approximately ${Math.round(speechRateToUse * 100)}% of a normal conversational speaking rate.

${topicGuidance}
        `.trim();
        groupRef.current?.updateSettings(settingsRef.current);
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
    }, [selectedTopic]);

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
    } = useChatLogic(null, selectedTopic);

    const displayedMessages = (loadedMessages ?? [...messages, ...realtimeMessages])
        .filter((message) => !(message.role === "user" && message.content.trim() === "..."));

    // Saved conversations change rarely; reread them only when the history changes.
    const [historyVersion, setHistoryVersion] = useState(0);
    useEffect(() => {
        const refresh = () => setHistoryVersion((version) => version + 1);
        window.addEventListener("conversation-history-updated", refresh);
        return () => window.removeEventListener("conversation-history-updated", refresh);
    }, []);
    const storedConversations = useMemo(() => loadStoredConversations()
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyVersion]);

    const toSketch = (message: Message | ChatMessage, fallbackKey: string): SketchEntry => {
        const artist = CHARACTER_BY_ID[message.speaker as CharacterId] ?? CHARACTER_BY_ID.jenny;
        return { key: message.id ?? fallbackKey, spec: message.diagram!, artistName: artist.name, artistColor: artist.color };
    };
    const currentSketches = displayedMessages.flatMap((message, index) => message.diagram ? [toSketch(message, `current-${index}`)] : []);
    const shownSketches = new Set(currentSketches.map((entry) => entry.key));
    const sketchLibrary: SketchLibrary = {
        current: currentSketches,
        earlier: storedConversations
            .filter((conversation) => conversation.id !== conversationNodeIdRef.current)
            .map((conversation) => ({
                id: conversation.id,
                title: conversation.title,
                sketches: conversation.messages.flatMap((message, index) => message.diagram && !shownSketches.has(message.id ?? "")
                    ? [toSketch(message, `${conversation.id}-${index}`)]
                    : []),
            }))
            .filter((group) => group.sketches.length > 0),
    };
    const sketchCount = sketchLibrary.current.length + sketchLibrary.earlier.reduce((sum, group) => sum + group.sketches.length, 0);

    const openSketch = (entry: SketchEntry) => {
        setDiagram({ status: "ready", artistName: entry.artistName, artistColor: entry.artistColor, request: "", spec: entry.spec, key: entry.key });
    };
    const openLatestSketch = () => {
        const latest = sketchLibrary.current.at(-1) ?? sketchLibrary.earlier[0]?.sketches.at(-1);
        if (latest) openSketch(latest);
        else setDiagram({ status: "empty", artistName: "Group", artistColor: "#b9c9ff", request: "" });
    };

    useEffect(() => {
        if (conversationAbortRef.current.signal.aborted) conversationAbortRef.current = new AbortController();
        return () => {
            conversationAbortRef.current.abort();
            groupRef.current?.dispose();
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
            groupRef.current?.dispose();
            groupRef.current = null;
            replyIdsRef.current.clear();
            setAddressee("jenny");
            setSpeakingId(null);
            setHands([]);
            setDiagram(null);
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
                primeSpeechPlayback();
                await ensureGroup().sendText(text);
            } catch (error) {
                if (signal.aborted) return;
                console.error("Could not send typed group message:", error);

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
        const realtimeAudio = groupRef.current?.speakingAudio();
        if (realtimeAudio?.srcObject) {
            if (speechPlaybackState === "playing") {
                realtimeAudio.pause();
                setRealtimeSpeaking(false);
                setSpeechPlaybackState("paused");
            } else if (speechPlaybackState === "paused") {
                void realtimeAudio.play().then(() => {
                    setRealtimeSpeaking(true);
                    setSpeechPlaybackState("playing");
                }).catch((error) => console.error("Could not resume realtime speech:", error));
            }
            return;
        }

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
            toggleSpeechPlayback();
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
                        speakingId={speakingText !== null ? addressee : realtimeSpeaking ? speakingId : null}
                        addresseeId={addressee}
                        expression={currentExpression}
                        onProgress={updateSceneLoadingProgress}
                        onNavigate={addressCharacter}
                    />
                </Suspense>
            )}

            {diagram && (
                <Suspense fallback={null}>
                    <LazyDiagramPanel diagram={diagram} library={sketchLibrary} onOpen={openSketch} onClose={() => setDiagram(null)} />
                </Suspense>
            )}

            <button
                className="youtubeButton"
                type="button"
                onClick={() => setYoutubeOpen((open) => !open)}
                aria-expanded={youtubeOpen}
                aria-label="YouTube"
                data-tooltip="Watch YouTube together"
            >
                <MonitorPlay size={20} aria-hidden="true" />
            </button>

            {youtubeOpen && (
                <Suspense fallback={null}>
                    <LazyYouTubePanel
                        ref={youtubeRef}
                        duck={realtimeSpeaking}
                        micPaused={microphoneEnabled && videoPlaying}
                        onClose={() => {
                            setYoutubeOpen(false);
                            setVideo(null);
                            setVideoPlaying(false);
                        }}
                        onVideoChange={setVideo}
                        onPlayingChange={setVideoPlaying}
                    />
                </Suspense>
            )}

            <button
                className="sketchesButton"
                type="button"
                onClick={() => diagram ? setDiagram(null) : openLatestSketch()}
                aria-expanded={!!diagram}
                aria-label={`Sketches (${sketchCount})`}
                data-tooltip="Sketches"
            >
                <PencilLine size={20} aria-hidden="true" />
                {sketchCount > 0 && <span className="sketchesCount">{sketchCount}</span>}
            </button>

            <GroupBar
                addressee={addressee}
                speakingId={speakingId}
                hands={hands}
                onAddress={addressCharacter}
                onLetSpeak={letCharacterSpeak}
                onDismissHand={(id) => setHands((previous) => previous.filter((hand) => hand.id !== id))}
            />

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

            <ChatTranscript key={`transcript-${conversationVersion}`}
                messages={displayedMessages}
                loading={loading}
                assistantName={CHARACTER_BY_ID[addressee].name}
                onOpenDiagram={(message) => {
                    const entry = sketchLibrary.current.find((candidate) => candidate.spec === message.diagram);
                    if (entry) openSketch(entry);
                }}
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

            <ChatInput key={`input-${conversationVersion}`}
                input={input}
                setInput={setInput}
                sendMessage={sendTypedMessage}
                microphoneEnabled={microphoneEnabled}
                microphoneConnecting={microphoneConnecting}
                toggleMicrophone={toggleMicrophone}
                onFocusInput={() => void ensureGroup().connect(addressee).catch(() => {})}
            />

        </div>
    );
}
