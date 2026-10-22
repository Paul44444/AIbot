import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import {
    BlobShadow,
    Plant,
    Room,
    canvasTexture,
    doorwayHole,
    makeYouTubeScreenTexture,
    seededRandom,
    type Hole,
} from "./CozyRoom";
import { FLOOR_Y, HEIGHT, ROOM_BOUNDS, center } from "./roomLayout";

// Jinx's den: dusky purple walls, an orange LED strip, gaming desk, posters,
// skateboard and the general mess of a lovable trickster.

const JINX = ROOM_BOUNDS.jinx;
const ORANGE = "#ff9a3c";
const STYLE = { color: "#5f5689", trim: "#2e2943", wainscot: false };

export const JINX_LIGHTS = [
    { position: [center(JINX).x, FLOOR_Y + HEIGHT - 0.5, center(JINX).z], color: "#ffd9bd", intensity: 4, distance: 9, decay: 1.2 },
    // Neon glow above the gaming desk.
    { position: [center(JINX).x - 0.3, FLOOR_Y + 1.9, JINX.minZ + 0.5], color: "#ff7fb0", intensity: 1.6, distance: 4, decay: 1.5 },
] as const;

function makeNeonTexture() {
    return canvasTexture(512, 192, (ctx) => {
        ctx.clearRect(0, 0, 512, 192);
        ctx.font = "bold 108px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#ff4fa0";
        ctx.shadowBlur = 28;
        ctx.fillStyle = "#ffd0e6";
        ctx.fillText("JINX", 195, 100);
        ctx.shadowColor = ORANGE;
        ctx.fillStyle = "#ffe2b0";
        ctx.font = "bold 120px system-ui, sans-serif";
        ctx.fillText("⚡", 430, 104);
    });
}

function makeScreenTexture(seed: number) {
    const random = seededRandom(seed);
    return canvasTexture(256, 160, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, 160);
        sky.addColorStop(0, "#2b1d5c");
        sky.addColorStop(1, "#ff7a59");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, 256, 160);
        ctx.fillStyle = "#1b1433";
        for (let x = 0; x < 256; x += 22) {
            const h = 30 + random() * 70;
            ctx.fillRect(x, 160 - h, 18, h);
        }
        ctx.fillStyle = "#ffe066";
        ctx.fillRect(40 + random() * 150, 60, 14, 14);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "bold 16px monospace";
        ctx.fillText("SCORE 9001", 12, 22);
    });
}

function makePosterTexture(kind: "bolt" | "rules" | "wave") {
    return canvasTexture(256, 360, (ctx) => {
        if (kind === "bolt") {
            ctx.fillStyle = "#1f2a4a";
            ctx.fillRect(0, 0, 256, 360);
            ctx.fillStyle = ORANGE;
            ctx.beginPath();
            ctx.moveTo(150, 30); ctx.lineTo(70, 200); ctx.lineTo(130, 200);
            ctx.lineTo(100, 330); ctx.lineTo(190, 150); ctx.lineTo(130, 150);
            ctx.closePath();
            ctx.fill();
        } else if (kind === "rules") {
            ctx.fillStyle = "#ffcf3f";
            ctx.fillRect(0, 0, 256, 360);
            ctx.fillStyle = "#1b1433";
            ctx.font = "bold 74px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("RULES", 128, 170);
            ctx.fillText("ARE", 128, 245);
            ctx.font = "bold 40px system-ui, sans-serif";
            ctx.fillText("suggestions", 128, 300);
            ctx.strokeStyle = "#e0413c";
            ctx.lineWidth = 12;
            ctx.beginPath(); ctx.moveTo(30, 150); ctx.lineTo(226, 100); ctx.stroke();
        } else {
            const gradient = ctx.createLinearGradient(0, 0, 0, 360);
            gradient.addColorStop(0, "#ff7eb3");
            gradient.addColorStop(1, "#7a5cff");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 360);
            ctx.strokeStyle = "rgba(255,255,255,0.75)";
            ctx.lineWidth = 8;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, 120 + i * 40 + Math.sin(x / 26 + i) * 14);
                ctx.stroke();
            }
        }
    });
}

