export type SpeechPlaybackState = "idle" | "playing" | "paused";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let activeOnEnd: (() => void) | null = null;
let requestId = 0;
let playbackState: SpeechPlaybackState = "idle";
let primedAudio: HTMLAudioElement | null = null;
const listeners = new Set<(state: SpeechPlaybackState) => void>();
type TimedWord = { word: string; start: number; end: number };
type SpeechRecord = {
    url: string;
    timings: Promise<TimedWord[]>;
    speed: number;
};
const speechRecords = new Map<string, SpeechRecord>();

// Mobile Safari only permits media playback after a direct user gesture. Prime
// one reusable element while the microphone button's click is still active, so
// the TTS response can use that same authorized element after its fetch finishes.
export function primeSpeechPlayback() {
    if (primedAudio) return;

    const audio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA");
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.volume = 0.01;
    primedAudio = audio;

    void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
    }).catch(() => {
        // A manual tap on Play remains available if Safari declines priming.
    });
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
    });
}

async function alignSpeech(blob: Blob, text: string): Promise<TimedWord[]> {
    const audio = await blobToBase64(blob);
    const response = await fetch("/api/audio-timestamps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, text }),
    });
    if (!response.ok) throw new Error(`Audio alignment failed: ${response.status}`);
    const data = await response.json() as { words?: TimedWord[] };
    return data.words ?? [];
}

function countSpeechCharacters(text: string) {
    return Array.from(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function setPlaybackState(state: SpeechPlaybackState) {
    playbackState = state;
    listeners.forEach((listener) => listener(state));
}

function releaseActiveAudio(notifyEnd: boolean) {
    const audio = activeAudio;
    const audioUrl = activeAudioUrl;
    const onEnd = activeOnEnd;

    activeAudio = null;
    activeAudioUrl = null;
    activeOnEnd = null;

    if (audio) {
        audio.onplay = null;
        audio.onpause = null;
        audio.onended = null;
        audio.pause();
        audio.currentTime = 0;
    }
    void audioUrl;
    if (notifyEnd) onEnd?.();
    setPlaybackState("idle");
}

export function subscribeSpeechPlayback(listener: (state: SpeechPlaybackState) => void) {
    listeners.add(listener);
    listener(playbackState);
    return () => {
        listeners.delete(listener);
    };
}

export function cancelSpeech() {
    requestId += 1;
    releaseActiveAudio(true);
}

export function pauseSpeech() {
    if (!activeAudio || activeAudio.paused) return;
    activeAudio.pause();
}

export async function resumeSpeech() {
    if (!activeAudio || !activeAudio.paused || activeAudio.ended) return;
    await activeAudio.play();
}

export async function seekSpeechToTextPosition(text: string, characterIndex: number) {
    const record = speechRecords.get(text);
    if (!record) return false;

    const words = await record.timings;
    if (words.length === 0) return false;

    const sourceLength = Math.max(1, countSpeechCharacters(text));
    const sourcePosition = countSpeechCharacters(text.slice(0, characterIndex));
    const alignedLength = Math.max(1, words.reduce(
        (total, word) => total + countSpeechCharacters(word.word),
        0
    ));
    const alignedPosition = sourcePosition / sourceLength * alignedLength;

    let elapsedCharacters = 0;
    let seekTime = words[0].start;
    for (const word of words) {
        const length = Math.max(1, countSpeechCharacters(word.word));
        if (alignedPosition <= elapsedCharacters + length) {
            const fraction = Math.max(0, Math.min(1, (alignedPosition - elapsedCharacters) / length));
            seekTime = word.start + (word.end - word.start) * fraction;
            break;
        }
        elapsedCharacters += length;
        seekTime = word.end;
    }

    cancelSpeech();
    const audio = new Audio(record.url);
    audio.playbackRate = record.speed;
    audio.preservesPitch = true;
    activeAudio = audio;
    activeAudioUrl = record.url;
    audio.currentTime = Math.max(0, seekTime - 0.04);
    audio.onplay = () => setPlaybackState("playing");
    audio.onpause = () => {
        if (activeAudio === audio && !audio.ended) setPlaybackState("paused");
    };
    audio.onended = () => {
        if (activeAudio === audio) releaseActiveAudio(false);
    };
    await audio.play();
    return true;
}

export async function speakText(
    text: string,
    onStart: () => void,
    onEnd: () => void,
    speed: number = 1
) {
    cancelSpeech();
    const thisRequestId = requestId;

    console.time("tts fetch");
    const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Generate the shorter normal-speed file, then slow playback locally.
        // This substantially reduces server generation and download time at
        // learner-friendly speeds such as 55%.
        body: JSON.stringify({ text, speed: 1 }),
    });
    console.timeEnd("tts fetch");

    if (!response.ok) {
        throw new Error(`TTS error ${response.status}: ${await response.text()}`);
    }

    const audioBlob = await response.blob();
    if (thisRequestId !== requestId) return;

    const audioUrl = URL.createObjectURL(audioBlob);
    const previousRecord = speechRecords.get(text);
    if (previousRecord) URL.revokeObjectURL(previousRecord.url);
    speechRecords.set(text, {
        url: audioUrl,
        speed,
        timings: alignSpeech(audioBlob, text).catch((error) => {
            console.error(error);
            return [];
        }),
    });
    while (speechRecords.size > 12) {
        const oldestKey = speechRecords.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldest = speechRecords.get(oldestKey);
        if (oldest?.url !== activeAudioUrl) URL.revokeObjectURL(oldest?.url ?? "");
        speechRecords.delete(oldestKey);
    }
    const audio = primedAudio ?? new Audio();
    primedAudio = null;
    audio.src = audioUrl;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.volume = 1;
    audio.playbackRate = Math.min(4, Math.max(0.25, speed));
    audio.preservesPitch = true;
    activeAudio = audio;
    activeAudioUrl = audioUrl;
    activeOnEnd = onEnd;

    audio.onplay = () => {
        onStart();
        setPlaybackState("playing");
    };
    audio.onpause = () => {
        if (activeAudio === audio && !audio.ended) setPlaybackState("paused");
    };
    audio.onended = () => {
        if (activeAudio === audio) releaseActiveAudio(true);
    };

    try {
        await audio.play();
    } catch (error) {
        // Keep fully prepared speech available. On iOS the user's next tap on
        // the now-enabled Play button resumes it inside a trusted gesture.
        if (activeAudio === audio && error instanceof DOMException && error.name === "NotAllowedError") {
            setPlaybackState("paused");
        }
        throw error;
    }
}
