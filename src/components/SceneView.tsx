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
import JinxRoom, { JINX_LIGHTS } from "./JinxRoom";
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
    FRONT_DOOR,
    PCS,
    WALL_GAP,
    SEATS,
    insideHouse,
    roomAt,
} from "./roomLayout";
import MonitorFeed from "./MonitorFeed";
import { sceneVisibility } from "./sceneVisibility";
import Outdoors, { OUTSIDE_START, SKY_HORIZON } from "./outdoor/Outdoors";
import { heightAt } from "./outdoor/world";
import { CHARACTER_BY_ID, type Character as GroupMember, type CharacterId } from "../data/characters";

type SceneViewProps = {
    speakingId: CharacterId | null;
    addresseeId: CharacterId;
    expression: string;
    onProgress: (progress: number) => void;
    /** The user clicked a character or a doorway leading to their room. */
    onNavigate: (id: CharacterId) => void;
    /** The PC the camera is zoomed in on, if any. */
    focusPcId: CharacterId | null;
    onFocusPc: (id: CharacterId | null) => void;
    onOpenYouTube: (request: { feed: CharacterId; videoId?: string }) => void;
    /** Walking in the forest outside instead of being in a room. */
    outside: boolean;
    onOutsideChange: (outside: boolean) => void;
};

const TOWARD_CAMERA = new THREE.Vector3(1, 0, 1).normalize();
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

