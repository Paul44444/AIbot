import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import {
    BlobShadow,
    Books,
    Plant,
    Monitor,
    Room,
    canvasTexture,
    makeYouTubeScreenTexture,
    doorwayHole,
    type Hole,
} from "./CozyRoom";
import { FLOOR_Y, HEIGHT, ROOM_BOUNDS, center } from "./roomLayout";

// Smyth's study: sage walls above dark panelling, a chalkboard full of
// formulas, tall bookshelves, a microscope and a telescope by the window.

const SMYTH = ROOM_BOUNDS.smyth;
const WALNUT = "#5c3b27";
const STYLE = { color: "#c3d1c8", trim: "#4b3424", wainscot: true };

export const SMYTH_LIGHTS = [
    { position: [center(SMYTH).x, FLOOR_Y + HEIGHT - 0.5, center(SMYTH).z], color: "#ffecd2", intensity: 4.4, distance: 9, decay: 1.2 },
] as const;

function makeChalkboardTexture() {
    return canvasTexture(512, 256, (ctx) => {
        ctx.fillStyle = "#2f4a3c";
        ctx.fillRect(0, 0, 512, 256);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 512, Math.random() * 256, 60, 2);
        ctx.fillStyle = "rgba(240, 240, 230, 0.88)";
        ctx.font = "26px Georgia, serif";
        ctx.fillText("E = mc²", 30, 50);
        ctx.fillText("∇·E = ρ/ε₀", 300, 60);
        ctx.fillText("p(x) = e^(−x²/2) / √(2π)", 40, 130);
        ctx.fillText("Δx·Δp ≥ ħ/2", 330, 140);
        ctx.font = "22px Georgia, serif";
        ctx.fillText("n = 30 → σ/√n ?", 60, 210);
        ctx.strokeStyle = "rgba(240, 240, 230, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(300, 230);
        for (let x = 0; x <= 170; x += 5) ctx.lineTo(300 + x, 230 - 70 * Math.exp(-((x - 85) ** 2) / 900));
        ctx.stroke();
    });
}

function makePeriodicTexture() {
    return canvasTexture(360, 240, (ctx) => {
        ctx.fillStyle = "#f6f1e3";
        ctx.fillRect(0, 0, 360, 240);
        const colors = ["#f2a7a0", "#f6cf8c", "#bfe0a5", "#a9d3ea", "#cdb8e6"];
        const rows = [[0, 17], [0, 1, 12, 13, 14, 15, 16, 17], [0, 1, 12, 13, 14, 15, 16, 17]];
        for (let row = 0; row < 7; row++) {
            const columns = row < 3 ? rows[row] : Array.from({ length: 18 }, (_, i) => i);
            for (const column of columns) {
                ctx.fillStyle = colors[(column + row) % colors.length];
                ctx.fillRect(10 + column * 19, 14 + row * 24, 17, 22);
            }
        }
        for (let column = 2; column < 16; column++) {
            ctx.fillStyle = "#e7d7f0";
            ctx.fillRect(48 + column * 19, 192, 17, 18);
            ctx.fillRect(48 + column * 19, 212, 17, 18);
        }
    });
}

