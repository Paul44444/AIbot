import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import {
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import CozyRoom, { BlobShadow } from "./CozyRoom";

type SceneViewProps = {
    isSpeaking: boolean;
    expression: string;
    avatarUrl: string;
    onProgress: (progress: number) => void;
};

export default function SceneView({ isSpeaking, expression, avatarUrl, onProgress }: SceneViewProps) {
    const [roomReady, setRoomReady] = useState(false);
    const handleRoomReady = useCallback(() => setRoomReady(true), []);
    const [readyAvatar, setReadyAvatar] = useState<string | null>(null);
    const [avatarProgress, setAvatarProgress] = useState(0);
    const revealed = useRef(false);

    useEffect(() => {
        onProgress(Math.min(0.96, 0.3 + avatarProgress * 0.66));
    }, [avatarProgress, onProgress]);

    useEffect(() => {
        if (roomReady && readyAvatar === avatarUrl) onProgress(1);
    }, [roomReady, readyAvatar, avatarUrl, onProgress]);

    // Reveal the room as soon as it can render; the avatar joins whenever it is ready.
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
        <div
            className="sceneView"
            tabIndex={0}
            aria-label="3D room. Click here, then use WASD or arrow keys to walk."
            onPointerDownCapture={(event) => event.currentTarget.focus()}
        >
            <Canvas
                className="backgroundCanvas1"
                dpr={[1, 1.25]}
                camera={{ position: [0.5, -0.3, 0.5] }}
                // Nothing is drawn until shaders and textures are prepared without blocking.
                frameloop={roomReady ? "always" : "never"}
            >
                <ambientLight intensity={1.4} />
                <DeferredRoom onReady={handleRoomReady} />
                <Character
                    isSpeaking={isSpeaking}
                    expression={expression}
                    avatarUrl={avatarUrl}
                    onReady={setReadyAvatar}
                    onProgress={setAvatarProgress}
                />
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
    isSpeaking,
    expression,
    avatarUrl,
    onReady,
    onProgress,
}: Omit<SceneViewProps, "onProgress"> & {
    onReady: (url: string) => void;
    onProgress: (progress: number) => void;
}) {
    const group = useRef<THREE.Group>(null);
    const [vrm, setVrm] = useState<VRM | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const pressedKeysRef = useRef(new Set<string>());
    const movingRef = useRef(false);
    const movementVectorRef = useRef(new THREE.Vector2());
    const { size, gl, camera, scene } = useThree();
    // The previous avatar stays visible while the next one loads, so pose it by its own URL.
    const shownAvatarUrl: string = vrm?.scene.userData.loadedAvatarUrl ?? avatarUrl;
    const isJenny = shownAvatarUrl.endsWith("/jenny.vrm");
    const characterX = size.width >= 700 && size.width < 1300
        ? THREE.MathUtils.clamp((1300 - size.width) / 1000, 0, 0.6)
        : 0;
    const characterRotationY = Math.PI + 1 + (isJenny ? Math.PI : 0);
    const characterScale = isJenny ? 1.12 : 1;

    useEffect(() => {
        if (vrm?.scene.userData.loadedAvatarUrl === avatarUrl) onReady(avatarUrl);
    }, [vrm, avatarUrl, onReady]);

    useEffect(() => {
        const updateKey = (event: KeyboardEvent, pressed: boolean) => {
            const target = event.target as HTMLElement | null;
            if (target?.matches("input, textarea, select") || target?.isContentEditable) return;

            const keyByCode: Record<string, string> = {
                KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d",
                ArrowUp: "arrowup", ArrowLeft: "arrowleft",
                ArrowDown: "arrowdown", ArrowRight: "arrowright",
            };
            const key = keyByCode[event.code] ?? event.key.toLowerCase();
            if (!["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) return;

            event.preventDefault();
            if (pressed) pressedKeysRef.current.add(key);
            else pressedKeysRef.current.delete(key);
        };
        const keyDown = (event: KeyboardEvent) => updateKey(event, true);
        const keyUp = (event: KeyboardEvent) => updateKey(event, false);
        const clearKeys = () => pressedKeysRef.current.clear();

        window.addEventListener("keydown", keyDown);
        window.addEventListener("keyup", keyUp);
        window.addEventListener("blur", clearKeys);
        return () => {
            window.removeEventListener("keydown", keyDown);
            window.removeEventListener("keyup", keyUp);
            window.removeEventListener("blur", clearKeys);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        onProgress(0.04);

        loader.load(avatarUrl, async (gltf) => {
            const loadedVrm = gltf.userData.vrm as VRM;
            if (cancelled) return;
            loadedVrm.scene.userData.loadedAvatarUrl = avatarUrl;
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
                    mixer.clipAction(createVRMAnimationClip(animation, loadedVrm)).play();
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

            mixerRef.current?.stopAllAction();
            mixerRef.current = mixer;
            onProgress(1);
            setVrm(loadedVrm);
        }, (event) => {
            if (!cancelled && event.lengthComputable && event.total > 0) {
                onProgress(Math.min(0.96, 0.04 + (event.loaded / event.total) * 0.92));
            }
        }, (error) => console.error(`Failed to load avatar ${avatarUrl}:`, error));

        return () => {
            cancelled = true;
        };
        // gl, camera and scene are stable for the canvas' lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [avatarUrl, onProgress]);

    useFrame((_, delta) => {
        if (!vrm) return;
        const character = group.current;
        const time = performance.now() / 1000;

        if (character) {
            const keys = pressedKeysRef.current;
            const moveX = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
            const moveZ = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
            movingRef.current = moveX !== 0 || moveZ !== 0;

            if (movingRef.current) {
                const direction = movementVectorRef.current.set(moveX, moveZ).normalize();
                character.position.x = THREE.MathUtils.clamp(character.position.x + direction.x * 1.1 * delta, -1.2, 1.8);
                character.position.z = THREE.MathUtils.clamp(character.position.z + direction.y * 1.1 * delta, -1.4, 1.2);
                const facingOffset = 1 + (isJenny ? Math.PI : 0);
                character.rotation.y = THREE.MathUtils.lerp(
                    character.rotation.y,
                    Math.atan2(direction.x, direction.y) + facingOffset,
                    1 - Math.exp(-12 * delta)
                );
            }
        }

        vrm.expressionManager?.setValue("aa", isSpeaking
            ? 0.15 + 0.65 * Math.abs(Math.sin(time * 10))
            : 0);
        vrm.expressionManager?.setValue("blink", Math.sin(time * 3) > 0.97 ? 1 : 0);

        for (const name of ["happy", "sad", "angry", "relaxed", "Surprised"]) {
            vrm.expressionManager?.setValue(name, 0);
        }
        vrm.expressionManager?.setValue(expression, expression === "relaxed" ? 0.2 : expression === "happy" ? 0.5 : 1);

        mixerRef.current?.update(delta);
        if (movingRef.current) {
            const stride = Math.sin(time * 9) * 0.34;
            vrm.humanoid.getNormalizedBoneNode("leftUpperLeg")?.rotateX(stride);
            vrm.humanoid.getNormalizedBoneNode("rightUpperLeg")?.rotateX(-stride);
            vrm.humanoid.getNormalizedBoneNode("leftUpperArm")?.rotateX(-stride * 0.65);
            vrm.humanoid.getNormalizedBoneNode("rightUpperArm")?.rotateX(stride * 0.65);
        }
        vrm.update(delta);
    });

    if (!vrm) return null;
    return (
        <group ref={group} rotation={[0, characterRotationY, 0]} position={[characterX, -2, 0]}>
            <primitive object={vrm.scene} scale={characterScale} />
            <BlobShadow size={0.9} />
        </group>
    );
}
