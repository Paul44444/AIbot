import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import {
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import CozyRoom, { BlobShadow, JENNY_LIGHTS } from "./CozyRoom";
import BobRoom, { BOB_LIGHTS } from "./BobRoom";
import SmythRoom, { SMYTH_LIGHTS } from "./SmythRoom";
import {
    DOORWAYS,
    DOORWAY_HEIGHT,
    DOORWAY_WIDTH,
    DOORWAY_Z,
    FLOOR_Y,
    HEIGHT,
    ROOM_BOUNDS,
    ROOM_ORDER,
    SEATS,
    roomAt,
} from "./roomLayout";
import { CHARACTER_BY_ID, type Character as GroupMember, type CharacterId } from "../data/characters";

type SceneViewProps = {
    speakingId: CharacterId | null;
    addresseeId: CharacterId;
    expression: string;
    onProgress: (progress: number) => void;
    /** The user clicked a character or a doorway leading to their room. */
    onNavigate: (id: CharacterId) => void;
};

const TOWARD_CAMERA = new THREE.Vector3(1, 0, 1).normalize();
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

const ROOMS: Record<CharacterId, () => ReactNode> = {
    jenny: () => <CozyRoom />,
    bob: () => <BobRoom />,
    smyth: () => <SmythRoom />,
};

// Rooms and residents load one after another, Jenny's first, so the work never
// piles up on the main thread and the starting room is ready soonest.
const LOAD_STEPS = ROOM_ORDER
    .slice()
    .sort((a, b) => (a === "jenny" ? -1 : b === "jenny" ? 1 : 0))
    .flatMap((id) => [{ kind: "room" as const, id }, { kind: "avatar" as const, id }]);

function stepIndex(kind: "room" | "avatar", id: CharacterId) {
    return LOAD_STEPS.findIndex((step) => step.kind === kind && step.id === id);
}

export default function SceneView({ speakingId, addresseeId, expression, onProgress, onNavigate }: SceneViewProps) {
    const [step, setStep] = useState(0);
    const finishStep = useCallback((index: number) => {
        setStep((current) => current === index ? current + 1 : current);
    }, []);
    const roomReady = step > stepIndex("room", "jenny");
    const revealed = useRef(false);

    useEffect(() => {
        onProgress(0.3 + (step / LOAD_STEPS.length) * 0.7);
    }, [step, onProgress]);

    // Reveal Jenny's room as soon as it can render; everything else joins later.
    useEffect(() => {
        if (!roomReady || revealed.current) return;
        let revealTimer = 0;
        let secondFrame = 0;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                revealTimer = window.setTimeout(() => {
                    document.documentElement.dataset.sceneReady = "true";
                    revealed.current = true;
                }, 220);
            });
        });

        return () => {
            window.clearTimeout(revealTimer);
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
        };
    }, [roomReady]);

    return (
        <div className="sceneView" aria-label="3D rooms of the group">
            <Canvas
                className="backgroundCanvas1"
                dpr={[1, 1.25]}
                camera={{ position: [1.5, -0.5, 1.5], fov: 40 }}
                // Nothing is drawn until shaders and textures are prepared without blocking.
                frameloop={roomReady ? "always" : "never"}
            >
                <color attach="background" args={["#2a1d16"]} />
                <ambientLight intensity={1.4} />
                <hemisphereLight args={["#ffe9d2", "#c99a74", 0.6]} />
                <directionalLight position={[2, 3, -5]} color="#ffeedd" intensity={1.1} />
                {/* Every room's lamps exist from the start: adding lights later would recompile every material. */}
                {[...JENNY_LIGHTS, ...BOB_LIGHTS, ...SMYTH_LIGHTS].map((light, index) => (
                    <pointLight
                        key={index}
                        position={light.position as unknown as [number, number, number]}
                        color={light.color}
                        intensity={light.intensity}
                        distance={light.distance}
                        decay={light.decay}
                    />
                ))}

                {LOAD_STEPS.map((loadStep, index) => {
                    if (index > step) return null;
                    if (loadStep.kind === "room") {
                        return (
                            <DeferredRoom key={`room-${loadStep.id}`} onReady={() => finishStep(index)}>
                                {ROOMS[loadStep.id]()}
                            </DeferredRoom>
                        );
                    }
                    return (
                        <Character
                            key={`avatar-${loadStep.id}`}
                            character={CHARACTER_BY_ID[loadStep.id]}
                            isSpeaking={speakingId === loadStep.id}
                            isAddressed={addresseeId === loadStep.id}
                            expression={speakingId === loadStep.id ? expression : "relaxed"}
                            onReady={() => finishStep(index)}
                            onSelect={onNavigate}
                        />
                    );
                })}

                {DOORWAYS.map((doorway) => (
                    <DoorwayHotspot key={doorway.x} doorway={doorway} onNavigate={onNavigate} />
                ))}
                <OrbitControls makeDefault enablePan enableZoom enableRotate />
                <CameraRig roomId={addresseeId} />
            </Canvas>
        </div>
    );
}