function makeRugTexture() {
    return canvasTexture(512, 360, (ctx) => {
        ctx.fillStyle = "#7d2f2f";
        ctx.fillRect(0, 0, 512, 360);
        ctx.strokeStyle = "#d9b26f";
        ctx.lineWidth = 10;
        ctx.strokeRect(24, 24, 464, 312);
        ctx.strokeStyle = "#2f4e6e";
        ctx.lineWidth = 16;
        ctx.strokeRect(48, 48, 416, 264);
        ctx.fillStyle = "#d9b26f";
        ctx.beginPath();
        ctx.ellipse(256, 180, 90, 60, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2f4e6e";
        ctx.beginPath();
        ctx.ellipse(256, 180, 50, 32, 0, 0, Math.PI * 2);
        ctx.fill();
    });
}

function TallBookshelf({ position, seed }: { position: [number, number, number]; seed: number }) {
    const width = 0.95;
    const height = 2.15;
    const depth = 0.34;
    const shelves = [0.04, 0.46, 0.88, 1.3, 1.72, height - 0.02];
    return (
        <group position={position}>
            <BlobShadow size={1.3} opacity={0.6} />
            {[-1, 1].map((side) => (
                <mesh key={side} position={[side * (width / 2 - 0.02), height / 2, 0]}>
                    <boxGeometry args={[0.04, height, depth]} />
                    <meshStandardMaterial color={WALNUT} roughness={0.7} />
                </mesh>
            ))}
            <mesh position={[0, height / 2, -depth / 2 + 0.01]}>
                <boxGeometry args={[width, height, 0.02]} />
                <meshStandardMaterial color="#3e281b" roughness={0.8} />
            </mesh>
            {shelves.map((y) => (
                <mesh key={y} position={[0, y, 0]}>
                    <boxGeometry args={[width, 0.03, depth]} />
                    <meshStandardMaterial color={WALNUT} roughness={0.7} />
                </mesh>
            ))}
            {shelves.slice(0, -1).map((y, index) => (
                <group key={y} position={[0, y + 0.015, 0.02]}>
                    <Books width={width - 0.1} seed={seed + index} />
                </group>
            ))}
        </group>
    );
}

function StudyDesk({ position, screen }: { position: [number, number, number]; screen: THREE.Texture }) {
    return (
        <group position={position}>
            <BlobShadow size={2.0} opacity={0.6} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.5, 0.06, 0.7]} radius={0.02} position={[0, 0.76, 0]}>
                <meshStandardMaterial color={WALNUT} roughness={0.55} />
            </RoundedBox>
            {[-0.55, 0.55].map((x) => (
                <mesh key={x} position={[x, 0.37, 0]}>
                    <boxGeometry args={[0.38, 0.74, 0.62]} />
                    <meshStandardMaterial color="#4a3020" roughness={0.65} />
                </mesh>
            ))}
            {/* His PC (see PCS in roomLayout). */}
            <Monitor position={[0.05, 0.79, -0.15]} texture={screen} />
            {/* Microscope. */}
            <group position={[-0.45, 0.79, 0.02]} rotation={[0, 0.5, 0]}>
                <mesh position={[0, 0.02, 0]}>
                    <boxGeometry args={[0.16, 0.04, 0.2]} />
                    <meshStandardMaterial color="#e8e6e1" roughness={0.4} />
                </mesh>
                <mesh position={[0, 0.15, -0.07]} rotation={[0.25, 0, 0]}>
                    <boxGeometry args={[0.04, 0.26, 0.05]} />
                    <meshStandardMaterial color="#e8e6e1" roughness={0.4} />
                </mesh>
                <mesh position={[0, 0.25, -0.01]} rotation={[0.55, 0, 0]}>
                    <cylinderGeometry args={[0.025, 0.03, 0.2, 14]} />
                    <meshStandardMaterial color="#2c2c30" roughness={0.3} metalness={0.4} />
                </mesh>
            </group>
            {/* Banker's lamp. */}
            <group position={[0.5, 0.79, -0.12]}>
                <mesh position={[0, 0.02, 0]}>
                    <cylinderGeometry args={[0.07, 0.08, 0.03, 16]} />
                    <meshStandardMaterial color="#b98d3e" metalness={0.6} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0.16, 0]}>
                    <cylinderGeometry args={[0.012, 0.012, 0.26, 8]} />
                    <meshStandardMaterial color="#b98d3e" metalness={0.6} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0.3, 0.03]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.55]}>
                    <cylinderGeometry args={[0.08, 0.08, 0.32, 16, 1, false, 0, Math.PI]} />
                    <meshStandardMaterial color="#2f7d4f" emissive="#4fae76" emissiveIntensity={0.5} roughness={0.35} />
                </mesh>
            </group>
            {/* Papers and an open notebook. */}
            <mesh position={[0.05, 0.795, 0.12]} rotation={[-Math.PI / 2, 0, 0.15]}>
                <planeGeometry args={[0.3, 0.22]} />
                <meshStandardMaterial color="#f4f1e8" roughness={0.9} />
            </mesh>
            <mesh position={[0.1, 0.797, 0.05]} rotation={[-Math.PI / 2, 0, -0.2]}>
                <planeGeometry args={[0.24, 0.3]} />
                <meshStandardMaterial color="#fbfaf4" roughness={0.9} />
            </mesh>
            {/* Chair. */}
            <group position={[0, 0, 0.62]} rotation={[0, Math.PI - 0.2, 0]}>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.48, 0.07, 0.46]} radius={0.03} position={[0, 0.47, 0]}>
                    <meshStandardMaterial color="#6a3a2a" roughness={0.6} />
                </RoundedBox>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.48, 0.5, 0.06]} radius={0.03} position={[0, 0.75, -0.21]}>
                    <meshStandardMaterial color="#6a3a2a" roughness={0.6} />
                </RoundedBox>
                {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => (
                    <mesh key={`${sx}${sz}`} position={[sx * 0.2, 0.22, sz * 0.19]}>
                        <boxGeometry args={[0.04, 0.44, 0.04]} />
                        <meshStandardMaterial color={WALNUT} />
                    </mesh>
                ))}
            </group>
        </group>
    );
}

