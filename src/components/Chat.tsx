import { Suspense, useState } from "react";
import type { Message } from "../types/chat";
//import { Canvas, useFrame } from '@react-three/fiber'

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

import * as THREE from "three";
//import { useFBX } from "@react-three/drei";
//import { useFBX } from "@react-three/drei";

//import { useGLTF, useFBX, useAnimations } from '@react-three/drei'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'

//08062026A import { useEffect, useRef } from 'react'
import { useEffect, useRef } from 'react'

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";
import { upsertConversationNode } from "../data/conversationStorage";
import { Mic, MicOff } from "lucide-react";

void VRMLoaderPlugin

//upsertConversationNode(
//    conversationNodeIdRef.current,
//    currentMessages
//);

//11062026 import { loadMixamoAnimation }
//11062026   from "../utils/loadMixamoAnimation";

//import { startRealtimeVoiceSession } from "../utils/realtimeVoice";
import {
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { useChatLogic }
    from "../hooks/useChatLogic";

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

function ChatTranscript({
                            messages,
                            loading,
                        }: {
    messages: Message[];
    loading: boolean;
}) {
    return (
        <div className="uiAnswer">
            {messages.map((msg, index) => (
                <div key={index}>
                    <strong>{msg.role}:</strong> {msg.content}
                </div>
            ))}

            {loading && <div>Thinking...</div>}
        </div>
    );
}

function LanguagePanel({
                           open,
                           onClose,
                           set1sentence,
                           set2sentence,
                           set4sentence,
                       }: {
    open: boolean;
    onClose: () => void;
    set1sentence: () => void;
    set2sentence: () => void;
    set4sentence: () => void;
}) {
    if (!open) return null;

    return (
        <div
            id="language-panel"
            style={{
                position: "fixed",
                top: 80,
                right: 20,
                width: 350,
                height: 500,
                backgroundColor: "rgba(30,30,30,0.85)",
                color: "white",
                padding: 20,
                borderRadius: 12,
                zIndex: 9999,
                backdropFilter: "blur(8px)",
                overflowY: "auto",
            }}
        >
            <h2>Language Panel</h2>

            <p>Sentences per answer:</p>

            <button onClick={set1sentence}>1</button>
            <button onClick={set2sentence}>2</button>
            <button onClick={set4sentence}>4</button>

            <p />

            <button onClick={onClose}>
                Close
            </button>
        </div>
    );
}

function ChatInput({
                           input,
                           setInput,
                           sendMessage,
                           microphoneEnabled,
                           toggleMicrophone,
                       }: {
        input: string;
        setInput: (value: string) => void;
        sendMessage: () => void | Promise<void>;
        microphoneEnabled: boolean;
        toggleMicrophone: () => void | Promise<void>;
    }) {
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

                    <button
                        className={`microphoneButton ${
                            microphoneEnabled
                                ? "microphoneOn"
                                : "microphoneOff"
                        }`}
                        onClick={() => void toggleMicrophone()}
                        type="button"
                        aria-label={
                            microphoneEnabled
                                ? "Turn microphone off"
                                : "Turn microphone on"
                        }
                        title={
                            microphoneEnabled
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
        );
}

function SceneView({
                       isSpeaking,
                       expression,
                   }: {
    isSpeaking: boolean;
    expression: string;
}) {
    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                inset: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 0,
                overflow: "hidden",
            }}
        >
            <Canvas
                className="backgroundCanvas1"
                style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                }}
                camera={{
                    position: [0.5, -0.3, 0.5],
                }}
            >
                <ambientLight intensity={2.0} />
                <directionalLight
                    position={[0.0, -2.6, 0]}
                    intensity={0.0}
                />

                <Room />

                <Character
                    isSpeaking={isSpeaking}
                    expression={expression}
                />

                <Suspense fallback={null}>
                    <Environment preset="city" />
                </Suspense>

                <OrbitControls
                    target={[0, -0.25, 0]}
                    enablePan
                    enableZoom
                    enableRotate
                />
            </Canvas>
        </div>
    );
}