const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** The camera's resting view of a character, framed for the current screen. */
function viewOf(id: CharacterId, width: number, height: number) {
    const aspect = width / height;
    const [x, z] = SEATS[id];
    const target = new THREE.Vector3(x, FLOOR_Y + 1.35, z);
    // On wide screens the transcript covers the left quarter; on phones the top half.
    if (width >= 900) target.addScaledVector(SCREEN_RIGHT, -0.36);
    if (aspect < 1) target.y += 0.6;
    const position = target.clone().addScaledVector(TOWARD_CAMERA, aspect < 1 ? 2.3 : 2.0).add(new THREE.Vector3(0, 0.05, 0));
    return { position, target, fov: aspect < 1 ? 62 : 40 };
}

/**
 * Keeps the camera on the addressed character's room. Switching rooms flies the
 * camera through the doorways in between; afterwards the user can orbit freely
 * inside that room.
 */
function CameraRig({ roomId }: { roomId: CharacterId }) {
    const { camera, size, controls } = useThree();
    const flight = useRef<{ curve: THREE.CatmullRomCurve3; from: THREE.Vector3; to: THREE.Vector3; start: number; duration: number } | null>(null);
    const shownRoom = useRef<CharacterId | null>(null);
    const lookTarget = useRef(new THREE.Vector3());

    useEffect(() => {
        const perspective = camera as THREE.PerspectiveCamera;
        const view = viewOf(roomId, size.width, size.height);
        perspective.fov = view.fov;
        perspective.updateProjectionMatrix();
        const orbit = controls as OrbitControlsImpl | null;

        if (shownRoom.current === null || shownRoom.current === roomId) {
            // First frame or a resize: just frame the character.
            camera.position.copy(view.position);
            orbit?.target.copy(view.target);
            if (orbit) orbit.update(); else camera.lookAt(view.target);
            shownRoom.current = roomId;
            return;
        }

        const fromRoom = roomAt(camera.position.x, camera.position.z) ?? shownRoom.current;
        const from = ROOM_ORDER.indexOf(fromRoom);
        const to = ROOM_ORDER.indexOf(roomId);
        const eyeY = FLOOR_Y + 1.5;
        const points = [camera.position.clone()];
        const direction = Math.sign(to - from);
        // Walk through each doorway between the two rooms, entering head-on.
        for (let index = from; index !== to; index += direction) {
            const doorway = DOORWAYS[Math.min(index, index + direction)];
            points.push(new THREE.Vector3(doorway.x - direction * 0.9, eyeY, DOORWAY_Z));
            points.push(new THREE.Vector3(doorway.x + direction * 0.9, eyeY, DOORWAY_Z));
        }
        points.push(view.position);
        const doors = Math.abs(to - from);
        flight.current = {
            curve: new THREE.CatmullRomCurve3(points, false, "centripetal"),
            from: orbit?.target.clone() ?? view.target.clone(),
            to: view.target,
            start: performance.now(),
            duration: 700 + 900 * doors,
        };
        if (orbit) orbit.enabled = false;
        shownRoom.current = roomId;
    }, [camera, size.width, size.height, controls, roomId]);

    useFrame(() => {
        const orbit = controls as OrbitControlsImpl | null;
        const current = flight.current;
        if (current) {
            const t = Math.min(1, (performance.now() - current.start) / current.duration);
            const eased = easeInOut(t);
            camera.position.copy(current.curve.getPointAt(eased));
            // Look along the path, starting from the old focus and ending on the character.
            const ahead = current.curve.getPointAt(Math.min(1, eased + 0.12));
            ahead.y = FLOOR_Y + 1.4;
            lookTarget.current.lerpVectors(current.from, ahead, THREE.MathUtils.smoothstep(eased, 0, 0.25));
            lookTarget.current.lerp(current.to, THREE.MathUtils.smoothstep(eased, 0.55, 1));
            camera.lookAt(lookTarget.current);
            orbit?.target.copy(lookTarget.current);
            if (t >= 1) {
                flight.current = null;
                if (orbit) {
                    orbit.target.copy(current.to);
                    orbit.enabled = true;
                    orbit.update();
                }
            }
            return;
        }

        // Keep the orbiting camera inside the current room.
        const bounds = ROOM_BOUNDS[roomId];
        const margin = 0.25;
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, bounds.minX + margin, bounds.maxX - margin);
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, FLOOR_Y + 0.2, FLOOR_Y + HEIGHT - 0.2);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, bounds.minZ + margin, bounds.maxZ - margin);
    });

    return null;
}