function Globe({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <BlobShadow size={0.6} opacity={0.5} />
            <mesh position={[0, 0.35, 0]}>
                <cylinderGeometry args={[0.03, 0.12, 0.7, 12]} />
                <meshStandardMaterial color={WALNUT} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.88, 0]} rotation={[0, 0, 0.4]}>
                <sphereGeometry args={[0.2, 24, 16]} />
                <meshStandardMaterial color="#5f9ec9" roughness={0.6} />
            </mesh>
            <mesh position={[0.06, 0.95, 0.12]} rotation={[0, 0.5, 0.4]} scale={[1, 0.7, 0.5]}>
                <sphereGeometry args={[0.1, 10, 8]} />
                <meshStandardMaterial color="#9cc37a" roughness={0.7} flatShading />
            </mesh>
            <mesh position={[0, 0.88, 0]} rotation={[0, 0, 0.4]}>
                <torusGeometry args={[0.235, 0.01, 6, 32]} />
                <meshStandardMaterial color="#b98d3e" metalness={0.6} roughness={0.3} />
            </mesh>
        </group>
    );
}

function Armchair({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
    const leather = "#2f5d4a";
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            <BlobShadow size={1.2} opacity={0.6} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.85, 0.42, 0.8]} radius={0.08} position={[0, 0.25, 0]}>
                <meshStandardMaterial color={leather} roughness={0.55} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.85, 0.65, 0.18]} radius={0.08} position={[0, 0.7, -0.32]}>
                <meshStandardMaterial color={leather} roughness={0.55} />
            </RoundedBox>
            {[-0.38, 0.38].map((x) => (
                <RoundedBox smoothness={2} bevelSegments={1} key={x} args={[0.14, 0.32, 0.78]} radius={0.06} position={[x, 0.55, 0]}>
                    <meshStandardMaterial color={leather} roughness={0.55} />
                </RoundedBox>
            ))}
        </group>
    );
}

function Telescope({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            {[0, 2.1, 4.2].map((angle) => (
                <mesh key={angle} position={[Math.sin(angle) * 0.15, 0.5, Math.cos(angle) * 0.15]} rotation={[Math.cos(angle) * 0.3, 0, -Math.sin(angle) * 0.3]}>
                    <cylinderGeometry args={[0.012, 0.012, 1.05, 6]} />
                    <meshStandardMaterial color="#3a3a40" metalness={0.5} roughness={0.4} />
                </mesh>
            ))}
            <mesh position={[0, 1.08, 0.05]} rotation={[-1.0, 0, 0]}>
                <cylinderGeometry args={[0.05, 0.065, 0.75, 16]} />
                <meshStandardMaterial color="#f0ede6" roughness={0.35} />
            </mesh>
        </group>
    );
}