const ROOMS: Record<CharacterId, () => ReactNode> = {
    jenny: () => <CozyRoom />,
    jinx: () => <JinxRoom />,
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

export default function SceneView({ speakingId, addresseeId, expression, onProgress, onNavigate, focusPcId, onFocusPc, onOpenYouTube, outside, onOutsideChange }: SceneViewProps) {
    const [settledKey, setSettledKey] = useState<string | null>(null);
    const [step, setStep] = useState(0);
    const finishStep = useCallback((index: number) => {
        setStep((current) => current === index ? current + 1 : current);
    }, []);
    const roomReady = step > stepIndex("room", "jenny");
    // The forest starts with a few tiles in front of the door once everyone has loaded
    // (or right away when someone goes outside earlier), and grows when walked in.
    const [outdoorsMounted, setOutdoorsMounted] = useState(false);
    const everyoneLoaded = step >= LOAD_STEPS.length;
    useEffect(() => {
        if (outside) return setOutdoorsMounted(true);
        if (!everyoneLoaded) return;
        // A pause after the last resident appeared, so their first frames stay smooth.
        const timer = window.setTimeout(() => setOutdoorsMounted(true), 2500);
        return () => window.clearTimeout(timer);
    }, [outside, everyoneLoaded]);
    const revealed = useRef(false);
    // Lowered by AdaptiveResolution on slow GPUs. It lives here: the canvas applies
    // its dpr prop on every render and would undo a change made from inside.
    const [dpr, setDpr] = useState(1);

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
                // Smoothness over sharpness: no multisampling (about a third of the GPU
                // time on integrated graphics), and the resolution adapts (AdaptiveResolution).
                dpr={dpr}
                gl={{ antialias: false, powerPreference: "high-performance" }}
                camera={{ position: [1.5, -0.5, 1.5], fov: 40 }}
                // Nothing is drawn until shaders and textures are prepared without blocking.
                frameloop={roomReady ? "always" : "never"}
                // Clicking into the room leaves the PC.
                onPointerMissed={() => { if (focusPcId) onFocusPc(null); }}
            >
                <color attach="background" args={["#2a1d16"]} />
                {/* Fog exists from the start: adding it later would recompile every material. Rooms are too small to show it. */}
                <fog attach="fog" args={[SKY_HORIZON, 35, 82]} />
                <ambientLight intensity={1.4} />
                <hemisphereLight args={["#ffe9d2", "#c99a74", 0.6]} />
                <directionalLight position={[2, 3, -5]} color="#ffeedd" intensity={1.1} />
                {/* Every room's lamps exist from the start: adding lights later would recompile every material. */}
                {[...JENNY_LIGHTS, ...JINX_LIGHTS, ...SMYTH_LIGHTS].map((light, index) => (
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
                            <DeferredRoom
                                key={`room-${loadStep.id}`}
                                id={loadStep.id}
                                onReady={() => finishStep(index)}
                            >
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
                {ROOM_ORDER.map((id) => (
                    <PcScreenSpot
                        key={id}
                        id={id}
                        focused={focusPcId === id}
                        settled={settledKey === `pc:${id}`}
                        onFocus={onFocusPc}
                        onOpenYouTube={onOpenYouTube}
                    />
                ))}
                <VisibilityControl outside={outside} />
                <AdaptiveResolution onChange={setDpr} />
                <FirstDraws />
                <FrontDoor open={outside} onOpen={() => onOutsideChange(true)} />
                {outdoorsMounted && <Outdoors active={settledKey === "outside"} onReachDoor={() => onOutsideChange(false)} />}
                <CameraRig roomId={addresseeId} focusPcId={focusPcId} outside={outside} onSettled={setSettledKey} />
            </Canvas>
        </div>
    );
}

/**
 * Keeps the frame rate up on weak GPUs: renders at a lower resolution when
 * frames stay slow. Every change reallocates the canvas (a long stall), so it
 * waits until loading is over, needs two slow three-second windows in a row,
 * only ever goes down and does so at most twice.
 */
function AdaptiveResolution({ onChange }: { onChange: (dpr: number) => void }) {
    const window_ = useRef({ start: 0, frames: 0, slow: 0, dpr: 1, since: performance.now() });

    useFrame(() => {
        const now = performance.now();
        const current = window_.current;
        if (now - current.since < 15000 || current.dpr <= 0.6) return;
        if (!current.start) current.start = now;
        current.frames++;
        if (now - current.start < 3000) return;
        const frameTime = (now - current.start) / current.frames;
        current.start = now;
        current.frames = 0;
        current.slow = frameTime > 28 ? current.slow + 1 : 0;
        if (current.slow < 2) return;
        current.slow = 0;
        current.dpr = current.dpr > 0.8 ? 0.8 : 0.6;
        onChange(current.dpr);
    });

    return null;
}

// Walls hide everything except through doorways, so a neighbouring room is drawn
// (and its resident animated) only while a doorway to it is in view.

const doorwayBoxes = DOORWAYS.map((doorway) => ({
    doorway,
    box: new THREE.Box3(
        new THREE.Vector3(doorway.x - WALL_GAP, FLOOR_Y, DOORWAY_Z - DOORWAY_WIDTH / 2),
        new THREE.Vector3(doorway.x + WALL_GAP, FLOOR_Y + DOORWAY_HEIGHT, DOORWAY_Z + DOORWAY_WIDTH / 2),
    ),
}));
const frontDoorBox = new THREE.Box3(
    new THREE.Vector3(FRONT_DOOR.x - DOORWAY_WIDTH / 2, FLOOR_Y, ROOM_BOUNDS.jenny.maxZ - 0.05),
    new THREE.Vector3(FRONT_DOOR.x + DOORWAY_WIDTH / 2, FLOOR_Y + DOORWAY_HEIGHT, ROOM_BOUNDS.jenny.maxZ + WALL_GAP + 0.05),
);

function VisibilityControl({ outside }: { outside: boolean }) {
    const { camera, scene } = useThree();
    // An auto-updating root recomputes every world matrix in the scene each
    // frame. Only things that move update themselves (avatars, doors, camera).
    useEffect(() => {
        scene.matrixAutoUpdate = false;
        scene.updateMatrix();
    }, [scene]);
    const frustum = useMemo(() => new THREE.Frustum(), []);
    const matrix = useMemo(() => new THREE.Matrix4(), []);

    // Runs before everything that reads the result.
    useFrame(() => {
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const rooms = sceneVisibility.rooms;
        rooms.clear();
        const here = roomAt(camera.position.x, camera.position.z);
        const frontDoorInView = frustum.intersectsBox(frontDoorBox);
        if (here) {
            rooms.add(here);
            for (const { doorway, box } of doorwayBoxes) {
                if ((doorway.west === here || doorway.east === here) && frustum.intersectsBox(box)) {
                    rooms.add(doorway.west === here ? doorway.east : doorway.west);
                }
            }
        } else if (insideHouse(camera.position.x, camera.position.z)) {
            // In a doorway between rooms (e.g. during a flight): show everything.
            for (const id of ROOM_ORDER) rooms.add(id);
        } else if (frontDoorInView) {
            rooms.add("jenny");
        }
        sceneVisibility.outdoors = !here || (outside && here === "jenny" && frontDoorInView);
    }, -1);

    return null;
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

/** The camera's view straight onto a character's PC screen, filling most of the free space. */
function pcViewOf(id: CharacterId, width: number, height: number) {
    const pc = PCS[id];
    const aspect = width / height;
    const fov = aspect < 1 ? 62 : 40;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const fill = 0.68;
    const distance = Math.max((pc.width / 2 / fill) / (tanHalf * aspect), (pc.height / 2 / fill) / tanHalf);
    const normal = new THREE.Vector3(Math.sin(pc.yaw), 0, Math.cos(pc.yaw));
    const right = new THREE.Vector3(Math.cos(pc.yaw), 0, -Math.sin(pc.yaw));
    const target = new THREE.Vector3(...pc.position);
    // Keep the screen clear of the transcript: left quarter on wide screens, top half on phones.
    if (width >= 900) target.addScaledVector(right, -tanHalf * aspect * distance * 0.3);
    if (aspect < 1) target.y += tanHalf * distance * 0.3;
    return { position: target.clone().addScaledVector(normal, distance), target, fov };
}

/** Just outside the front door, looking out into the forest. */
function outsideView(width: number, height: number) {
    const position = OUTSIDE_START.clone();
    position.y = heightAt(position.x, position.z) + 1.6;
    return { position, target: position.clone().add(new THREE.Vector3(0, -0.15, 6)), fov: width / height < 1 ? 62 : 55 };
}

/** The front door leaf in Jenny's south wall; it swings open when someone goes out. */
function FrontDoor({ open, onOpen }: { open: boolean; onOpen: () => void }) {
    const hinge = useRef<THREE.Group>(null);
    const [hovered, setHovered] = useState(false);
    useFrame((_, delta) => {
        if (!hinge.current) return;
        // Opens into the room; outside there is only the wall gap.
        const target = open ? 1.8 : 0;
        hinge.current.rotation.y += (target - hinge.current.rotation.y) * Math.min(1, delta * 5);
    });
    return (
        <group ref={hinge} position={[FRONT_DOOR.x - DOORWAY_WIDTH / 2, FLOOR_Y, ROOM_BOUNDS.jenny.maxZ - 0.03]}>
            <group position={[DOORWAY_WIDTH / 2, 0, 0]}>
                <mesh
                    position={[0, 1.03, 0]}
                    onPointerOver={(event) => { event.stopPropagation(); setHovered(true); setCursor(true); }}
                    onPointerOut={() => { setHovered(false); setCursor(false); }}
                    onClick={(event) => {
                        if (!isClick(event) || open) return;
                        event.stopPropagation();
                        setHovered(false);
                        setCursor(false);
                        onOpen();
                    }}
                >
                    <boxGeometry args={[DOORWAY_WIDTH - 0.04, 2.06, 0.05]} />
                    <meshStandardMaterial color="#8a5430" roughness={0.6} />
                    {hovered && !open && (
                        <Html center position={[0, 0.5, 0]} pointerEvents="none" zIndexRange={[30, 0]}>
                            <div className="sceneTooltip" style={{ "--member-color": "#7fc28a" } as CSSProperties}>
                                <strong>🌲 Go outside</strong>
                                <small>Into the forest and to the lakes</small>
                            </div>
                        </Html>
                    )}
                </mesh>
                {[[-0.2, 1.45], [0.2, 1.45], [-0.2, 0.55], [0.2, 0.55]].map(([x, y]) => (
                    <mesh key={`${x}${y}`} position={[x, y, -0.03]}>
                        <boxGeometry args={[0.3, y > 1 ? 0.75 : 0.85, 0.012]} />
                        <meshStandardMaterial color="#7a4927" roughness={0.65} />
                    </mesh>
                ))}
                <mesh position={[0.38, 1.0, -0.05]}>
                    <sphereGeometry args={[0.035, 12, 10]} />
                    <meshStandardMaterial color="#e3c27a" metalness={0.6} roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
}

type Flight = { curve: THREE.CatmullRomCurve3; from: THREE.Vector3; to: THREE.Vector3; start: number; duration: number; key: string };

/**
 * Keeps the camera on the addressed character's room, or on a PC when one is
 * focused. Moving to another room flies through the doorways in between;
 * afterwards the user can orbit freely inside the room (not at a PC).
 */
function CameraRig({ roomId, focusPcId, outside, onSettled }: {
    roomId: CharacterId;
    focusPcId: CharacterId | null;
    outside: boolean;
    /** Called with "room:<id>" or "pc:<id>" once the camera has arrived. */
    onSettled: (key: string) => void;
}) {
    const { camera, size, controls } = useThree();
    const flight = useRef<Flight | null>(null);
    const shown = useRef<string | null>(null);
    const lookTarget = useRef(new THREE.Vector3());
    const destination = focusPcId ?? roomId;
    const key = outside ? "outside" : focusPcId ? `pc:${focusPcId}` : `room:${roomId}`;

    useEffect(() => {
        const perspective = camera as THREE.PerspectiveCamera;
        const view = outside ? outsideView(size.width, size.height)
            : focusPcId ? pcViewOf(focusPcId, size.width, size.height) : viewOf(roomId, size.width, size.height);
        perspective.fov = view.fov;
        perspective.updateProjectionMatrix();
        const orbit = controls as OrbitControlsImpl | null;

        if (shown.current === null || shown.current === key) {
            // First frame or a resize: just frame it.
            camera.position.copy(view.position);
            orbit?.target.copy(view.target);
            if (outside) {
                // A resize while walking outside: the walker owns the camera.
                shown.current = key;
                return;
            }
            camera.position.copy(view.position);
            orbit?.target.copy(view.target);
            if (orbit) {
                orbit.enabled = !focusPcId;
                orbit.update();
            } else {
                camera.lookAt(view.target);
            }
            shown.current = key;
            onSettled(key);
            return;
        }

        const eyeY = FLOOR_Y + 1.5;
        const points = [camera.position.clone()];
        const doorInside = new THREE.Vector3(FRONT_DOOR.x, eyeY, ROOM_BOUNDS.jenny.maxZ - 1.2);
        const doorGap = new THREE.Vector3(FRONT_DOOR.x, eyeY, FRONT_DOOR.z);
        const doorOutside = new THREE.Vector3(FRONT_DOOR.x, eyeY, ROOM_BOUNDS.jenny.maxZ + 1.6);
        const cameraOutside = !roomAt(camera.position.x, camera.position.z) && !insideHouse(camera.position.x, camera.position.z);
        // Coming in from outside: through the front door into Jenny's room first.
        if (cameraOutside) points.push(doorOutside, doorGap, doorInside);
        const fromRoom = cameraOutside ? "jenny" : roomAt(camera.position.x, camera.position.z) ?? destination;
        const toRoom = outside ? "jenny" : destination;
        const from = ROOM_ORDER.indexOf(fromRoom);
        const to = ROOM_ORDER.indexOf(toRoom);
        const direction = Math.sign(to - from);
        // Walk through each doorway between the two rooms, entering head-on.
        for (let index = from; index !== to; index += direction) {
            const doorway = DOORWAYS[Math.min(index, index + direction)];
            points.push(new THREE.Vector3(doorway.x - direction * 0.9, eyeY, DOORWAY_Z));
            points.push(new THREE.Vector3(doorway.x + direction * 0.9, eyeY, DOORWAY_Z));
        }
        // Going out: through Jenny's front door.
        if (outside) points.push(doorInside, doorGap, doorOutside);
        points.push(view.position);
        const doors = Math.abs(to - from) + (outside || cameraOutside ? 1 : 0);
        flight.current = {
            curve: new THREE.CatmullRomCurve3(points, false, "centripetal"),
            from: orbit?.target.clone() ?? view.target.clone(),
            to: view.target,
            start: performance.now(),
            duration: (doors ? 700 : 900) + 900 * doors,
            key,
        };
        if (orbit) orbit.enabled = false;
        shown.current = key;
        // onSettled is stable (a state setter).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [camera, size.width, size.height, controls, key]);

    useFrame(() => {
        const orbit = controls as OrbitControlsImpl | null;
        const current = flight.current;
        if (current) {
            const t = Math.min(1, (performance.now() - current.start) / current.duration);
            const eased = easeInOut(t);
            camera.position.copy(current.curve.getPointAt(eased));
            // Look along the path, starting from the old focus and ending on the destination.
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
                    // Stay put in front of a PC or while walking outside; orbit freely in a room.
                    orbit.enabled = current.key.startsWith("room:");
                    orbit.update();
                }
                onSettled(current.key);
            }
            return;
        }

        if (outside) return;
        // Keep the orbiting camera inside the current room.
        const bounds = ROOM_BOUNDS[destination];
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

/** Pixel width of the feed page on a PC screen; drei maps it onto the screen's real width. */
const FEED_PIXELS = 520;

function PcScreenSpot({ id, focused, settled, onFocus, onOpenYouTube }: {
    id: CharacterId;
    focused: boolean;
    settled: boolean;
    onFocus: (id: CharacterId) => void;
    onOpenYouTube: (request: { feed: CharacterId; videoId?: string }) => void;
}) {
    const pc = PCS[id];
    const [hovered, setHovered] = useState(false);
    const character = CHARACTER_BY_ID[id];

    return (
        <group position={pc.position} rotation={[0, pc.yaw, 0]}>
            {!focused && (
                <mesh
                    position={[0, 0, 0.004]}
                    onPointerOver={(event) => { event.stopPropagation(); setHovered(true); setCursor(true); }}
                    onPointerOut={() => { setHovered(false); setCursor(false); }}
                    onClick={(event) => {
                        if (!isClick(event)) return;
                        event.stopPropagation();
                        setHovered(false);
                        setCursor(false);
                        onFocus(id);
                    }}
                >
                    <planeGeometry args={[pc.width, pc.height]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                    {hovered && (
                        <Html center position={[0, pc.height / 2 + 0.09, 0]} pointerEvents="none" zIndexRange={[30, 0]}>
                            <div className="sceneTooltip" style={{ "--member-color": "#ff4e4e" } as CSSProperties}>
                                <strong>▶ {character.name}'s YouTube</strong>
                                <small>Click to sit down at the PC</small>
                            </div>
                        </Html>
                    )}
                </mesh>
            )}
            {/* Real page on the screen once the camera is in front of it (DOM would show through walls otherwise). */}
            {focused && settled && (
                <Html
                    transform
                    position={[0, 0, 0.003]}
                    distanceFactor={(400 * pc.width) / FEED_PIXELS}
                    zIndexRange={[20, 0]}
                >
                    <MonitorFeed
                        characterId={id}
                        width={FEED_PIXELS}
                        height={Math.round((FEED_PIXELS * pc.height) / pc.width)}
                        onOpenVideo={(videoId) => onOpenYouTube({ feed: id, videoId })}
                        onOpenYouTube={() => onOpenYouTube({ feed: id })}
                    />
                </Html>
            )}
        </group>
    );
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

// The first draw of a mesh uploads its vertex buffers and its morph-target and
// bone textures. For a whole avatar at once that freezes a frame for half a
// second, so each mesh is drawn once beforehand, one per frame, into a single
// pixel that the regular frame paints over right after.
const WARM_LAYER = 31;
const firstDraws: { mesh: THREE.Object3D; root: THREE.Object3D; done?: () => void }[] = [];

/** Resolves once every mesh under `root` has been drawn once. Its meshes must not be frustum culled. */
function drawEachMeshOnce(root: THREE.Object3D) {
    const meshes: THREE.Object3D[] = [];
    root.traverse((object) => { if ((object as THREE.Mesh).isMesh && object.visible) meshes.push(object); });
    return new Promise<void>((resolve) => {
        if (!meshes.length) return resolve();
        meshes.forEach((mesh, index) => firstDraws.push({ mesh, root, done: index === meshes.length - 1 ? resolve : undefined }));
    });
}

function FirstDraws() {
    const { gl, scene, camera } = useThree();
    const scissor = useMemo(() => new THREE.Vector4(), []);
    useFrame(() => {
        const next = firstDraws.shift();
        if (!next) return;
        const { mesh, root } = next;
        const detached = !root.parent;
        if (detached) scene.add(root);
        // Same lights as always, so the draw uses the programs that were compiled.
        for (const child of scene.children) if ((child as THREE.Light).isLight) child.layers.enable(WARM_LAYER);
        mesh.layers.enable(WARM_LAYER);
        const layers = camera.layers.mask;
        camera.layers.set(WARM_LAYER);
        gl.getScissor(scissor);
        const scissorTest = gl.getScissorTest();
        gl.setScissorTest(true);
        gl.setScissor(0, 0, 1, 1);
        gl.render(scene, camera);
        gl.setScissor(scissor);
        gl.setScissorTest(scissorTest);
        camera.layers.mask = layers;
        mesh.layers.disable(WARM_LAYER);
        if (detached) scene.remove(root);
        next.done?.();
    });
    return null;
}

/** Builds a room as a transition, so React yields to typing while creating it. */
function DeferredRoom({ id, onReady, children }: { id: CharacterId; onReady: () => void; children: ReactNode }) {
    const [show, setShow] = useState(false);
    const room = useRef<THREE.Group>(null);
    useEffect(() => startTransition(() => setShow(true)), []);
    useFrame(() => {
        if (room.current) room.current.visible = sceneVisibility.rooms.has(id);
    });
    if (!show) return null;
    return (
        <>
            <group ref={room}>{children}</group>
            {/* The first room also prepares what stands outside any room (door, hotspots). */}
            <RoomWarmUp room={room} wholeScene={id === "jenny"} onReady={onReady} />
        </>
    );
}

function RoomWarmUp({ room, wholeScene, onReady }: { room: RefObject<THREE.Group | null>; wholeScene: boolean; onReady: () => void }) {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
        let cancelled = false;
        // Nothing in a room moves: compute its matrices once and leave it out of
        // the per-frame matrix update from now on.
        const group = room.current;
        if (group) {
            group.traverse((object) => { object.matrixAutoUpdate = false; });
            group.updateMatrixWorld(true);
            group.matrixWorldAutoUpdate = false;
        }
        void prepareForRender(gl, wholeScene ? scene : room.current ?? scene, camera, scene)
            .catch((error) => console.error("Room warm-up failed:", error))
            .then(() => { if (!cancelled) onReady(); });
        return () => { cancelled = true; };
        // Runs once per room; onReady identity changes with every render of the parent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gl, scene, camera, room]);

    return null;
}

/** Network hiccups would leave an avatar missing or in a T-pose; try a couple more times. */
function withRetries<T>(task: () => Promise<T>, retries = 2): Promise<T> {
    return task().catch((error) => {
        if (retries <= 0) throw error;
        return new Promise((resolve) => setTimeout(resolve, 800)).then(() => withRetries(task, retries - 1));
    });
}

let idleAnimation: Promise<GLTF> | null = null;

function loadIdleAnimation() {
    if (!idleAnimation) {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        idleAnimation = withRetries(() => loader.loadAsync("/animations/idle.vrma"));
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
    const outer = useRef<THREE.Group>(null);
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

        withRetries(() => loader.loadAsync(character.avatarUrl)).then(async (gltf) => {
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
                if (!cancelled) await drawEachMeshOnce(loadedVrm.scene);
            } catch (error) {
                console.error("Avatar warm-up failed:", error);
            }
            if (cancelled) return;

            mixerRef.current = mixer;
            setVrm(loadedVrm);
            onReadyRef.current();
        }).catch((error) => {
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
        // Behind walls: neither drawn nor animated (skeleton, hair physics, matrices).
        const inView = sceneVisibility.rooms.has(character.id);
        if (outer.current) {
            outer.current.visible = inView;
            // Skips the skeleton's matrices too, not just drawing.
            outer.current.matrixWorldAutoUpdate = inView;
        }
        if (!inView) return;
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
        <group ref={outer} position={position}>
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
