import { lazy, Suspense, useImperativeHandle, useMemo, useState } from "react";
import { outdoorInput } from "./outdoor/input";
import type { CSSProperties, Ref } from "react";
import type { Message } from "../types/chat";

//08062026A import { useEffect, useRef } from 'react'
import { useEffect, useRef } from 'react'

import { loadStoredConversations, upsertConversationNode } from "../data/conversationStorage";
import { Mic, MicOff, Lock, Check, LoaderCircle, Pause, Play, PencilLine } from "lucide-react";
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
import type { YouTubeHandle, YouTubeRequest } from "./YouTubePanel";
import { formatTime, type VideoDetails } from "../types/youtube";
import { CHARACTERS, CHARACTER_BY_ID, characterBySpeaker, type CharacterId } from "../data/characters";

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
                        <strong style={characterBySpeaker(msg.speaker) ? { color: characterBySpeaker(msg.speaker)!.color } : undefined}>
                            {msg.role === "user" ? "You" : characterBySpeaker(msg.speaker)?.name ?? assistantName}:
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

/** Languages the user can speak in; the transcriber is told which one instead of guessing. */
const SPEECH_LANGUAGES: { code: string; name: string; english: string }[] = [
    { code: "de", name: "Deutsch", english: "German" },
    { code: "en", name: "English", english: "English" },
    { code: "fr", name: "Français", english: "French" },
    { code: "es", name: "Español", english: "Spanish" },
    { code: "it", name: "Italiano", english: "Italian" },
    { code: "pt", name: "Português", english: "Portuguese" },
    { code: "nl", name: "Nederlands", english: "Dutch" },
    { code: "pl", name: "Polski", english: "Polish" },
    { code: "tr", name: "Türkçe", english: "Turkish" },
    { code: "ru", name: "Русский", english: "Russian" },
    { code: "uk", name: "Українська", english: "Ukrainian" },
    { code: "sv", name: "Svenska", english: "Swedish" },
    { code: "ja", name: "日本語", english: "Japanese" },
    { code: "zh", name: "中文", english: "Chinese" },
    { code: "ko", name: "한국어", english: "Korean" },
    { code: "ar", name: "العربية", english: "Arabic" },
];
const AUTO_LANGUAGE = "auto";
const transcriptionLanguage = (code: string) => code === AUTO_LANGUAGE ? null : code;
const SPEECH_LANGUAGE_KEY = "speechLanguage";

/** The saved choice, else the browser's language (closer to what people speak than their location). */
function initialSpeechLanguage() {
    try {
        const saved = localStorage.getItem(SPEECH_LANGUAGE_KEY);
        if (saved && (saved === AUTO_LANGUAGE || SPEECH_LANGUAGES.some((language) => language.code === saved))) return saved;
    } catch {
        // Storage can be unavailable; fall back to the browser language.
    }
    const browser = navigator.language.split("-")[0];
    return SPEECH_LANGUAGES.some((language) => language.code === browser) ? browser : AUTO_LANGUAGE;
}

// Small talk stays short either way; the limit only caps longer explanations.
const SENTENCE_OPTIONS = [
    { count: 1, label: "short" },
    { count: 3, label: "normal" },
    { count: 5, label: "detailed" },
];

function LanguagePanel({
                           open,
                           onClose,
                           sentenceCount,
                           onSentenceCount,
                           speechLanguage,
                           onSpeechLanguage,
                           selectedTopic,
                           onTopicChange,
                           progress,
                           onResetProgress,
                       }: {
    open: boolean;
    onClose: () => void;
    sentenceCount: number;
    onSentenceCount: (count: number) => void;
    speechLanguage: string;
    onSpeechLanguage: (code: string) => void;
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

            <h3 style={{ marginTop: 20, fontSize: "0.9rem" }}>I speak:</h3>
            <select
                value={speechLanguage}
                onChange={(event) => onSpeechLanguage(event.target.value)}
                aria-label="Language you speak in"
                style={{ width: "100%", padding: "6px 8px" }}
            >
                {SPEECH_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>{language.name}</option>
                ))}
                <option value={AUTO_LANGUAGE}>Auto-detect (several languages)</option>
            </select>

            <h3 style={{ marginTop: 20, fontSize: "0.9rem" }}>Sentences per answer (at most):</h3>
            <div style={{ display: "flex", gap: 8 }}>
                {SENTENCE_OPTIONS.map(({ count, label }) => (
                    <button
                        key={count}
                        onClick={() => onSentenceCount(count)}
                        aria-pressed={sentenceCount === count}
                        style={{
                            flex: 1,
                            fontWeight: sentenceCount === count ? 700 : 400,
                            outline: sentenceCount === count ? "2px solid #7aa7ff" : "none",
                        }}
                    >
                        {count} · {label}
                    </button>
                ))}
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

