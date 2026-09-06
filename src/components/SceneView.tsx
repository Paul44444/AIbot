import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import {
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";

type SceneViewProps = {
    isSpeaking: boolean;
    expression: string;
    avatarUrl: string;
};

export default function SceneView({ isSpeaking, expression, avatarUrl }: SceneViewProps) {
    const [roomReady, setRoomReady] = useState(false);
    const [readyAvatar, setReadyAvatar] = useState<string | null>(null);
    const revealed = useRef(false);

    useEffect(() => {
        if (revealed.current || !roomReady || readyAvatar !== avatarUrl) return;

        let secondFrame = 0;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                document.documentElement.dataset.sceneReady = "true";
                revealed.current = true;
            });
        });

        return () => {
            cancelAnimationFrame(firstFrame);
            cancelAnimationFrame(secondFrame);
        };
    }, [roomReady, readyAvatar, avatarUrl]);

    return (
        <div
            className="sceneView"
            tabIndex={0}
            aria-label="3D room. Click here, then use WASD or arrow keys to walk."
            onPointerDownCapture={(event) => event.currentTarget.focus()}
        >
            <Canvas
                className="backgroundCanvas1"
                dpr={[1, 1.5]}
                camera={{ position: [0.5, -0.3, 0.5] }}
            >
                <ambientLight intensity={2} />
                <directionalLight position={[0, -2.6, 0]} intensity={0} />
                <Room onReady={setRoomReady} />
                <Character
                    isSpeaking={isSpeaking}
                    expression={expression}
                    avatarUrl={avatarUrl}
                    onReady={setReadyAvatar}
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
    avatarUrl,
    onReady,
}: SceneViewProps & { onReady: (url: string) => void }) {
    const group = useRef<THREE.Group>(null);
    const [vrm, setVrm] = useState<VRM | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const pressedKeysRef = useRef(new Set<string>());
    const movingRef = useRef(false);
    const movementVectorRef = useRef(new THREE.Vector2());
    const { size } = useThree();
    const isJenny = avatarUrl.endsWith("/jenny.vrm");
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
        setVrm(null);
        mixerRef.current = null;

        loader.load(avatarUrl, (gltf) => {
            const loadedVrm = gltf.userData.vrm as VRM;
            if (cancelled) return;

            loadedVrm.scene.userData.loadedAvatarUrl = avatarUrl;
            setVrm(loadedVrm);

            const loadIdleAnimation = async () => {
                const animationLoader = new GLTFLoader();
                animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
                const animationGltf = await animationLoader.loadAsync("/animations/idle.vrma");
                if (cancelled) return;
                const animation = animationGltf.userData.vrmAnimations?.[0];
                if (!animation) return;

                const mixer = new THREE.AnimationMixer(loadedVrm.scene);
                mixerRef.current = mixer;
                mixer.clipAction(createVRMAnimationClip(animation, loadedVrm)).play();
            };
            void loadIdleAnimation().catch((error) => console.error("Idle animation failed:", error));
        }, undefined, (error) => console.error(`Failed to load avatar ${avatarUrl}:`, error));

        return () => {
            cancelled = true;
            mixerRef.current?.stopAllAction();
            mixerRef.current = null;
        };
    }, [avatarUrl]);

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
        </group>
    );
}

function Room({ onReady }: { onReady: (ready: boolean) => void }) {
    const { scene, gl } = useThree();

    useEffect(() => {
        const spark = new SparkRenderer({
            renderer: gl,
            lodSplatScale: 0.06,
            lodRenderScale: 0.15,
        });
        let reportedReady = false;
        const previousAfterRender = spark.onAfterRender.bind(spark);
        spark.onAfterRender = (...args) => {
            previousAfterRender(...args);
            if (!reportedReady && spark.activeSplats > 0) {
                reportedReady = true;
                onReady(true);
            }
        };

        const room = new SplatMesh({ url: "/model/room-lod.rad", paged: true });
        room.position.set(1.5, -0.86, -0.2);
        room.rotation.set(0, 1.5, 0);
        room.scale.setScalar(1);
        scene.add(spark);
        scene.add(room);

        return () => {
            scene.remove(room);
            scene.remove(spark);
            room.dispose();
            spark.dispose();
        };
    }, [scene, gl, onReady]);

    return null;
}
