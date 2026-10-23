import { sendRealtimeText, startRealtimeVoiceSession } from "./realtimeVoice";
import {
    CHARACTERS,
    CHARACTER_BY_ID,
    DRAW_DIAGRAM_TOOL,
    characterInstructions,
    interjectionInstructions,
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
    private lines: { speaker: string; text: string }[] = [];
    private replies = new Map<CharacterId, string>();
    private speaking: CharacterId | null = null;
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
        return this.speaking ? this.ready.get(this.speaking)?.audioEl ?? null : null;
    }

    updateSettings(settings: string, speed: number) {
        this.settings = settings;
        this.speed = speed;
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
        const session = await this.connect(id);
        this.signal.throwIfAborted();
        // The user will most likely answer whoever just spoke.
        void this.setAddressee(id);
        session.dc.send(JSON.stringify({
            type: "response.create",
            response: {
                output_modalities: ["audio"],
                instructions: interjectionInstructions(CHARACTER_BY_ID[id], this.settings, teaser),
            },
        }));
    }

    /** Tells the character how the sketch went, so they explain it (or apologise). */
    finishDiagram(id: CharacterId, callId: string, result: object) {
        this.sketching = false;
        const session = this.ready.get(id);
        if (!session || session.dc.readyState !== "open") return;
        session.dc.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
        }));
        session.dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
    }

    setVideoContext(context: string | null, position: (() => string | null) | null) {
        if (context === this.videoContext) return;
        this.videoContext = context;
        this.videoPosition = position;
        const line = context ?? "[Video] The user closed the video.";
        for (const session of this.ready.values()) this.inject(session, line);
    }

    /** Tells the addressed character where the user is in the video, right before their turn. */
    private tellVideoPosition(id: CharacterId) {
        const position = this.videoContext ? this.videoPosition?.() : null;
        const session = this.ready.get(id);
        if (position && session) this.inject(session, `[Video position] ${position}`);
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
                    this.callbacks.onReplyDelta(id, text);
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
                if (line.speaker !== character.name) this.inject(session, `[${line.speaker}]: ${line.text}`);
            }
            if (this.videoContext) this.inject(session, this.videoContext);
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
        session.dc.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["audio"],
                instructions: characterInstructions(CHARACTER_BY_ID[id], this.settings),
                // Real time-stretching; asking for a slower pace in the instructions barely works.
                audio: { output: { speed: this.speed } },
                tools: [DRAW_DIAGRAM_TOOL],
                tool_choice: "auto",
            },
        }));
    }

    private inject(session: Session, text: string) {
        if (session.dc.readyState !== "open") return;
        session.dc.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
        }));
    }

    private injectIntoOthers(exceptId: CharacterId, text: string) {
        for (const [id, session] of this.ready) if (id !== exceptId) this.inject(session, text);
    }

    private recordUserLine(text: string, to: CharacterId, heardBy: CharacterId) {
        const speaker = `User to ${CHARACTER_BY_ID[to].name}`;
        this.lines.push({ speaker, text });
        this.injectIntoOthers(heardBy, `[${speaker}]: ${text}`);
    }

    private stop(id: CharacterId) {
        const session = this.ready.get(id);
        if (!session || session.dc.readyState !== "open") return;
        // The text of a reply finishes before its audio; cancel only what is still running.
        if (this.replies.has(id)) session.dc.send(JSON.stringify({ type: "response.cancel" }));
        if (this.speaking === id) session.dc.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
        const partial = this.replies.get(id)?.trim();
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
        const active = new Set([...this.replies.keys(), ...(this.speaking ? [this.speaking] : [])]);
        for (const id of active) if (id !== except) this.stop(id);
        if (this.speaking && this.speaking !== except) {
            this.speaking = null;
            this.callbacks.onSpeakingChange(null);
        }
    }

    private handleUserSpeechStart() {
        // The addressed session handles its own barge-in; silence everyone else.
        this.interruptAll(this.addressee);
        // Arrives before speech ends, i.e. before the automatic reply is created.
        this.tellVideoPosition(this.addressee);
        this.callbacks.onHands([]);
        this.callbacks.onUserSpeechStart();
    }

    private handleUserTranscript(heardBy: CharacterId, text: string) {
        const target = addressedCharacter(text) ?? heardBy;
        this.recordUserLine(text, target, heardBy);
        this.callbacks.onUserText(text);
        if (target === heardBy) return;

        // "Jinx, what do you think?" said to Jenny: Jenny stops, Jinx answers.
        this.stop(heardBy);
        void this.setAddressee(target);
        void this.connect(target).then((session) => {
            if (this.signal.aborted) return;
            session.dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
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
        const text = (this.replies.get(id) ?? "").trim();
        this.replies.delete(id);
        if (!text) return;
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
            if (this.speaking) this.pendingHands = hands;
            else this.showHands(hands);
        } catch (error) {
            if (!this.signal.aborted) console.error("Director failed:", error);
        }
    }
}
