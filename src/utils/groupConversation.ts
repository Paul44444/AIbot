import { sendRealtimeText, startRealtimeVoiceSession } from "./realtimeVoice";
import { describeFeed, loadFeed } from "./characterFeed";
import {
    CHARACTERS,
    CHARACTER_BY_ID,
    DRAW_DIAGRAM_TOOL,
    characterInstructions,
    interjectionInstructions,
    withoutStageDirections,
    type CharacterId,
} from "../data/characters";

type Session = Awaited<ReturnType<typeof startRealtimeVoiceSession>>;

export type RaisedHand = { id: CharacterId; teaser: string };

export type DiagramRequest = {
    id: CharacterId;
    callId: string;
    request: string;
    depth: "simple" | "rich";
    lines: { speaker: string; text: string }[];
};

export type GroupCallbacks = {
    onUserSpeechStart: () => void;
    onUserText: (text: string) => void;
    onReplyDelta: (id: CharacterId, text: string) => void;
    onReplyDone: (id: CharacterId, text: string) => void;
    /** The reply was cut off; whatever was shown so far stays as it is. */
    onReplyStopped: (id: CharacterId) => void;
    onSpeakingChange: (id: CharacterId | null) => void;
    onHands: (hands: RaisedHand[]) => void;
    onAddresseeChange: (id: CharacterId) => void;
    onConnectionError: (id: CharacterId, error: unknown) => void;
    /** A character wants to sketch; answer with finishDiagram once it is drawn. */
    onDiagramRequest: (request: DiagramRequest) => void;
};

const HISTORY_FOR_LATE_JOINERS = 12;
/** Lines of the conversation a character's own model reads for each reply. */
const BRAIN_HISTORY = 60;

/** Characters with an expressive voice reply in text, which /api/voice then performs. */
function outputModalities(id: CharacterId) {
    return CHARACTER_BY_ID[id].expressiveVoice ? ["text"] : ["audio"];
}

/** Characters whose replies come from their own text model; their realtime session only listens. */
function hasBrain(id: CharacterId) {
    return Boolean(CHARACTER_BY_ID[id].brainModel);
}

/** Web search answers may carry markdown links and URLs; none of that can be spoken. */
function speakable(text: string) {
    return text
        .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
        .replace(/\[([^\]]+)\]\((?:https?:)?[^)\s]*\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\*\*|__|^#+\s*/gm, "");
}

/**
 * The next piece of a reply worth sending to the voice: the first as soon as one
 * sentence is complete (to start talking early), later ones in bigger chunks so the
 * voice keeps its flow. Never cuts inside a stage direction.
 */
function takeSegment(text: string, minimumLength: number): [string, string] | null {
    const sentenceEnd = /[.!?…]+["“”'»)]*\s+/g;
    let match: RegExpExecArray | null;
    while ((match = sentenceEnd.exec(text)) !== null) {
        const end = match.index + match[0].length;
        if (end < minimumLength) continue;
        const piece = text.slice(0, end);
        if (piece.lastIndexOf("[") > piece.lastIndexOf("]")) continue;
        return [piece, text.slice(end)];
    }
    return null;
}

function waitForOpen(dc: RTCDataChannel) {
    if (dc.readyState === "open") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Realtime data channel did not open")), 10_000);
        dc.addEventListener("open", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    });
}

/** "Jinx, what do you think?" or "…right, Smyth?" addresses that character. */
export function addressedCharacter(text: string): CharacterId | null {
    const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
    const edges = [...words.slice(0, 3), ...words.slice(-3)];
    return CHARACTERS.find((character) => edges.includes(character.name.toLowerCase()))?.id ?? null;
}

/**
 * Runs the group: one Realtime session per character (a session's voice is
 * fixed once it spoke). The microphone is attached only to the character the
 * user is addressing, who answers directly via server VAD. Everyone else hears
 * the conversation as system lines, so they can react when given the floor.
 */
