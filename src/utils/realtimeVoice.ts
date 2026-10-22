export async function startRealtimeVoiceSession(options?: {
    microphone?: boolean;
    /** Without `microphone`: keep a send slot so a shared mic track can be attached later. */
    sendAudio?: boolean;
    voice?: string;
    signal?: AbortSignal;
    onAssistantTextDelta?: (delta: string) => void;
    onAssistantTextDone?: () => void;
    onUserTextDone?: (text: string) => void;
    onAudioStart?: () => void;
    onAudioDone?: () => void;
    onUserSpeechStart?: () => void;
    onUserSpeechRejected?: () => void;
    onMicrophoneReady?: () => void;
    /** The model called one of the session's tools. */
    onFunctionCall?: (call: { name: string; callId: string; arguments: string }) => void;
    muteRemoteAudio?: boolean;
}) {
    const pc = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.muted = options?.muteRemoteAudio ?? false;
    audioEl.setAttribute("playsinline", "true");

    // This still runs inside the user's click, which unlocks this element for
    // later playback on Safari. Without a source the promise may reject.
    void audioEl.play().catch(() => {});

    pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        // Autoplay alone can be blocked once the click activation has expired.
        void audioEl.play().catch((error) => {
            console.error("Realtime audio playback was blocked:", error);
        });
    };

    const useMicrophone = options?.microphone ?? true;

    let localStream: MediaStream | null = null;
    let audioTransceiver: RTCRtpTransceiver | null = null;

    const dispose = () => {
        localStream?.getTracks().forEach((track) => track.stop());
        pc.close();
        audioEl.pause();
        audioEl.srcObject = null;
        options?.signal?.removeEventListener("abort", dispose);
    };
    options?.signal?.addEventListener("abort", dispose, { once: true });

    try {
        options?.signal?.throwIfAborted();
        if (useMicrophone) {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            // Permission can resolve after the user has started another conversation.
            if (options?.signal?.aborted) {
                dispose();
                options.signal.throwIfAborted();
            }
            for (const track of localStream.getTracks()) {
                pc.addTrack(track, localStream);
            }

            // The browser is now genuinely capturing audio. The WebRTC/OpenAI
            // handshake can continue without making the microphone UI feel stuck.
            options?.onMicrophoneReady?.();
        } else {
            // Text-only mode:
            // We still need an audio media section so the Realtime API can send audio back.
            audioTransceiver = pc.addTransceiver("audio", {
                direction: options?.sendAudio ? "sendrecv" : "recvonly",
            });
        }

        const dc = pc.createDataChannel("oai-events");

        const acceptUserTranscript = (transcript: unknown) => {
            const text = typeof transcript === "string" ? transcript.trim() : "";

            // Punctuation and whitespace are common results when VAD mistakes
            // background noise for speech. Do not let those sounds create a reply.
            if (!/[\p{L}\p{N}]/u.test(text)) {
                options?.onUserSpeechRejected?.();
                return;
            }

            options?.onUserTextDone?.(text);
        };

        dc.onopen = () => {
            console.log("Realtime data channel open");
        };

        dc.onmessage = (event) => {
            if (options?.signal?.aborted) return;
            const msg = JSON.parse(event.data);

            console.log("RT EVENT:", performance.now(), msg.type, msg);

            if (msg.type === "error") {
                console.error("Realtime API error:", msg);
            }

            if (msg.type === "input_audio_buffer.speech_started") {
                options?.onUserSpeechStart?.();
            }

            if (msg.type === "conversation.item.input_audio_transcription.completed") {
                acceptUserTranscript(msg.transcript);
                console.log("Realtime event type:", msg.type, msg);
            }

            if (msg.type === "conversation.item.input_audio_transcription.failed") {
                options?.onUserSpeechRejected?.();
            }

            if (msg.type === "response.output_audio_transcript.delta") {
                options?.onAssistantTextDelta?.(msg.delta);
            }

            if (msg.type === "response.output_audio_transcript.done") {
                options?.onAssistantTextDone?.();
            }

            if (msg.type === "response.output_item.done" && msg.item?.type === "function_call") {
                options?.onFunctionCall?.({ name: msg.item.name, callId: msg.item.call_id, arguments: msg.item.arguments ?? "{}" });
            }

            if (msg.type === "output_audio_buffer.started") {
                console.log("AUDIO START");

                options?.onAudioStart?.();
            }

            if (msg.type === "output_audio_buffer.stopped") {
                console.log("AUDIO STOPPED");

                options?.onAudioDone?.();
            }

            // Newer / alternative text delta name
            if (msg.type === "response.output_text.delta") {
                options?.onAssistantTextDelta?.(msg.delta);
            }

            if (msg.type === "response.output_text.done") {
                options?.onAssistantTextDone?.();
            }

            // Mouth animation trigger
            if (
                msg.type === "response.audio.delta" ||
                msg.type === "response.audio_transcript.delta"
            ) {
                options?.onAudioStart?.();
            }

            /*
            if (
                msg.type === "response.audio.done" ||
                msg.type === "response.done"
            ) {
                options?.onAudioDone?.();
            }*/
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch(`/api/realtime-call${options?.voice ? `?voice=${encodeURIComponent(options.voice)}` : ""}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/sdp", //"text/plain",
            },
            body: offer.sdp ?? "",
            signal: options?.signal,
        });

        if (!response.ok) {
            throw new Error(`Realtime call error: ${await response.text()}`);
        }

        const answerSdp = await response.text();

        await pc.setRemoteDescription({
            type: "answer",
            sdp: answerSdp,
        });

        options?.signal?.throwIfAborted();
        // Switching tracks on an existing send slot needs no renegotiation.
        const setMicrophoneTrack = (track: MediaStreamTrack | null) =>
            audioTransceiver?.sender.replaceTrack(track) ?? Promise.resolve();
        return { pc, dc, audioEl, dispose, setMicrophoneTrack };
    } catch (error) {
        dispose();
        throw error;
    }
}

export function sendRealtimeText(dc: RTCDataChannel, text: string) {
    const trimmed = text.trim();

    if (!trimmed) return;

    if (dc.readyState !== "open") {
        console.error(
            "Cannot send realtime text. Data channel state:",
            dc.readyState
        );
        return;
    }

    console.log("RT SEND text:", trimmed);

    dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
            type: "message",
            role: "user",
            content: [
                {
                    type: "input_text",
                    text: trimmed,
                },
            ],
        },
    }));

    // This is necessary for typed text.
    // Otherwise the server only stores the user item but does not answer.
    dc.send(JSON.stringify({
        type: "response.create",
        response: {
            output_modalities: ["audio"],
        },
    }));
}
