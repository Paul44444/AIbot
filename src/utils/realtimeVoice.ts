export async function startRealtimeVoiceSession(options?: {
    microphone?: boolean;
    onAssistantTextDelta?: (delta: string) => void;
    onAssistantTextDone?: () => void;
    onUserTextDone?: (text: string) => void;
    onAudioStart?: () => void;
    onAudioDone?: () => void;
    onUserSpeechStart?: () => void;
}) {
    const pc = new RTCPeerConnection();

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;

    pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
    };

    const useMicrophone = options?.microphone ?? true;

    let localStream: MediaStream | null = null;

    if (useMicrophone) {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });

        for (const track of localStream.getTracks()) {
            pc.addTrack(track, localStream);
        }
    } else {
        // Text-only mode:
        // We still need an audio media section so the Realtime API can send audio back.
        pc.addTransceiver("audio", {
            direction: "recvonly",
        });
    }

    const dc = pc.createDataChannel("oai-events");

    dc.onopen = () => {
        console.log("Realtime data channel open");
    };

    dc.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        console.log("RT EVENT:", performance.now(), msg.type, msg);

        if (msg.type === "error") {
            console.error("Realtime API error:", msg);
        }

        if (msg.type === "input_audio_buffer.speech_started") {
            options?.onUserSpeechStart?.();
        }

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
            options?.onUserTextDone?.(msg.transcript);
            console.log("Realtime event type:", msg.type, msg);
        }

        if (msg.type === "response.output_audio_transcript.delta") {
            options?.onAssistantTextDelta?.(msg.delta);
        }

        if (msg.type === "response.output_audio_transcript.done") {
            options?.onAssistantTextDone?.();
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

        if (msg.type === "conversation.item.done") {
            const item = msg.item;

            if (item?.role === "user") {
                const text =
                    item.content?.[0]?.transcript ??
                    item.content?.[0]?.text ??
                    "";

                if (text.trim()) {
                    options?.onUserTextDone?.(text);
                }
            }
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

    const response = await fetch("/api/realtime-call", {
        method: "POST",
        headers: {
            "Content-Type": "application/sdp", //"text/plain",
        },
        body: offer.sdp ?? "",
    });

    if (!response.ok) {
        throw new Error(`Realtime call error: ${await response.text()}`);
    }

    const answerSdp = await response.text();

    await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
    });

    return { pc, dc, audioEl };
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