export class GroupConversation {
    private sessions = new Map<CharacterId, Promise<Session>>();
    private ready = new Map<CharacterId, Session>();
    private microphone: MediaStream | null = null;
    private addressee: CharacterId = "jenny";
    private settings = "";
    /** Playback speed of every voice (the API allows 0.25–1.5; 1 is normal). */
    private speed = 1;
    /** ISO 639-1 code the user's speech is transcribed in; null lets the transcriber guess. */
    private language: string | null = null;
    private lines: { speaker: string; text: string }[] = [];
    private replies = new Map<CharacterId, string>();
    private speaking: CharacterId | null = null;
    /**
     * An expressive voice performing a reply, piece by piece as it is written; one
     * at a time, like everyone else. `finished` once no more pieces will follow.
     */
    private performance: { id: CharacterId; pieces: { text: string; audio?: HTMLAudioElement }[]; index: number; finished: boolean } | null = null;
    /** Whose expressive reply is being fetched or played. */
    private voicing: CharacterId | null = null;
    /** Replies being written by a character's own model. */
    private thinking = new Map<CharacterId, AbortController>();
    /** Function calls and their results for characters with their own model, kept at their place in the lines. */
    private toolItems = new Map<CharacterId, { at: number; item: Record<string, string> }[]>();
    private directorRun = 0;
    // Hands go up once the current speaker has finished, not while they talk.
    private pendingHands: RaisedHand[] | null = null;
    // Nobody raises a hand while someone is busy sketching.
    private sketching = false;
    /** What the user is watching on YouTube, told to everyone (also late joiners). */
    private videoContext: string | null = null;
    /** Where the user is in that video right now, told before each of their turns. */
    private videoPosition: (() => string | null) | null = null;

    private callbacks: GroupCallbacks;
    private signal: AbortSignal;

    constructor(callbacks: GroupCallbacks, signal: AbortSignal) {
        this.callbacks = callbacks;
        this.signal = signal;
    }

    get currentAddressee() {
        return this.addressee;
    }

    speakingAudio() {
        if (this.speaking && this.speaking === this.voicing) return this.performance?.pieces[this.performance.index]?.audio ?? null;
        return this.speaking ? this.ready.get(this.speaking)?.audioEl ?? null : null;
    }

    updateSettings(settings: string, speed: number, language: string | null) {
        this.settings = settings;
        this.speed = speed;
        this.language = language;
        for (const [id, session] of this.ready) this.sendInstructions(id, session);
    }