function Poster({ position, size, texture, tilt = 0 }: { position: [number, number, number]; size: [number, number]; texture: THREE.Texture; tilt?: number }) {
    return (
        <mesh position={position} rotation={[0, 0, tilt]}>
            <planeGeometry args={size} />
            <meshStandardMaterial map={texture} roughness={0.85} />
        </mesh>
    );
}

function GamingDesk({ position }: { position: [number, number, number] }) {
    // The left monitor is his YouTube PC (see PCS in roomLayout); the right one runs a game.
    const screens = useMemo(() => [makeYouTubeScreenTexture("Jinx", "#ffb35c"), makeScreenTexture(9)], []);
    return (
        <group position={position}>
            <BlobShadow size={2.1} opacity={0.6} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.6, 0.05, 0.7]} radius={0.02} position={[0, 0.74, 0]}>
                <meshStandardMaterial color="#26222f" roughness={0.5} />
            </RoundedBox>
            <mesh position={[0, 0.715, 0.35]}>
                <boxGeometry args={[1.6, 0.012, 0.01]} />
                <meshBasicMaterial color={ORANGE} toneMapped={false} />
            </mesh>
            {[-0.72, 0.72].map((x) => (
                <mesh key={x} position={[x, 0.36, 0]}>
                    <boxGeometry args={[0.06, 0.72, 0.6]} />
                    <meshStandardMaterial color="#1c1924" roughness={0.6} />
                </mesh>
            ))}
            {[-0.36, 0.36].map((x, index) => (
                <group key={x} position={[x, 1.08, -0.12]} rotation={[0, x > 0 ? -0.18 : 0.18, 0]}>
                    <mesh>
                        <boxGeometry args={[0.66, 0.42, 0.03]} />
                        <meshStandardMaterial color="#141218" roughness={0.4} />
                    </mesh>
                    <mesh position={[0, 0, 0.016]}>
                        <planeGeometry args={[0.6, 0.36]} />
                        <meshBasicMaterial map={screens[index]} toneMapped={false} />
                    </mesh>
                    <mesh position={[0, -0.28, -0.02]}>
                        <boxGeometry args={[0.05, 0.16, 0.05]} />
                        <meshStandardMaterial color="#141218" />
                    </mesh>
                </group>
            ))}
            <mesh position={[0, 0.775, 0.14]}>
                <boxGeometry args={[0.5, 0.02, 0.16]} />
                <meshStandardMaterial color="#2a2733" roughness={0.6} />
            </mesh>
            <mesh position={[0.38, 0.775, 0.16]}>
                <boxGeometry args={[0.06, 0.02, 0.1]} />
                <meshStandardMaterial color="#2a2733" />
            </mesh>
            {/* Energy drink and headphones. */}
            <mesh position={[-0.6, 0.83, 0.12]}>
                <cylinderGeometry args={[0.035, 0.035, 0.13, 14]} />
                <meshStandardMaterial color={ORANGE} metalness={0.4} roughness={0.35} />
            </mesh>
            <mesh position={[0.66, 0.82, 0.05]} rotation={[0, 0.4, 0]}>
                <torusGeometry args={[0.09, 0.015, 8, 20, Math.PI]} />
                <meshStandardMaterial color="#e8e2f0" roughness={0.5} />
            </mesh>
            {/* Gaming chair, pushed toward the game monitor so the YouTube one stays visible. */}
            <group position={[0.55, 0, 0.8]} rotation={[0, Math.PI + 0.5, 0]}>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.52, 0.1, 0.5]} radius={0.04} position={[0, 0.48, 0]}>
                    <meshStandardMaterial color="#232030" roughness={0.6} />
                </RoundedBox>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.5, 0.82, 0.1]} radius={0.05} position={[0, 0.92, -0.22]} rotation={[-0.12, 0, 0]}>
                    <meshStandardMaterial color="#232030" roughness={0.6} />
                </RoundedBox>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.2, 0.7, 0.11]} radius={0.04} position={[0, 0.92, -0.215]} rotation={[-0.12, 0, 0]}>
                    <meshStandardMaterial color={ORANGE} roughness={0.6} />
                </RoundedBox>
                <mesh position={[0, 0.23, 0]}>
                    <cylinderGeometry args={[0.03, 0.03, 0.42, 10]} />
                    <meshStandardMaterial color="#555" metalness={0.6} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0.03, 0]}>
                    <cylinderGeometry args={[0.28, 0.28, 0.04, 5]} />
                    <meshStandardMaterial color="#1c1924" />
                </mesh>
            </group>
        </group>
    );
}