/** Walking hints outside; a joystick on touch screens. */
function OutdoorHelp() {
    const [showHint, setShowHint] = useState(true);
    const touch = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
    const knob = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const timer = window.setTimeout(() => setShowHint(false), 7000);
        return () => {
            window.clearTimeout(timer);
            outdoorInput.x = 0;
            outdoorInput.y = 0;
        };
    }, []);

    const steer = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
        const dy = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
        const length = Math.min(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        outdoorInput.x = Math.cos(angle) * length;
        outdoorInput.y = -Math.sin(angle) * length;
        if (knob.current) knob.current.style.transform = `translate(${Math.cos(angle) * length * 28}px, ${Math.sin(angle) * length * 28}px)`;
    };
    const release = () => {
        outdoorInput.x = 0;
        outdoorInput.y = 0;
        if (knob.current) knob.current.style.transform = "";
    };

    return (
        <>
            {showHint && (
                <p className="outdoorHint" role="status">
                    {touch
                        ? "Joystick to walk · ⤒ to jump · drag to look around"
                        : "WASD or arrow keys to walk · Shift to run · Space to jump · drag to look around"}
                </p>
            )}
            <Suspense fallback={null}>
                <LazyMinimap size={touch ? 124 : 176} />
            </Suspense>
            {touch && (
                <button
                    type="button"
                    className="outdoorJump"
                    aria-label="Jump"
                    onPointerDown={(event) => { event.preventDefault(); outdoorInput.jump = true; }}
                >
                    ⤒
                </button>
            )}
            {touch && (
                <div
                    className="outdoorJoystick"
                    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); steer(event); }}
                    onPointerMove={(event) => { if (event.buttons) steer(event); }}
                    onPointerUp={release}
                    onPointerCancel={release}
                    aria-label="Walk"
                >
                    <div ref={knob} />
                </div>
            )}
        </>
    );
}

/** What to tell the user when the microphone could not be switched on, instead of failing silently. */
function microphoneErrorMessage(error: unknown) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
        // Chrome also takes the permission back from sites that were not visited for a while.
        return "Your browser is blocking the microphone. Click the icon left of the address bar, allow the microphone, then try again.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found. Plug one in or check your system's sound settings.";
    if (name === "NotReadableError" || name === "AbortError") return "The microphone is busy or unavailable. Close other apps using it, then try again.";
    return "The voice chat could not connect. Please try again in a moment.";
}