    async enableMicrophone() {
        if (!this.microphone) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (this.signal.aborted) {
                stream.getTracks().forEach((track) => track.stop());
                this.signal.throwIfAborted();
            }
            this.microphone = stream;
        }
        this.setMicrophoneMuted(false);
        await this.attachMicrophone();
    }

    setMicrophoneMuted(muted: boolean) {
        this.microphone?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    }

    async setAddressee(id: CharacterId) {
        if (this.addressee !== id) {
            this.addressee = id;
            this.callbacks.onAddresseeChange(id);
        }
        await this.attachMicrophone();
    }

    async sendText(text: string) {
        const target = addressedCharacter(text) ?? this.addressee;
        this.interruptAll();
        this.callbacks.onHands([]);
        await this.setAddressee(target);
        if (hasBrain(target)) {
            this.recordUserLine(text, target, target);
            this.callbacks.onUserText(text);
            void this.think(target);
            return;
        }
        const session = await this.connect(target);
        this.signal.throwIfAborted();
        this.tellVideoPosition(target);
        this.recordUserLine(text, target, target);
        this.callbacks.onUserText(text);
        sendRealtimeText(session.dc, text);
    }

    /** The user gives the floor to someone who raised their hand. */
    async letSpeak(id: CharacterId, teaser: string) {
        this.callbacks.onHands([]);
        this.interruptAll();
        if (hasBrain(id)) {
            void this.setAddressee(id);
            void this.think(id, interjectionInstructions(CHARACTER_BY_ID[id], this.settings, teaser));
            return;
        }
        const session = await this.connect(id);
        this.signal.throwIfAborted();
        // The user will most likely answer whoever just spoke.
        void this.setAddressee(id);
        session.dc.send(JSON.stringify({
            type: "response.create",
            response: {
                output_modalities: outputModalities(id),
                instructions: interjectionInstructions(CHARACTER_BY_ID[id], this.settings, teaser),
            },
        }));
    }

    /** Tells the character how the sketch went, so they explain it (or apologise). */
    finishDiagram(id: CharacterId, callId: string, result: object) {
        this.sketching = false;
        if (hasBrain(id)) {
            this.toolItems.get(id)?.push({ at: this.lines.length, item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) } });
            void this.think(id);
            return;
        }
        const session = this.ready.get(id);
        if (!session || session.dc.readyState !== "open") return;
        session.dc.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
        }));
        session.dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: outputModalities(id) } }));
    }

    setVideoContext(context: string | null, position: (() => string | null) | null) {
        if (context === this.videoContext) return;
        this.videoContext = context;
        this.videoPosition = position;
        const line = context ?? "[Video] The user closed the video.";
        for (const id of this.ready.keys()) this.inject(id, line);
    }

    /** Tells the addressed character where the user is in the video, right before their turn. */
    private tellVideoPosition(id: CharacterId) {
        const position = this.videoContext ? this.videoPosition?.() : null;
        if (position) this.inject(id, `[Video position] ${position}`);
    }

    dismissHands() {
        this.directorRun += 1;
        this.pendingHands = null;
        this.callbacks.onHands([]);
    }

    dispose() {
        this.directorRun += 1;
        this.microphone?.getTracks().forEach((track) => track.stop());
        this.microphone = null;
        for (const session of this.ready.values()) session.dispose();
        for (const controller of this.thinking.values()) controller.abort();
        this.stopVoice();
    }

    connect(id: CharacterId) {
        let pending = this.sessions.get(id);
        if (pending) return pending;

        const character = CHARACTER_BY_ID[id];
        pending = (async () => {
            const session = await startRealtimeVoiceSession({
                microphone: false,
                sendAudio: true,
                voice: character.voice,
                signal: this.signal,
                onUserSpeechStart: () => this.handleUserSpeechStart(),
                onUserTextDone: (text) => this.handleUserTranscript(id, text),
                onAssistantTextDelta: (delta) => {
                    const text = (this.replies.get(id) ?? "") + delta;
                    this.replies.set(id, text);
                    this.callbacks.onReplyDelta(id, withoutStageDirections(text));
                },
                onAssistantTextDone: () => this.handleReplyDone(id),
                onAudioStart: () => this.setSpeaking(id),
                onAudioDone: () => { if (this.speaking === id) this.setSpeaking(null); },
                onFunctionCall: (call) => this.handleFunctionCall(id, call),
            });
            await waitForOpen(session.dc);
            this.signal.throwIfAborted();
            this.ready.set(id, session);
            this.sendInstructions(id, session);
            // Late joiners catch up on what was said before they connected.
            for (const line of this.lines.slice(-HISTORY_FOR_LATE_JOINERS)) {
                if (line.speaker !== character.name) this.inject(id, `[${line.speaker}]: ${line.text}`);
            }
            if (this.videoContext) this.inject(id, this.videoContext);
            // Something real and recent to talk about; it arrives a moment later, without delaying the call.
            void loadFeed(id).then((feed) => {
                if (!this.signal.aborted && feed.videos.length) this.inject(id, describeFeed(feed));
            }).catch(() => {});
            // Not attachMicrophone(): it waits for this very connection and would never resolve.
            if (id === this.addressee) await this.routeMicrophone();
            return session;
        })();
        pending.catch((error) => {
            this.sessions.delete(id);
            if (!this.signal.aborted) this.callbacks.onConnectionError(id, error);
        });
        this.sessions.set(id, pending);
        return pending;
    }

    private async attachMicrophone() {
        if (!this.microphone) return;
        await this.connect(this.addressee);
        await this.routeMicrophone();
    }

    /** Sends the mic to the addressee's session only, among those already connected. */
    private async routeMicrophone() {
        const track = this.microphone?.getAudioTracks()[0] ?? null;
        if (!track) return;
        await Promise.all([...this.ready].map(([id, session]) =>
            session.setMicrophoneTrack(id === this.addressee ? track : null)));
    }

    private sendInstructions(id: CharacterId, session: Session) {
        if (session.dc.readyState !== "open") return;
        if (hasBrain(id)) {
            // Only listens: transcribes the user and never answers by itself.
            session.dc.send(JSON.stringify({
                type: "session.update",
                session: {
                    type: "realtime",
                    output_modalities: ["text"],
                    instructions: "You only listen. Never reply.",
                    audio: {
                        input: {
                            transcription: { model: "gpt-4o-mini-transcribe", ...(this.language ? { language: this.language } : {}) },
                            turn_detection: { type: "server_vad", create_response: false, interrupt_response: false },
                        },
                    },
                    tools: [],
                },
            }));
            return;
        }
        session.dc.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: outputModalities(id),
                instructions: characterInstructions(CHARACTER_BY_ID[id], this.settings),
                // Real time-stretching; asking for a slower pace in the instructions barely works.
                audio: {
                    // Guessing the language per utterance mistakes short or quiet German for Japanese or Swedish.
                    input: { transcription: { model: "gpt-4o-mini-transcribe", ...(this.language ? { language: this.language } : {}) } },
                    output: { speed: this.speed },
                },
                tools: [DRAW_DIAGRAM_TOOL],
                tool_choice: "auto",
            },
        }));
    }

    private inject(id: CharacterId, text: string) {
        // A character with their own model reads the whole conversation on every reply instead.
        if (hasBrain(id)) return;
        const session = this.ready.get(id);
        if (!session || session.dc.readyState !== "open") return;
        session.dc.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
        }));
    }

    private injectIntoOthers(exceptId: CharacterId, text: string) {
        for (const id of this.ready.keys()) if (id !== exceptId) this.inject(id, text);
    }

    private recordUserLine(text: string, to: CharacterId, heardBy: CharacterId) {
        const speaker = `User to ${CHARACTER_BY_ID[to].name}`;
        this.lines.push({ speaker, text });
        this.injectIntoOthers(heardBy, `[${speaker}]: ${text}`);
    }

    private stop(id: CharacterId) {
        const session = this.ready.get(id);
        const open = session?.dc.readyState === "open";
        if (hasBrain(id)) {
            this.thinking.get(id)?.abort();
        } else {
            if (!open) return;
            // The text of a reply finishes before its audio; cancel only what is still running.
            if (this.replies.has(id)) session!.dc.send(JSON.stringify({ type: "response.cancel" }));
            if (this.speaking === id && !CHARACTER_BY_ID[id].expressiveVoice) {
                session!.dc.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
            }
        }
        if (this.voicing === id) this.stopVoice();
        const partial = withoutStageDirections(this.replies.get(id) ?? "");
        this.replies.delete(id);
        if (partial) {
            const name = CHARACTER_BY_ID[id].name;
            this.lines.push({ speaker: name, text: `${partial} (interrupted)` });
            this.injectIntoOthers(id, `[${name}]: ${partial} (interrupted)`);
        }
        this.callbacks.onReplyStopped(id);
    }

    /** Only one voice at a time: whoever starts talking cuts off the others. */
    private interruptAll(except?: CharacterId) {
        this.directorRun += 1;
        this.pendingHands = null;
        // Only sessions that are producing something; cancelling an idle one is an API error.
        const active = new Set([...this.replies.keys(), ...(this.speaking ? [this.speaking] : []), ...(this.voicing ? [this.voicing] : [])]);
        for (const id of active) if (id !== except) this.stop(id);
        if (this.speaking && this.speaking !== except) {
            this.speaking = null;
            this.callbacks.onSpeakingChange(null);
        }
    }

    private handleUserSpeechStart() {
        // The addressed session handles its own barge-in; silence everyone else.
        this.interruptAll(this.addressee);
        // An expressive voice and a model writing elsewhere are outside the session, so they are cut off here.
        if (this.voicing === this.addressee || this.thinking.has(this.addressee)) {
            this.stop(this.addressee);
            if (this.speaking === this.addressee) this.setSpeaking(null);
        }
        // Arrives before speech ends, i.e. before the automatic reply is created.
        this.tellVideoPosition(this.addressee);
        this.callbacks.onHands([]);
        this.callbacks.onUserSpeechStart();
    }

    private handleUserTranscript(heardBy: CharacterId, text: string) {
        const target = addressedCharacter(text) ?? heardBy;
        this.recordUserLine(text, target, heardBy);
        this.callbacks.onUserText(text);
        if (target === heardBy) {
            if (hasBrain(heardBy)) void this.think(heardBy);
            return;
        }

        // "Jinx, what do you think?" said to Jenny: Jenny stops, Jinx answers.
        this.stop(heardBy);
        void this.setAddressee(target);
        if (hasBrain(target)) {
            void this.think(target);
            return;
        }
        void this.connect(target).then((session) => {
            if (this.signal.aborted) return;
            session.dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: outputModalities(target) } }));
        });
    }

    private handleFunctionCall(id: CharacterId, call: { name: string; callId: string; arguments: string }) {
        if (call.name !== DRAW_DIAGRAM_TOOL.name) return;
        let args: { request?: string; depth?: string } = {};
        try {
            args = JSON.parse(call.arguments);
        } catch {
            // Fall back to the last thing the user said.
        }
        const request = args.request?.trim() || [...this.lines].reverse().find((line) => line.speaker.startsWith("User"))?.text || "";
        this.sketching = true;
        this.dismissHands();
        const name = CHARACTER_BY_ID[id].name;
        this.lines.push({ speaker: name, text: `(sketches on the whiteboard: ${request})` });
        this.injectIntoOthers(id, `[${name}]: (sketches on the shared whiteboard: ${request})`);
        this.callbacks.onDiagramRequest({
            id,
            callId: call.callId,
            request,
            depth: args.depth === "rich" ? "rich" : "simple",
            lines: this.lines.slice(-14),
        });
    }

    private handleReplyDone(id: CharacterId) {
        const performance = (this.replies.get(id) ?? "").trim();
        const text = withoutStageDirections(performance);
        this.replies.delete(id);
        if (!text) return;
        // A character with their own model is already being performed while writing.
        if (CHARACTER_BY_ID[id].expressiveVoice && !hasBrain(id)) this.perform(id, performance);
        const name = CHARACTER_BY_ID[id].name;
        this.lines.push({ speaker: name, text });
        this.injectIntoOthers(id, `[${name}]: ${text}`);
        this.callbacks.onReplyDone(id, text);
        void this.askDirector(id);
    }

    private setSpeaking(id: CharacterId | null) {
        if (id) {
            this.interruptAll(id);
            // A paused voice (Pause button, Space, or the browser itself) would stay
            // silent for every later reply while the transcript still shows up.
            const audio = this.ready.get(id)?.audioEl;
            if (audio?.paused) {
                void audio.play().catch((error) => console.error(`${CHARACTER_BY_ID[id].name}'s voice could not resume:`, error));
            }
        }
        this.speaking = id;
        this.callbacks.onSpeakingChange(id);
        if (!id && this.pendingHands) this.showHands(this.pendingHands);
    }

    private showHands(hands: RaisedHand[]) {
        this.pendingHands = null;
        this.callbacks.onHands(hands);
        // Connect early so the floor can be given without a handshake delay.
        for (const hand of hands) void this.connect(hand.id).catch(() => {});
    }

    /** Plays a whole reply with stage directions in the character's expressive voice. */
    private perform(id: CharacterId, performance: string) {
        this.startPerformance(id);
        this.addPiece(performance);
        this.finishPerformance();
    }

    private startPerformance(id: CharacterId) {
        this.stopVoice();
        this.voicing = id;
        this.performance = { id, pieces: [], index: 0, finished: false };
    }

    /** Queues the next piece of the reply. */
    private addPiece(text: string) {
        const performance = this.performance;
        if (!performance || !withoutStageDirections(text)) return;
        performance.pieces.push({ text: text.trim() });
        const index = performance.pieces.length - 1;
        if (index === performance.index) this.playPiece();
        else if (index === performance.index + 1) this.loadPiece(index);
    }

    /**
     * Starts fetching a piece's audio. Only the playing piece and the next one load at a
     * time: enough for no gap between them, and within the voice service's limit on
     * simultaneous requests (more fail outright).
     */
    private loadPiece(index: number) {
        const piece = this.performance?.pieces[index];
        if (!piece || piece.audio) return piece?.audio;
        piece.audio = new Audio(`/api/voice?${new URLSearchParams({
            voice: CHARACTER_BY_ID[this.performance!.id].expressiveVoice!,
            text: piece.text,
            speed: String(this.speed),
        })}`);
        piece.audio.preload = "auto";
        piece.audio.setAttribute("playsinline", "true");
        return piece.audio;
    }

    private finishPerformance() {
        if (!this.performance) return;
        this.performance.finished = true;
        if (this.performance.index >= this.performance.pieces.length) this.endPerformance();
    }

    private playPiece() {
        const performance = this.performance;
        const audio = performance ? this.loadPiece(performance.index) : undefined;
        if (!performance || !audio) return;
        this.loadPiece(performance.index + 1);
        const { id } = performance;
        const next = () => {
            if (this.performance !== performance) return;
            performance.index += 1;
            if (performance.index < performance.pieces.length) this.playPiece();
            else if (performance.finished) this.endPerformance();
        };
        // Fires again after a pause; only the first start makes them the speaker.
        audio.onplaying = () => { if (this.performance === performance && this.speaking !== id) this.setSpeaking(id); };
        audio.onended = next;
        audio.onerror = () => {
            if (this.performance === performance) console.error(`${CHARACTER_BY_ID[id].name}'s voice failed:`, audio.error);
            next();
        };
        void audio.play().catch((error) => {
            if (this.performance !== performance) return;
            console.error(`${CHARACTER_BY_ID[id].name}'s voice could not play:`, error);
            next();
        });
    }

    private endPerformance() {
        const id = this.performance?.id;
        this.performance = null;
        this.voicing = null;
        if (id && this.speaking === id) this.setSpeaking(null);
        else if (this.pendingHands && !this.speaking) this.showHands(this.pendingHands);
    }

    private stopVoice() {
        this.voicing = null;
        for (const { audio } of this.performance?.pieces ?? []) {
            if (!audio) continue;
            audio.onplaying = audio.onended = audio.onerror = null;
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        }
        this.performance = null;
    }

    /**
     * Has a character's own model write the reply to the conversation so far,
     * speaking each finished piece while the rest is still being written.
     */
    private async think(id: CharacterId, instructions?: string) {
        const character = CHARACTER_BY_ID[id];
        this.interruptAll(id);
        this.thinking.get(id)?.abort();
        const controller = new AbortController();
        this.thinking.set(id, controller);
        const signal = AbortSignal.any([this.signal, controller.signal]);
        let written = "";
        let unspoken = "";
        let performing = false;
        const speak = (piece: string) => {
            if (!performing) {
                this.startPerformance(id);
                performing = true;
            }
            this.addPiece(piece);
        };
        this.replies.set(id, "");
        try {
            const response = await fetch("/api/brain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: character.brainModel,
                    instructions: instructions ?? characterInstructions(character, this.settings),
                    input: await this.brainInput(id),
                    tools: [DRAW_DIAGRAM_TOOL],
                }),
                signal,
            });
            if (!response.ok || !response.body) throw new Error(`Brain ${response.status}: ${await response.text()}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line) as { type: string; text?: string; name?: string; callId?: string; arguments?: string };
                    if (event.type === "error") throw new Error("Brain stream failed");
                    if (event.type === "call" && event.name && event.callId) {
                        this.toolItems.set(id, [...(this.toolItems.get(id) ?? []), {
                            at: this.lines.length,
                            item: { type: "function_call", call_id: event.callId, name: event.name, arguments: event.arguments ?? "{}" },
                        }]);
                        this.handleFunctionCall(id, { name: event.name, callId: event.callId, arguments: event.arguments ?? "{}" });
                    }
                    if (event.type !== "delta" || !event.text) continue;
                    written += event.text;
                    unspoken += event.text;
                    const shown = speakable(written);
                    this.replies.set(id, shown);
                    this.callbacks.onReplyDelta(id, withoutStageDirections(shown));
                    // The first piece is short so the voice starts early; later ones longer for a natural flow.
                    let piece: [string, string] | null;
                    while ((piece = takeSegment(unspoken, performing ? 220 : 40))) {
                        speak(speakable(piece[0]));
                        unspoken = piece[1];
                    }
                }
            }
            if (speakable(unspoken).trim()) speak(speakable(unspoken));
            if (performing) this.finishPerformance();
            this.handleReplyDone(id);
        } catch (error) {
            if (controller.signal.aborted || this.signal.aborted) return;
            console.error(`${character.name} could not think:`, error);
            this.replies.delete(id);
            if (performing) this.finishPerformance();
            this.callbacks.onConnectionError(id, error);
        } finally {
            if (this.thinking.get(id) === controller) this.thinking.delete(id);
        }
    }

    /** The conversation as the character's model reads it: their own lines as theirs, everyone else's as heard. */
    private async brainInput(id: CharacterId) {
        const name = CHARACTER_BY_ID[id].name;
        const input: Record<string, string>[] = [];
        const feed = await loadFeed(id).catch(() => null);
        if (feed?.videos.length) input.push({ role: "developer", content: describeFeed(feed) });
        if (this.videoContext) input.push({ role: "developer", content: this.videoContext });
        const position = this.videoContext ? this.videoPosition?.() : null;
        if (position) input.push({ role: "developer", content: `[Video position] ${position}` });

        // A call without its result (the user moved on before the sketch was done) would be rejected.
        const tools = this.toolItems.get(id) ?? [];
        const answered = new Set(tools.filter(({ item }) => item.type === "function_call_output").map(({ item }) => item.call_id));
        const start = Math.max(0, this.lines.length - BRAIN_HISTORY);
        for (let index = start; index <= this.lines.length; index++) {
            for (const { at, item } of tools) if (at === index && answered.has(item.call_id)) input.push(item);
            const line = this.lines[index];
            if (!line) continue;
            input.push(line.speaker === name
                ? { role: "assistant", content: line.text }
                : { role: "user", content: `[${line.speaker}]: ${line.text}` });
        }
        return input;
    }

    private async askDirector(lastSpeakerId: CharacterId) {
        const run = ++this.directorRun;
        try {
            const response = await fetch("/api/director", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lines: this.lines.slice(-12),
                    members: CHARACTERS.map(({ id, name, summary }) => ({ id, name, summary })),
                    lastSpeakerId,
                }),
                signal: this.signal,
            });
            const { hands } = await response.json() as { hands: RaisedHand[] };
            // Someone started talking meanwhile; the moment has passed.
            if (run !== this.directorRun || this.signal.aborted || this.sketching || !hands.length) return;
            if (this.speaking || this.voicing) this.pendingHands = hands;
            else this.showHands(hands);
        } catch (error) {
            if (!this.signal.aborted) console.error("Director failed:", error);
        }
    }
}