function LowBed({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <BlobShadow size={2.4} opacity={0.6} />
            <mesh position={[0, 0.12, 0]}>
                <boxGeometry args={[1.5, 0.24, 2.0]} />
                <meshStandardMaterial color="#2e2943" roughness={0.7} />
            </mesh>
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.42, 0.2, 1.92]} radius={0.06} position={[0, 0.32, 0]}>
                <meshStandardMaterial color="#cfd3e0" roughness={0.95} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.46, 0.1, 1.2]} radius={0.05} position={[0.03, 0.43, 0.3]} rotation={[0, 0.06, 0]}>
                <meshStandardMaterial color={ORANGE} roughness={1} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.62, 0.15, 0.38]} radius={0.07} position={[-0.3, 0.5, -0.7]} rotation={[0.2, 0.15, 0]}>
                <meshStandardMaterial color="#8fd3ff" roughness={1} />
            </RoundedBox>
        </group>
    );
}

function Skateboard({ position }: { position: [number, number, number] }) {
    return (
        <group position={position} rotation={[-0.25, 0, 0]}>
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.22, 0.8, 0.02]} radius={0.01} position={[0, 0.4, 0]}>
                <meshStandardMaterial color="#e0413c" roughness={0.6} />
            </RoundedBox>
            {[0.15, 0.65].map((y) => [-0.07, 0.07].map((x) => (
                <mesh key={`${x}${y}`} position={[x, y, 0.035]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.026, 0.026, 0.03, 12]} />
                    <meshStandardMaterial color="#f4f0e6" />
                </mesh>
            )))}
        </group>
    );
}

function BeanBag({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <BlobShadow size={1.1} opacity={0.6} />
            <mesh position={[0, 0.26, 0]} scale={[1, 0.62, 1]}>
                <sphereGeometry args={[0.45, 20, 14]} />
                <meshStandardMaterial color={ORANGE} roughness={1} />
            </mesh>
        </group>
    );
}

function MiniFridge({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <BlobShadow size={0.8} opacity={0.5} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.5, 0.75, 0.5]} radius={0.04} position={[0, 0.375, 0]}>
                <meshStandardMaterial color="#d8e6f0" roughness={0.4} />
            </RoundedBox>
            <mesh position={[0.18, 0.5, 0.255]}>
                <boxGeometry args={[0.03, 0.22, 0.02]} />
                <meshStandardMaterial color="#888" metalness={0.6} roughness={0.3} />
            </mesh>
            <mesh position={[-0.05, 0.45, 0.252]} rotation={[0, 0, 0.2]}>
                <circleGeometry args={[0.07, 5]} />
                <meshStandardMaterial color="#ffcf3f" />
            </mesh>
        </group>
    );
}