export default function SmythRoom() {
    const textures = useMemo(() => ({
        chalkboard: makeChalkboardTexture(),
        periodic: makePeriodicTexture(),
        rug: makeRugTexture(),
        screen: makeYouTubeScreenTexture("Smyth", "#8fc1ff"),
    }), []);
    const northHoles = useMemo<Hole[]>(() => [{ x: -2.4, y: 1.0, w: 1.1, h: 1.25, curtain: "#8a6f4e" }], []);
    const eastHoles = useMemo<Hole[]>(() => [{ x: -0.6, y: 1.0, w: 1.3, h: 1.25, curtain: "#8a6f4e" }], []);
    const westHoles = useMemo(() => [doorwayHole(SMYTH, "west")], []);
    const { x: cx, z: cz } = center(SMYTH);

    return (
        <Room
            bounds={SMYTH}
            style={STYLE}
            ceilingColor="#dfe3dc"
            floorTones={["#6a4630", "#5c3c28", "#74503a", "#634229", "#6e4a33"]}
            north={{ holes: northHoles, children: (
                <>
                    <StudyDesk position={[-0.7, 0, 0.42]} screen={textures.screen} />
                    {/* Chalkboard with a wooden frame. */}
                    <mesh position={[-0.7, 1.75, 0.02]}>
                        <boxGeometry args={[1.9, 0.95, 0.04]} />
                        <meshStandardMaterial color={WALNUT} roughness={0.6} />
                    </mesh>
                    <mesh position={[-0.7, 1.75, 0.042]}>
                        <planeGeometry args={[1.78, 0.83]} />
                        <meshStandardMaterial map={textures.chalkboard} roughness={0.95} />
                    </mesh>
                    <Plant position={[2.6, 0, 0.3]} scale={1.5} seed={101} />
                </>
            ) }}
            west={{ holes: westHoles, children: (
                <>
                    <TallBookshelf position={[2.4, 0, 0.18]} seed={110} />
                    <TallBookshelf position={[1.35, 0, 0.18]} seed={120} />
                    <mesh position={[0.2, 1.55, 0.01]}>
                        <planeGeometry args={[0.66, 0.44]} />
                        <meshStandardMaterial map={textures.periodic} roughness={0.85} />
                    </mesh>
                    <Globe position={[0.15, 0, 0.45]} />
                </>
            ) }}
            south={{ children: (
                <>
                    <Armchair position={[-1.6, 0, 0.6]} rotation={0.3} />
                    <TallBookshelf position={[0.6, 0, 0.18]} seed={130} />
                </>
            ) }}
            east={{ holes: eastHoles, children: <Telescope position={[-0.6, 0, 0.55]} rotation={0.2} /> }}
        >
            <mesh position={[cx - 0.3, FLOOR_Y + 0.006, cz - 0.4]}>
                <boxGeometry args={[2.6, 0.012, 1.8]} />
                <meshStandardMaterial map={textures.rug} roughness={1} />
            </mesh>
            {/* Simple glass pendant. */}
            <mesh position={[cx, FLOOR_Y + HEIGHT - 0.25, cz]}>
                <cylinderGeometry args={[0.005, 0.005, 0.5, 6]} />
                <meshStandardMaterial color="#333" />
            </mesh>
            <mesh position={[cx, FLOOR_Y + HEIGHT - 0.55, cz]}>
                <sphereGeometry args={[0.16, 20, 14]} />
                <meshStandardMaterial color="#fff6e6" emissive="#ffe2b8" emissiveIntensity={1.5} />
            </mesh>
        </Room>
    );
}