function Character({
                       isSpeaking,
                       expression,
                   }: {
    isSpeaking: boolean;
    expression: string;
}) {

    const group = useRef<any>(null)
    void group
    const [vrm, setVrm] = useState<VRM | null>(null)
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    //const idleAnimation = useFBX("/animations/idle.fbx");
    //const mixerRef =
    //    useRef<THREE.AnimationMixer | null>(null);
    //const speakingUntilRef = useRef(0);
    const { size } = useThree();
    const characterX =
        size.width >= 700 && size.width < 1300
            ? THREE.MathUtils.clamp(
                (1300 - size.width) / 1000,
                0,
                0.6
            )
            : 0;

    useEffect(() => {
        const loader = new GLTFLoader();

        loader.register((parser) => new VRMLoaderPlugin(parser));

        loader.load(
            "/model/human11.vrm", //"/model/smyth.vrm", //27062026"/model/human11.vrm",

            (gltf) => {

                const loadedVrm =
                    gltf.userData.vrm as VRM;

                console.log("VRM:", loadedVrm)
                console.log("Expression manager:", loadedVrm.expressionManager)
                console.log(
                    "Expressions:",
                    loadedVrm.expressionManager
                        ? Object.keys(loadedVrm.expressionManager.expressionMap)
                        : "no expression manager"
                )
                setVrm(loadedVrm);

                (async () => {

                    (async () => {
                        const animationLoader = new GLTFLoader();

                        animationLoader.register((parser) =>
                            new VRMAnimationLoaderPlugin(parser)
                        );

                        const animationGltf =
                            await animationLoader.loadAsync("/animations/idle.vrma");

                        const vrmAnimation =
                            animationGltf.userData.vrmAnimations?.[0];

                        if (!vrmAnimation) {
                            console.error("No VRM animation found in VRMA_XY.vrma");
                            return;
                        }

                        const clip =
                            createVRMAnimationClip(vrmAnimation, loadedVrm);

                        const mixer =
                            new THREE.AnimationMixer(loadedVrm.scene);

                        mixerRef.current = mixer;

                        const action =
                            mixer.clipAction(clip);

                        action.play();
                    })();
                })();
                /*
                const mixer =
                    new THREE.AnimationMixer(loadedVrm.scene);

                mixerRef.current = mixer;

                if (idleAnimation.animations.length > 0) {

                    const action =
                        mixer.clipAction(idleAnimation.animations[0]);

                    action.play();
                }*/

                // TEST EXPRESSION:
                //loadedVrm.expressionManager
                //    ?.setValue("blink", 1.0);

            },)

            // if (!speakingText) return;
            //
            // const seconds = Math.min(
            //     8,
            //     Math.max(1.5, speakingText.length * 0.045)
            // );
            //
            // speakingUntilRef.current =
            //     performance.now() / 1000 + seconds;

    }, []);

    useFrame((_, delta) => {
        if (!vrm) return

        const t = performance.now() / 1000
        //const isSpeaking = t < speakingUntilRef.current;

        vrm.expressionManager?.setValue("happy", 0.0)

        //A const mouth =
        //A    (Math.sin(t * 6.0) + 1.0) / 2.0

        const mouth = isSpeaking
            ? 0.15 + 0.65 * Math.abs(Math.sin(t * 10))
            : 0.0;

        vrm.expressionManager?.setValue("aa", mouth)
        //17062026 vrm.expressionManager?.setValue("happy", 0.2);

        const blink =
            Math.sin(t * 3.0) > 0.97 ? 1.0 : 0.0

        vrm.expressionManager?.setValue("blink", blink)

        if (mixerRef.current) {
            mixerRef.current.update(delta);
        }

        vrm.expressionManager?.setValue("happy", 0.0);
        vrm.expressionManager?.setValue("sad", 0.0);
        vrm.expressionManager?.setValue("angry", 0.0);
        vrm.expressionManager?.setValue("relaxed", 0.0);
        vrm.expressionManager?.setValue("Surprised", 0.0);
        if (expression === "happy") {
            vrm.expressionManager?.setValue("happy", 0.5);
        } else if (expression === "sad") {
            vrm.expressionManager?.setValue("sad", 1.0);
        } else if (expression === "angry") {
            vrm.expressionManager?.setValue("angry", 1.0);
        } else if (expression === "Surprised") {
            vrm.expressionManager?.setValue("Surprised", 1.0);
        } else {
            vrm.expressionManager?.setValue("relaxed", 0.2);
        }

        vrm.update(delta)
    })


    if (!vrm) return null;

    return vrm ? (
        <primitive
            object={vrm.scene}
            //rotation={[0., Math.PI+1.0, 0.0]}
            rotation={[0., Math.PI+1.0, 0.0]}
            //position={[0, -0.2, 3.3]}
            position={[characterX, -2.0, 0.0]}//position={[0, -2.0, 0.0]}
            scale={1}
        />
    ) : null;

    /* 08062026A
    const fbx = useGLTF("/model/vrm1.glb")//useFBX(modelPath)//('/model/Idle.fbx')

    const { actions, names } =
        useAnimations(fbx.animations, group)

    useEffect(() => {

        console.log(fbx.animations)
        console.log(names)
        console.log(actions)

        if (names.length > 0) {

            actions[names[0]]
                ?.reset()
                .fadeIn(0.5)
                .play()
        }

    }, [actions, names, fbx])
    */

    /*const { scene, animations } = useFBX('/model/Idle.fbx')//useGLTF('/model/boy2idle.glb')*/
    //const { path1 } = '/model/human11.vrm';
    const { scene } = useGLTF('/model/boy2idle.glb')//'/model/human11.vrm')//useGLTF('/model/boy2idle.glb')
    void scene;
    /*const { actions, names } = useAnimations(animations, group)

    useEffect(() => {

        console.log(names)

        if (names.length > 0) {
            actions[names[0]]?.play()
        }

    }, [actions, names])*/

    //23052026 const gltf = useGLTF('/public/model/boy2idle.glb') //'/models/character.glb'
    //23052026 return <primitive object={gltf.scene} position={[0, -5, 0]} scale={3.5}/>
    /*
    return (
        <group ref={group}>
            <primitive
                object={scene}//{fbx}//scene
                position={[0, -2.6, 0]}
                scale={1.0}//{0.025}//{3.5}
            />
        </group>
    )
    return vrm ? (
        <primitive
            object={vrm.scene}
            rotation={[0, Math.PI + 1.0, 0]}
            position={[characterX, -2.0, 0.0]}
            scale={1}
        />
    ) : null;*/

}
/*120262026
async function speakText(
    text: string,
    onStart: () => void,
    onEnd: () => void
) {
    const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
    });

    if (!response.ok) {
        throw new Error(`TTS error ${response.status}: ${await response.text()}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onplay = onStart;
    audio.onended = () => {
        onEnd();
        URL.revokeObjectURL(audioUrl);
    };

    await audio.play();
}*/