function ChatInput({
                           input,
                           setInput,
                           sendMessage,
                           microphoneEnabled,
                           microphoneConnecting,
                           microphoneError,
                           onDismissMicrophoneError,
                           toggleMicrophone,
                           onFocusInput,
                       }: {
        input: string;
        setInput: (value: string) => void;
        sendMessage: () => void | Promise<void>;
        microphoneEnabled: boolean;
        microphoneConnecting: boolean;
        microphoneError: string | null;
        onDismissMicrophoneError: () => void;
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
                        {microphoneError && (
                            <div className="microphonePrompt microphoneError" role="alert">
                                <p>{microphoneError}</p>
                                <button
                                    className="microphonePromptClose"
                                    type="button"
                                    onClick={onDismissMicrophoneError}
                                    aria-label="Dismiss microphone message"
                                    title="Dismiss"
                                >
                                    ×
                                </button>
                            </div>
                        )}
                        {!microphoneError && !microphoneEnabled && !microphonePromptDismissed && (
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
const LazyMinimap = lazy(() => import("./outdoor/Minimap"));

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
    const [microphoneError, setMicrophoneError] = useState<string | null>(null);
    // Who the microphone and typed messages go to; others join when given the floor.
    const [addressee, setAddressee] = useState<CharacterId>("jenny");
    const [speakingId, setSpeakingId] = useState<CharacterId | null>(null);
    const [hands, setHands] = useState<RaisedHand[]>([]);
    const [speechRate, setSpeechRate] = useState(1);
    const speechRateRef = useRef(speechRate);
    const [sentenceCount, setSentenceCount] = useState(3);
    const [speechLanguage, setSpeechLanguage] = useState(initialSpeechLanguage);
    const speechLanguageRef = useRef(speechLanguage);
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
    // What to show when the viewer is opened from a character's PC.
    const [youtubeRequest, setYoutubeRequest] = useState<YouTubeRequest | null>(null);
    const [focusPc, setFocusPc] = useState<CharacterId | null>(null);
    const [outside, setOutside] = useState(false);
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
        group.updateSettings(settingsRef.current, speechRateRef.current, transcriptionLanguage(speechLanguageRef.current));
        if (videoRef.current) group.setVideoContext(videoContext(videoRef.current), videoPosition);
        groupRef.current = group;
        return group;
    };

    const addressCharacter = (id: CharacterId) => {
        primeSpeechPlayback();
        setFocusPc(null);
        // Picking someone takes you back inside to their room.
        setOutside(false);
        void ensureGroup().setAddressee(id).catch((error) => console.error("Could not switch speaker:", error));
    };

    /** Sitting down at a character's PC also means talking to them. */
    const focusOnPc = (id: CharacterId | null) => {
        if (id && id !== addressee) addressCharacter(id);
        setFocusPc(id);
    };

    useEffect(() => {
        if (!focusPc) return;
        const leave = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusPc(null); };
        window.addEventListener("keydown", leave);
        return () => window.removeEventListener("keydown", leave);
    }, [focusPc]);

    const openYouTube = (request: { feed: CharacterId; videoId?: string }) => {
        setYoutubeRequest({ ...request, nonce: Date.now() });
        setYoutubeOpen(true);
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
        setMicrophoneError(null);
        try {
            await group.enableMicrophone();
            if (!signal.aborted) setMicrophoneEnabled(true);
        } catch (error) {
            if (signal.aborted) return;
            console.error("Could not enable the microphone:", error);
            setMicrophoneEnabled(false);
            setMicrophoneError(microphoneErrorMessage(error));
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

    const updateRealtimeSession = (count?: number, topic?: string, rate?: number, language?: string) => {
        const languageToUse = language ?? speechLanguageRef.current;
        const spokenLanguage = SPEECH_LANGUAGES.find((item) => item.code === languageToUse);
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
That is a maximum, not a target: answer like a person in a spoken conversation and match the weight of what the user said.
Small talk ("How are you?", "Hi") gets a short, casual reply, often just a few words; then let the user lead.
Avoid empty filler such as "Great idea!" or "That sounds nice!" on its own.
${paceInstruction}
${spokenLanguage ? `The user speaks ${spokenLanguage.english} with you. Reply in the language the user actually uses. If a transcript of their speech
looks like another language or gibberish, it is almost certainly a mistranscription of ${spokenLanguage.english}: answer in ${spokenLanguage.english}.
Switch languages only when the user clearly asks for it or clearly keeps writing in another language.` : "Reply in the language the user speaks."}

${topicGuidance}
        `.trim();
        groupRef.current?.updateSettings(settingsRef.current, speechRateToUse, transcriptionLanguage(languageToUse));
    };


    const changeSpeechLanguage = (code: string) => {
        setSpeechLanguage(code);
        speechLanguageRef.current = code;
        try {
            localStorage.setItem(SPEECH_LANGUAGE_KEY, code);
        } catch {
            // Only remembered for this visit then.
        }
        updateRealtimeSession(undefined, undefined, undefined, code);
    };

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
        const artist = characterBySpeaker(message.speaker) ?? CHARACTER_BY_ID.jenny;
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
        // A realtime stream, or an expressive voice playing a file.
        if (realtimeAudio?.srcObject || realtimeAudio?.getAttribute("src")) {
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
            // Outside, Space jumps.
            if (event.code !== "Space" || event.repeat || speechPlaybackState === "idle" || outside) return;

            const target = event.target as HTMLElement | null;
            if (target?.matches("input, textarea, select, button") || target?.isContentEditable) return;

            event.preventDefault();
            toggleSpeechPlayback();
        };

        window.addEventListener("keydown", handleSpace);
        return () => window.removeEventListener("keydown", handleSpace);
    }, [speechPlaybackState, outside]);

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
                        focusPcId={focusPc}
                        onFocusPc={focusOnPc}
                        onOpenYouTube={openYouTube}
                        outside={outside}
                        onOutsideChange={(value) => {
                            setFocusPc(null);
                            setOutside(value);
                        }}
                    />
                </Suspense>
            )}

            {diagram && (
                <Suspense fallback={null}>
                    <LazyDiagramPanel diagram={diagram} library={sketchLibrary} onOpen={openSketch} onClose={() => setDiagram(null)} />
                </Suspense>
            )}

            {!focusPc && sceneStarted && (
                <button
                    type="button"
                    className="pcBackButton"
                    onClick={() => {
                        setFocusPc(null);
                        setOutside((value) => !value);
                    }}
                >
                    {outside ? "🏠 Back inside" : "🌲 Go outside"}
                </button>
            )}
            {outside && <OutdoorHelp />}

            {focusPc && !youtubeOpen && (
                <button type="button" className="pcBackButton" onClick={() => setFocusPc(null)}>
                    ← Back to {CHARACTER_BY_ID[focusPc].name}
                </button>
            )}

            <button
                className="youtubeButton"
                type="button"
                onClick={() => {
                    setYoutubeRequest(null);
                    setYoutubeOpen((open) => !open);
                }}
                aria-expanded={youtubeOpen}
                aria-label="Watch YouTube together"
                data-tooltip="Watch videos together with the group"
            >
                <svg className="youtubeLogo" viewBox="0 0 28 20" aria-hidden="true">
                    <path d="M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 14 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2.6 11 .6 11 .6s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z" fill="#FF0000" />
                    <path d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" fill="#fff" />
                </svg>
                <span className="youtubeLabel">YouTube</span>
            </button>

            {youtubeOpen && (
                <Suspense fallback={null}>
                    <LazyYouTubePanel
                        ref={youtubeRef}
                        request={youtubeRequest}
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
                sentenceCount={sentenceCount}
                onSentenceCount={(count) => updateRealtimeSession(count)}
                speechLanguage={speechLanguage}
                onSpeechLanguage={changeSpeechLanguage}
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
                microphoneError={microphoneError}
                onDismissMicrophoneError={() => setMicrophoneError(null)}
                toggleMicrophone={toggleMicrophone}
                onFocusInput={() => void ensureGroup().connect(addressee).catch(() => {})}
            />

        </div>
    );
}