/** Ignore clicks that were really camera drags. */
const isClick = (event: ThreeEvent<MouseEvent>) => event.delta < 6;

function setCursor(pointer: boolean) {
    document.body.style.cursor = pointer ? "pointer" : "";
}

/** Invisible plane in a doorway: hover shows where it leads, click goes there. */
function DoorwayHotspot({ doorway, onNavigate }: { doorway: (typeof DOORWAYS)[number]; onNavigate: (id: CharacterId) => void }) {
    const { camera } = useThree();
    const [hovered, setHovered] = useState(false);
    const destination = () => camera.position.x < doorway.x ? doorway.east : doorway.west;
    const character = CHARACTER_BY_ID[hovered ? destination() : doorway.east];

    return (
        <mesh
            position={[doorway.x, FLOOR_Y + DOORWAY_HEIGHT / 2, DOORWAY_Z]}
            rotation={[0, Math.PI / 2, 0]}
            onPointerOver={(event) => { event.stopPropagation(); setHovered(true); setCursor(true); }}
            onPointerOut={() => { setHovered(false); setCursor(false); }}
            onClick={(event) => {
                if (!isClick(event)) return;
                event.stopPropagation();
                onNavigate(destination());
            }}
        >
            <planeGeometry args={[DOORWAY_WIDTH, DOORWAY_HEIGHT]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            {hovered && (
                <Html center position={[0, 0.4, 0]} pointerEvents="none" zIndexRange={[30, 0]}>
                    <div className="sceneTooltip" style={{ "--member-color": character.color } as CSSProperties}>
                        <strong>{character.name}'s room →</strong>
                    </div>
                </Html>
            )}
        </mesh>
    );
}

// Yield to the browser between pieces of GPU work so input is handled in between.
// Idle callbacks are too rare while the scene renders every frame.
const yieldToBrowser = () => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
});

// Shared across rooms and avatars, so work done once is never waited on again.
const preparedPrograms = new WeakSet<object>();
const preparedTextures = new WeakSet<THREE.Texture>();

/**
 * Compiles shaders in parallel (KHR_parallel_shader_compile) and uploads
 * textures one per idle slot, so the first frame that draws `object` does not
 * stall the main thread and keep the chat UI from responding.
 */
async function prepareForRender(gl: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene) {
    await gl.compileAsync(object, camera, scene);

    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    object.traverse((child) => {
        if (!child.visible) return;
        const childMaterials = (child as THREE.Mesh).material;
        for (const material of Array.isArray(childMaterials) ? childMaterials : childMaterials ? [childMaterials] : []) {
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
            const uniforms = (material as THREE.ShaderMaterial).uniforms ?? {};
            for (const uniform of Object.values(uniforms)) if (uniform?.value instanceof THREE.Texture) textures.add(uniform.value);
        }
    });
    // A program looks up its uniform locations on first use; do that one program per slot.
    const programs = new Set<{ getUniforms: () => unknown; getAttributes: () => unknown }>();
    for (const material of materials) {
        const program = (gl.properties.get(material) as { currentProgram?: { getUniforms: () => unknown; getAttributes: () => unknown } }).currentProgram;
        if (program) programs.add(program);
    }
    for (const program of programs) {
        if (preparedPrograms.has(program)) continue;
        preparedPrograms.add(program);
        await yieldToBrowser();
        program.getUniforms();
        program.getAttributes();
    }
    for (const texture of textures) {
        if (preparedTextures.has(texture)) continue;
        preparedTextures.add(texture);
        await yieldToBrowser();
        gl.initTexture(texture);
    }
}

