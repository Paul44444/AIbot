import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import {
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import CozyRoom, { BlobShadow } from "./CozyRoom";
import { CHARACTERS, type Character as GroupMember, type CharacterId } from "../data/characters";

type SceneViewProps = {
    speakingId: CharacterId | null;
    addresseeId: CharacterId;
    expression: string;
    onProgress: (progress: number) => void;
};

// The group stands in a loose semicircle facing the default camera.
const GROUP_CENTER = new THREE.Vector3(0, -2, 0);
const TOWARD_CAMERA = new THREE.Vector3(1, 0, 1).normalize();
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const SEATS: Record<CharacterId, { side: number; forward: number }> = {
    bob: { side: -0.82, forward: 0.25 },
    jenny: { side: 0, forward: 0 },
    smyth: { side: 0.82, forward: 0.25 },
};

function seatPosition(id: CharacterId) {
    const seat = SEATS[id];
    return GROUP_CENTER.clone()
        .addScaledVector(SCREEN_RIGHT, seat.side)
        .addScaledVector(TOWARD_CAMERA, seat.forward);
}

export default function SceneView({ speakingId, addresseeId, expression, onProgress }: SceneViewProps) {
    const [roomReady, setRoomReady] = useState(false);
    const handleRoomReady = useCallback(() => setRoomReady(true), []);
    // Avatars load one after another so their setup never piles up on the main thread.
    const [loadedIds, setLoadedIds] = useState<CharacterId[]>([]);
    const handleAvatarReady = useCallback((id: CharacterId) => {
        setLoadedIds((previous) => previous.includes(id) ? previous : [...previous, id]);
    }, []);
    const heads = useRef(new Map<CharacterId, THREE.Object3D>());
    const revealed = useRef(false);

    useEffect(() => {
        onProgress(roomReady ? 0.4 + (loadedIds.length / CHARACTERS.length) * 0.6 : 0.3);
    }, [roomReady, loadedIds, onProgress]);

    // Reveal the room as soon as it can render; the avatars join whenever they are ready.
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
        <div className="sceneView" aria-label="3D room with the group">
            <Canvas
                className="backgroundCanvas1"
                dpr={[1, 1.25]}
                camera={{ position: [1.5, -0.5, 1.5] }}
                // Nothing is drawn until shaders and textures are prepared without blocking.
                frameloop={roomReady ? "always" : "never"}
            >
                <ambientLight intensity={1.4} />
                <DeferredRoom onReady={handleRoomReady} />
                {CHARACTERS.map((character, index) => index <= loadedIds.length && (
                    <Character
                        key={character.id}
                        character={character}
                        isSpeaking={speakingId === character.id}
                        isAddressed={addresseeId === character.id}
                        speakingId={speakingId}
                        expression={speakingId === character.id ? expression : "relaxed"}
                        heads={heads.current}
                        onReady={handleAvatarReady}
                    />
                ))}
                <OrbitControls makeDefault enablePan enableZoom enableRotate />
                <CameraRig />
            </Canvas>
        </div>
    );
}

/** Frames the whole group for the current screen shape; the user can still orbit afterwards. */
function CameraRig() {
    const { camera, size, controls } = useThree();

    useEffect(() => {
        const perspective = camera as THREE.PerspectiveCamera;
        const aspect = size.width / size.height;
        // A longer lens frames the group waist-up; portrait screens need a wider one.
        perspective.fov = aspect < 1 ? 62 : 40;
        perspective.updateProjectionMatrix();
        const halfWidth = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)) * aspect;
        // Keep about 3.8 m of the group in view, as far as the room allows.
        const distance = THREE.MathUtils.clamp(1.9 / halfWidth, 1.6, 4.2);
        const target = GROUP_CENTER.clone().add(new THREE.Vector3(0, 1.35, 0));
        // On wide screens the transcript covers the left quarter; shift the group right.
        if (size.width >= 900) target.addScaledVector(SCREEN_RIGHT, -0.42);
        // On phones the transcript covers the upper half; aim higher so the group sits below it.
        if (aspect < 1) target.y += 0.65;
        camera.position.copy(target).addScaledVector(TOWARD_CAMERA, distance).add(new THREE.Vector3(0, 0.1, 0));
        const orbit = controls as OrbitControlsImpl | null;
        if (orbit) {
            orbit.target.copy(target);
            orbit.update();
        } else {
            camera.lookAt(target);
        }
    }, [camera, size.width, size.height, controls]);

    return null;
}