function Room() {
    const { scene, gl } = useThree();

    useEffect(() => {
        const spark = new SparkRenderer({
            renderer: gl,
            lodSplatScale: 0.06,
            lodRenderScale: 0.15,
        });

        scene.add(spark);

        const room = new SplatMesh({
            url: "/model/room-lod.rad",
            paged: true,

            onLoad: () => {
                console.log("RAD room loaded");
            },

            onProgress: (event) => {
                if (event.lengthComputable) {
                    console.log(
                        `Room loading: ${Math.round(
                            (event.loaded / event.total) * 100
                        )}%`
                    );
                } else {
                    console.log(`Room loading: ${event.loaded} bytes`);
                }
            },
        });

        room.position.set(1.5, -0.86, -0.2); //(-2.4, -0.86, -3.2);
        room.rotation.set(0, 1.5, 0);
        room.scale.setScalar(1.0);

        scene.add(room);

        return () => {
            scene.remove(room);
            scene.remove(spark);
            scene.remove(spark);
            room.dispose();
            spark.dispose();
        };
    }, [scene, gl]);

    return null;
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

type ChatProps = {
    loadedMessages?: ChatMessage[] | null;
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

export default function Chat({ loadedMessages }: ChatProps) {
    //1206026 const [messages, setMessages] = useState<Message[]>([]);
    //12062026A const [speakingText, setSpeakingText] = useState<string | null>(null);
    //1206026 const [input, setInput] = useState<string>("");
    //12062026A const [loading, setLoading] = useState<boolean>(false);
    const [realtimeSpeaking, setRealtimeSpeaking] = useState(false);
    const [realtimeDc, setRealtimeDc] =
        useState<RTCDataChannel | null>(null);
    const [showLanguagePanel, setShowLanguagePanel] =
        useState(false);
    const [currentExpression, setCurrentExpression] =
        useState("relaxed");
    void setCurrentExpression;
    void detectExpression;

    const realtimeSessionRef = useRef<any>(null);
    const realtimeStartPromiseRef = useRef<Promise<any> | null>(null);
    const realtimeModeRef = useRef<"voice" | "text" | null>(null);
    const lastSavedMessageCountRef = useRef(0);
    const conversationNodeIdRef = useRef<string>(crypto.randomUUID());
    const [microphoneEnabled, setMicrophoneEnabled] = useState(true);

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
                        realtimeSessionRef.current.pc?.close();
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

            realtimeStartPromiseRef.current = (async () => {
                let currentAssistantText = "";
                let currentAssistantIndex: number | null = null;

                const session = await startRealtimeVoiceSession({
                    microphone,

                    onUserSpeechStart: () => {
                        setRealtimeMessages((prev) => {
                            const last = prev[prev.length - 1];

                            if (last?.role === "user" && last.content === "...") {
                                return prev;
                            }

                            return [
                                ...prev,
                                {
                                    role: "user",
                                    content: "...",
                                },
                            ];
                        });

                        currentAssistantText = "";
                    },

                    onUserTextDone: (text) => {
                        setRealtimeMessages((prev) => {
                            const next = [...prev];

                            for (let i = next.length - 1; i >= 0; i--) {
                                if (
                                    next[i].role === "user" &&
                                    next[i].content === "..."
                                ) {
                                    next[i] = {
                                        role: "user",
                                        content: text,
                                    };

                                    return next;
                                }
                            }

                            return [
                                ...prev,
                                {
                                    role: "user",
                                    content: text,
                                },
                            ];
                        });

                        currentAssistantText = "";
                    },

                    onAssistantTextDelta: (delta) => {
                        currentAssistantText += delta;

                        setCurrentExpression(
                            detectExpression(currentAssistantText)
                        );

                        setRealtimeMessages((prev) => {
                            const next = [...prev];

                            if (currentAssistantIndex === null) {
                                currentAssistantIndex = next.length;

                                next.push({
                                    role: "assistant",
                                    content: currentAssistantText,
                                });
                            } else {
                                next[currentAssistantIndex] = {
                                    role: "assistant",
                                    content: currentAssistantText,
                                };
                            }

                            return next;
                        });
                    },

                    onAssistantTextDone: () => {
                        currentAssistantText = "";
                        currentAssistantIndex = null;
                        console.log("Assistant text done");
                    },

                    onAudioStart: () => {
                        setRealtimeSpeaking(true);
                    },

                    onAudioDone: () => {
                        setRealtimeSpeaking(false);
                    },
                });

                realtimeSessionRef.current = session;
                realtimeModeRef.current = requestedMode;

                setRealtimeSession(session);
                setRealtimeDc(session.dc);

                await waitForDataChannelOpen(session.dc);

                return session;
            })();

            try {
                return await realtimeStartPromiseRef.current;
            } finally {
                realtimeStartPromiseRef.current = null;
            }
        };

    const toggleMicrophone = async () => {
        try {
            const existingSession = realtimeSessionRef.current;

            /*
             * If the voice session has not been started yet,
             * the first click starts it and leaves the microphone on.
             */
            if (
                !existingSession ||
                existingSession.pc?.connectionState === "closed"
            ) {
                const session = await startRealtimeIfNeeded(true);

                setSessionMicrophoneEnabled(session, true);
                setMicrophoneEnabled(true);

                return;
            }

            const nextEnabled = !microphoneEnabled;

            setSessionMicrophoneEnabled(
                existingSession,
                nextEnabled
            );

            setMicrophoneEnabled(nextEnabled);
        } catch (error) {
            console.error(
                "Could not toggle realtime microphone:",
                error
            );

            setMicrophoneEnabled(false);
        }
    };

    const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);

    const [sentenceCount, setSentenceCount] = useState(1);
    void sentenceCount;

    const updateRealtimeSentenceCount = (count: number) => {
        setSentenceCount(count);

        if (!realtimeDc || realtimeDc.readyState !== "open") {
            return;
        }

        realtimeDc.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                instructions: `
You are a cheerful anime-style teenage boy character on this website.
Answer naturally as the character.
Do not say you are an AI model.
Keep answers friendly and conversational.
Always answer with exactly ${count} sentence${count === 1 ? "" : "s"}.
            `.trim(),
            },
        }));
    };

    const set1sentence = () => updateRealtimeSentenceCount(1);
    const set2sentence = () => updateRealtimeSentenceCount(2);
    const set4sentence = () => updateRealtimeSentenceCount(4);

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
        input,
        setInput,
        loading,
        speakingText,
    } = useChatLogic(realtimeDc);

    const displayedMessages =
        loadedMessages ?? [...messages, ...realtimeMessages];

    const [realtimeSession, setRealtimeSession] =
        useState<any>(null);
    void realtimeSession;

    const sendTypedMessage = async () => {
            const text = input.trim();

            if (!text) return;

            setInput("");

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

                sendRealtimeText(dc, text);
            } catch (error) {
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

    useEffect(() => {
        async function autoStart() {
            try {
                const permission =
                    await navigator.permissions.query({
                        name: "microphone" as PermissionName,
                    });

                console.log(
                    "Microphone permission:",
                    permission.state
                );

                if (permission.state === "granted") {
                    const session = await startRealtimeIfNeeded(true);

                    setSessionMicrophoneEnabled(session, true);
                    setMicrophoneEnabled(true);
                }
            } catch (err) {
                console.error(err);
            }
        }

        autoStart();
    }, []);

    useEffect(() => {
        if (loadedMessages) return;

        const currentMessages = [...messages, ...realtimeMessages]
            .filter(
                (message): message is ChatMessage =>
                    message.role === "user" || message.role === "assistant"
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

    return (
        <div style={{ maxWidth: 1800, margin: "0 auto", padding: 20}}>
            <SceneView
                isSpeaking={speakingText !== null || realtimeSpeaking}
                expression={currentExpression}
            />

            <ChatTranscript
                messages={displayedMessages}
                loading={loading}
            />

            <button
                className="openPanelButton"
                type="button"
                onClick={() => setShowLanguagePanel((previous) => !previous)}
                aria-expanded={showLanguagePanel}
                aria-controls="language-panel"
            >
                {showLanguagePanel ? "Close Panel" : "Open Panel"}
            </button>

            <LanguagePanel
                open={showLanguagePanel}
                onClose={() => setShowLanguagePanel(false)}
                set1sentence={set1sentence}
                set2sentence={set2sentence}
                set4sentence={set4sentence}
            />

            <ChatInput
                input={input}
                setInput={setInput}
                sendMessage={sendTypedMessage}
                microphoneEnabled={microphoneEnabled}
                toggleMicrophone={toggleMicrophone}
            />

        </div>
    );
}