/** Builds a room as a transition, so React yields to typing while creating it. */
function DeferredRoom({ onReady, children }: { onReady: () => void; children: ReactNode }) {
    const [show, setShow] = useState(false);
    const room = useRef<THREE.Group>(null);
    useEffect(() => startTransition(() => setShow(true)), []);
    if (!show) return null;
    return (
        <>
            <group ref={room}>{children}</group>
            <RoomWarmUp room={room} onReady={onReady} />
        </>
    );
}

function RoomWarmUp({ room, onReady }: { room: RefObject<THREE.Group | null>; onReady: () => void }) {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
        let cancelled = false;
        void prepareForRender(gl, room.current ?? scene, camera, scene)
            .catch((error) => console.error("Room warm-up failed:", error))
            .then(() => { if (!cancelled) onReady(); });
        return () => { cancelled = true; };
        // Runs once per room; onReady identity changes with every render of the parent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gl, scene, camera, room]);

    return null;
}

let idleAnimation: Promise<GLTF> | null = null;

function loadIdleAnimation() {
    if (!idleAnimation) {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        idleAnimation = loader.loadAsync("/animations/idle.vrma");
        idleAnimation.catch(() => { idleAnimation = null; });
    }
    return idleAnimation;
}

function Character({
    character,
    isSpeaking,
    isAddressed,
    expression,
    onReady,
    onSelect,
}: {
    character: GroupMember;
    isSpeaking: boolean;
    isAddressed: boolean;
    expression: string;
    onReady: () => void;
    onSelect: (id: CharacterId) => void;
}) {
    const group = useRef<THREE.Group>(null);
    const [vrm, setVrm] = useState<VRM | null>(null);
    const [hovered, setHovered] = useState(false);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const { gl, camera, scene } = useThree();
    const position = useMemo(() => new THREE.Vector3(SEATS[character.id][0], FLOOR_Y, SEATS[character.id][1]), [character.id]);
    const scale = character.id === "jenny" ? 1.12 : 1;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
        let cancelled = false;
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        loader.load(character.avatarUrl, async (gltf) => {
            const loadedVrm = gltf.userData.vrm as VRM;
            if (cancelled) return;
            // The avatar is always on screen; culling it only makes three.js skin
            // every vertex on the CPU to compute bounding spheres.
            loadedVrm.scene.traverse((object) => {
                object.frustumCulled = false;
                // Depth sorting would otherwise compute the same skinned bounds; the bind pose is close enough.
                const skinned = object as THREE.SkinnedMesh;
                if (skinned.isSkinnedMesh) {
                    skinned.geometry.computeBoundingSphere();
                    skinned.boundingSphere = skinned.geometry.boundingSphere!.clone();
                }
            });

            // Show the avatar only once it stands in its idle pose, not in a T-pose.
            let mixer: THREE.AnimationMixer | null = null;
            try {
                const animation = (await loadIdleAnimation()).userData.vrmAnimations?.[0];
                if (animation) {
                    mixer = new THREE.AnimationMixer(loadedVrm.scene);
                    // Offset the clip so the residents do not breathe in unison.
                    mixer.clipAction(createVRMAnimationClip(animation, loadedVrm)).play().time = Math.random() * 3;
                    mixer.update(0);
                    loadedVrm.update(0);
                    // Let hair and clothes start from the idle pose instead of swinging into it.
                    loadedVrm.springBoneManager?.setInitState();
                    loadedVrm.springBoneManager?.reset();
                }
            } catch (error) {
                console.error("Idle animation failed:", error);
            }
            if (cancelled) return;
            // Stand every model on its seat by the hips of its idle pose: the animation's
            // hip offset ends up mirrored on VRM 0.x models, which face the other way.
            const hips = loadedVrm.humanoid.getRawBoneNode("hips");
            if (hips) {
                loadedVrm.scene.updateMatrixWorld(true);
                const hipsPosition = hips.getWorldPosition(new THREE.Vector3());
                loadedVrm.scene.position.x -= hipsPosition.x;
                loadedVrm.scene.position.z -= hipsPosition.z;
            }
            try {
                await prepareForRender(gl, loadedVrm.scene, camera, scene);
            } catch (error) {
                console.error("Avatar warm-up failed:", error);
            }
            if (cancelled) return;

            mixerRef.current = mixer;
            setVrm(loadedVrm);
            onReadyRef.current();
        }, undefined, (error) => {
            console.error(`Failed to load ${character.name}:`, error);
            // Let the next room load anyway.
            if (!cancelled) onReadyRef.current();
        });

        return () => {
            cancelled = true;
        };
        // gl, camera and scene are stable for the canvas' lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character]);

    const lookTarget = useRef(new THREE.Vector3());
    const restingView = useMemo(() => viewOf(character.id, 1600, 900).position, [character.id]);
    const settled = useRef(false);

    useFrame((_, delta) => {
        if (!vrm || !group.current) return;
        const time = performance.now() / 1000;

        // Face the user when they are in this room; otherwise face the usual viewpoint.
        const userHere = roomAt(camera.position.x, camera.position.z) === character.id;
        const facing = userHere ? camera.position : restingView;
        let yaw = Math.atan2(facing.x - position.x, facing.z - position.z);
        // VRM 0.x models face -Z, VRM 1.0 models face +Z.
        if (vrm.meta.metaVersion === "0") yaw += Math.PI;
        if (!settled.current) {
            // Spring bones (hair, skirt) live in world space. The model was set up at the
            // origin; moving it to its seat and turning it would look like a violent jolt
            // and fling the skirt up. Place it directly, then restart the physics there.
            group.current.rotation.y = yaw;
            group.current.updateMatrixWorld(true);
            vrm.springBoneManager?.reset();
            settled.current = true;
        }
        const current = group.current.rotation.y;
        const turn = Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current));
        group.current.rotation.y = current + turn * (1 - Math.exp(-4 * delta));

        if (vrm.lookAt) {
            if (userHere) camera.getWorldPosition(lookTarget.current);
            else lookTarget.current.copy(restingView);
            vrm.lookAt.lookAt(lookTarget.current);
        }

        vrm.expressionManager?.setValue("aa", isSpeaking
            ? 0.15 + 0.65 * Math.abs(Math.sin(time * 10))
            : 0);
        vrm.expressionManager?.setValue("blink", Math.sin(time * 3 + position.x * 5) > 0.97 ? 1 : 0);

        for (const name of ["happy", "sad", "angry", "relaxed", "Surprised"]) {
            vrm.expressionManager?.setValue(name, 0);
        }
        // The addressed friend looks a little more attentive.
        vrm.expressionManager?.setValue(expression, expression === "relaxed" ? (isAddressed ? 0.35 : 0.2) : expression === "happy" ? 0.5 : 1);

        mixerRef.current?.update(delta);
        vrm.update(delta);
    });

    // Touch screens have no hover; a tap shows the card for a moment.
    useEffect(() => {
        if (!hovered) return;
        const timer = window.setTimeout(() => setHovered(false), 4000);
        return () => window.clearTimeout(timer);
    }, [hovered]);

    if (!vrm) return null;
    return (
        <group position={position}>
            <group ref={group}>
                <primitive object={vrm.scene} scale={scale} />
            </group>
            <BlobShadow size={0.9} />
            {/* Cheap hit area: raycasting the skinned meshes would skin every vertex on the CPU. */}
            <mesh
                position={[0, 0.9 * scale, 0]}
                onPointerOver={(event) => { event.stopPropagation(); setHovered(true); setCursor(true); }}
                onPointerOut={() => { setHovered(false); setCursor(false); }}
                onClick={(event) => {
                    if (!isClick(event)) return;
                    event.stopPropagation();
                    setHovered(true);
                    onSelect(character.id);
                }}
            >
                <cylinderGeometry args={[0.32, 0.32, 1.8 * scale, 10]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {hovered && (
                <Html center position={[0, 1.55 * scale, 0]} pointerEvents="none" zIndexRange={[30, 0]}>
                    <div className="sceneTooltip sceneTooltipBeside" style={{ "--member-color": character.color } as CSSProperties}>
                        <strong>{character.name}</strong>
                        <span>{character.role}</span>
                        <small>{character.tagline}</small>
                    </div>
                </Html>
            )}
        </group>
    );
}