const nextIdleSlot = () => new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 120 });
    else requestAnimationFrame(() => resolve());
});

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
        await nextIdleSlot();
        program.getUniforms();
        program.getAttributes();
    }
    for (const texture of textures) {
        await nextIdleSlot();
        gl.initTexture(texture);
    }
}

/** Builds the room as a transition, so React yields to typing while creating it. */
function DeferredRoom({ onReady }: { onReady: () => void }) {
    const [show, setShow] = useState(false);
    useEffect(() => startTransition(() => setShow(true)), []);
    if (!show) return null;
    return (
        <>
            <CozyRoom />
            <RoomWarmUp onReady={onReady} />
        </>
    );
}

function RoomWarmUp({ onReady }: { onReady: () => void }) {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
        let cancelled = false;
        void prepareForRender(gl, scene, camera, scene)
            .catch((error) => console.error("Room warm-up failed:", error))
            .then(() => { if (!cancelled) onReady(); });
        return () => { cancelled = true; };
    }, [gl, scene, camera, onReady]);

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
    speakingId,
    expression,
    heads,
    onReady,
}: {
    character: GroupMember;
    isSpeaking: boolean;
    isAddressed: boolean;
    speakingId: CharacterId | null;
    expression: string;
    heads: Map<CharacterId, THREE.Object3D>;
    onReady: (id: CharacterId) => void;
}) {
    const group = useRef<THREE.Group>(null);
    const [vrm, setVrm] = useState<VRM | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const { gl, camera, scene } = useThree();
    const position = useRef(seatPosition(character.id)).current;
    const scale = character.id === "jenny" ? 1.12 : 1;

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
                    // Offset the clip so the group does not breathe in unison.
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
            try {
                await prepareForRender(gl, loadedVrm.scene, camera, scene);
            } catch (error) {
                console.error("Avatar warm-up failed:", error);
            }
            if (cancelled) return;

            mixerRef.current = mixer;
            const head = loadedVrm.humanoid.getRawBoneNode("head");
            if (head) heads.set(character.id, head);
            setVrm(loadedVrm);
            onReady(character.id);
        }, undefined, (error) => {
            console.error(`Failed to load ${character.name}:`, error);
            // Let the next avatar load anyway.
            if (!cancelled) onReady(character.id);
        });

        return () => {
            cancelled = true;
            heads.delete(character.id);
        };
        // gl, camera and scene are stable for the canvas' lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character, heads, onReady]);

    const lookTarget = useRef(new THREE.Vector3());
    const speakerPosition = useRef(new THREE.Vector3());

    useFrame((_, delta) => {
        if (!vrm || !group.current) return;
        const time = performance.now() / 1000;

        // Listeners turn toward whoever is talking; otherwise everyone faces the user.
        const speakerHead = speakingId && speakingId !== character.id ? heads.get(speakingId) : null;
        const towardCamera = Math.atan2(camera.position.x - position.x, camera.position.z - position.z);
        let yaw = towardCamera;
        if (speakerHead) {
            speakerHead.getWorldPosition(speakerPosition.current);
            const towardSpeaker = Math.atan2(speakerPosition.current.x - position.x, speakerPosition.current.z - position.z);
            const difference = Math.atan2(Math.sin(towardSpeaker - towardCamera), Math.cos(towardSpeaker - towardCamera));
            yaw = towardCamera + difference * 0.55;
        }
        // VRM 0.x models face -Z, VRM 1.0 models face +Z.
        if (vrm.meta.metaVersion === "0") yaw += Math.PI;
        const current = group.current.rotation.y;
        const turn = Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current));
        group.current.rotation.y = current + turn * (1 - Math.exp(-4 * delta));

        if (vrm.lookAt) {
            if (speakerHead) lookTarget.current.copy(speakerPosition.current);
            else camera.getWorldPosition(lookTarget.current);
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

    if (!vrm) return null;
    return (
        <group ref={group} position={position}>
            <primitive object={vrm.scene} scale={scale} />
            <BlobShadow size={0.9} />
        </group>
    );
}