export default function JinxRoom() {
    const textures = useMemo(() => ({
        neon: makeNeonTexture(),
        bolt: makePosterTexture("bolt"),
        rules: makePosterTexture("rules"),
        wave: makePosterTexture("wave"),
    }), []);
    const northHoles = useMemo<Hole[]>(() => [{ x: -1.7, y: 1.0, w: 1.2, h: 1.2, curtain: "#3a4570" }], []);
    const eastHoles = useMemo(() => [doorwayHole(JINX, "east")], []);
    const width = JINX.maxX - JINX.minX;
    const depth = JINX.maxZ - JINX.minZ;
    const { x: cx, z: cz } = center(JINX);

    return (
        <Room
            bounds={JINX}
            style={STYLE}
            ceilingColor="#4b4570"
            beams={false}
            floorTones={["#6b4a3a", "#5e4033", "#73503e", "#664535", "#6f4b38"]}
            north={{ holes: northHoles, children: (
                <>
                    <GamingDesk position={[-0.3, 0, 0.4]} />
                    <mesh position={[-0.3, 1.95, 0.02]}>
                        <planeGeometry args={[1.1, 0.41]} />
                        <meshBasicMaterial map={textures.neon} transparent toneMapped={false} depthWrite={false} />
                    </mesh>
                    <Poster position={[2.55, 1.55, 0.01]} size={[0.5, 0.7]} texture={textures.wave} tilt={0.05} />
                </>
            ) }}
            west={{ children: (
                <>
                    <LowBed position={[1.6, 0, 1.05]} />
                    <Poster position={[1.6, 1.6, 0.01]} size={[0.55, 0.77]} texture={textures.rules} tilt={-0.06} />
                    <Poster position={[0.4, 1.5, 0.01]} size={[0.45, 0.63]} texture={textures.bolt} tilt={0.04} />
                    <Skateboard position={[-0.4, 0, 0.12]} />
                    <Plant position={[2.75, 0, 0.3]} scale={1.3} seed={91} />
                </>
            ) }}
            south={{ children: (
                <>
                    <MiniFridge position={[-1.5, 0, 0.3]} />
                    <BeanBag position={[0.4, 0, 0.7]} />
                    <Poster position={[1.6, 1.5, 0.01]} size={[0.5, 0.7]} texture={textures.bolt} tilt={-0.03} />
                </>
            ) }}
            east={{ holes: eastHoles }}
        >
            {/* Orange LED strip under the ceiling along every wall. */}
            {[
                [cx, JINX.minZ + 0.03, width, 0],
                [cx, JINX.maxZ - 0.03, width, 0],
                [JINX.minX + 0.03, cz, depth, Math.PI / 2],
                [JINX.maxX - 0.03, cz, depth, Math.PI / 2],
            ].map(([x, z, length, rotation]) => (
                <mesh key={`${x}${z}`} position={[x, FLOOR_Y + HEIGHT - 0.12, z]} rotation={[0, rotation, 0]}>
                    <boxGeometry args={[length, 0.025, 0.025]} />
                    <meshBasicMaterial color={ORANGE} toneMapped={false} />
                </mesh>
            ))}
            {/* Round rug, a controller and a pizza box. */}
            <mesh position={[cx - 0.4, FLOOR_Y + 0.006, cz - 0.5]}>
                <cylinderGeometry args={[1.25, 1.25, 0.012, 40]} />
                <meshStandardMaterial color="#3f9bb0" roughness={1} />
            </mesh>
            <mesh position={[cx - 0.4, FLOOR_Y + 0.008, cz - 0.5]}>
                <cylinderGeometry args={[0.85, 0.85, 0.013, 40]} />
                <meshStandardMaterial color="#64c2d4" roughness={1} />
            </mesh>
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.16, 0.04, 0.1]} radius={0.02} position={[cx + 0.3, FLOOR_Y + 0.035, cz + 0.4]} rotation={[0, 0.6, 0]}>
                <meshStandardMaterial color="#2a2733" roughness={0.6} />
            </RoundedBox>
            <mesh position={[cx + 1.6, FLOOR_Y + 0.025, cz + 1.4]} rotation={[0, 0.3, 0]}>
                <boxGeometry args={[0.42, 0.05, 0.42]} />
                <meshStandardMaterial color="#d9b77c" roughness={0.9} />
            </mesh>
            <mesh position={[cx, FLOOR_Y + HEIGHT - 0.03, cz]}>
                <cylinderGeometry args={[0.35, 0.35, 0.04, 28]} />
                <meshStandardMaterial color="#fff0e2" emissive="#ffb38a" emissiveIntensity={1.4} />
            </mesh>
        </Room>
    );
}
