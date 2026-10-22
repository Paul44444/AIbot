import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
    DOORWAY_HEIGHT,
    DOORWAY_WIDTH,
    FLOOR_Y,
    HEIGHT,
    ROOM_BOUNDS,
    WALL_GAP,
    center,
    doorwayLocalX,
    type Bounds,
} from "./roomLayout";

// The whole room is built from primitives and canvas textures generated at
// runtime, so it costs no extra download and renders on the first frame.

export { FLOOR_Y, HEIGHT };

export const COLORS = {
    wall: "#eec4a0",
    ceiling: "#e9c9a6",
    trim: "#9b6338",
    wood: "#b77a46",
    darkWood: "#8a5430",
    windowFrame: "#c99460",
    curtain: "#e9a1a6",
    sheet: "#f7f0e8",
    blanket: "#e6877b",
    pillow: "#9583c6",
    pot: "#c8744c",
    leaf: "#6ea35a",
    leafDark: "#4f8545",
    lampGlow: "#ffbf7a",
};

export type Hole = {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Doorways are open passages to the neighbouring room. */
    kind?: "window" | "doorway";
    curtain?: string;
};

export function seededRandom(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d")!);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

export function makeFloorTexture(
    width: number,
    depth: number,
    tones = ["#b8743f", "#c4824a", "#a9683a", "#bd7b45", "#b06f3d"],
    seed = 7,
) {
    const random = seededRandom(seed);
    const texture = canvasTexture(512, 512, (ctx) => {
        const rows = 8;
        const rowHeight = 512 / rows;
        for (let row = 0; row < rows; row++) {
            let x = -random() * 200;
            while (x < 512) {
                const length = 160 + random() * 200;
                ctx.fillStyle = tones[Math.floor(random() * tones.length)];
                ctx.fillRect(x, row * rowHeight, length, rowHeight);
                // Soft grain lines along the plank.
                ctx.strokeStyle = "rgba(90, 45, 20, 0.12)";
                ctx.lineWidth = 1;
                for (let i = 0; i < 4; i++) {
                    const y = row * rowHeight + 8 + random() * (rowHeight - 16);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.bezierCurveTo(x + length * 0.3, y + 3, x + length * 0.6, y - 3, x + length, y);
                    ctx.stroke();
                }
                ctx.fillStyle = "rgba(60, 30, 12, 0.55)";
                ctx.fillRect(x, row * rowHeight, 2, rowHeight);
                x += length;
            }
            ctx.fillStyle = "rgba(60, 30, 12, 0.45)";
            ctx.fillRect(0, row * rowHeight, 512, 2);
        }
    });
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(width / 2.2, depth / 2.2);
    return texture;
}

function makeSkyTexture() {
    const random = seededRandom(3);
    return canvasTexture(512, 256, (ctx) => {
        const sky = ctx.createLinearGradient(0, 0, 0, 256);
        sky.addColorStop(0, "#8fc1ec");
        sky.addColorStop(0.55, "#cfe3f2");
        sky.addColorStop(1, "#fbe5cc");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, 512, 256);

        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        for (let i = 0; i < 7; i++) {
            const x = random() * 512;
            const y = 20 + random() * 70;
            for (let j = 0; j < 4; j++) {
                ctx.beginPath();
                ctx.ellipse(x + j * 16, y + Math.sin(j) * 5, 24, 10, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const hills = [["#b9d2b0", 170, 22], ["#9cc192", 195, 16], ["#86b17c", 218, 12]] as const;
        for (const [color, base, amplitude] of hills) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(0, 256);
            for (let x = 0; x <= 512; x += 16) {
                ctx.lineTo(x, base - Math.sin(x / 60 + base) * amplitude - random() * 6);
            }
            ctx.lineTo(512, 256);
            ctx.fill();
        }

        // Rounded tree tops in front of the hills.
        for (let i = 0; i < 26; i++) {
            ctx.fillStyle = i % 2 ? "#6f9f63" : "#7fae6f";
            ctx.beginPath();
            ctx.arc(random() * 512, 228 + random() * 20, 14 + random() * 14, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function makePanelTexture() {
    const random = seededRandom(17);
    const texture = canvasTexture(256, 128, (ctx) => {
        const boards = 4;
        const boardWidth = 256 / boards;
        const tones = ["#c48d5e", "#bd8657", "#c99364", "#c08a5a"];
        for (let i = 0; i < boards; i++) {
            ctx.fillStyle = tones[Math.floor(random() * tones.length)];
            ctx.fillRect(i * boardWidth, 0, boardWidth, 128);
            ctx.fillStyle = "rgba(70, 35, 15, 0.45)";
            ctx.fillRect(i * boardWidth, 0, 2, 128);
            ctx.fillStyle = "rgba(255, 230, 200, 0.18)";
            ctx.fillRect(i * boardWidth + 2, 0, 2, 128);
        }
    });
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
}

let panelTexture: THREE.Texture | null = null;

function makeRugTexture() {
    return canvasTexture(512, 512, (ctx) => {
        ctx.fillStyle = "#d99d86";
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = "#f6eadb";
        ctx.fillRect(28, 28, 456, 456);
        ctx.strokeStyle = "#e3b39c";
        ctx.lineWidth = 6;
        ctx.strokeRect(52, 52, 408, 408);
        ctx.fillStyle = "#e7bfa8";
        for (let i = 0; i < 12; i++) {
            const t = 70 + i * 34;
            for (const [x, y] of [[t, 40], [t, 472], [40, t], [472, t]]) {
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
}

export function makePaintingTexture(seed: number, palette: string[]) {
    const random = seededRandom(seed);
    return canvasTexture(256, 256, (ctx) => {
        ctx.fillStyle = "#fbf4ea";
        ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 14; i++) {
            ctx.globalAlpha = 0.55 + random() * 0.35;
            ctx.fillStyle = palette[i % palette.length];
            ctx.beginPath();
            ctx.ellipse(random() * 256, random() * 256, 20 + random() * 60, 14 + random() * 40, random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    });
}

function makeShadowTexture() {
    return canvasTexture(128, 128, (ctx) => {
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, "rgba(40, 20, 10, 0.55)");
        gradient.addColorStop(1, "rgba(40, 20, 10, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
    });
}

let shadowTexture: THREE.Texture | null = null;

/** Soft blob shadow for anything standing on the floor; `size` is the diameter. */
export function BlobShadow({ size, opacity = 1, y = 0.004 }: { size: number; opacity?: number; y?: number }) {
    shadowTexture ??= makeShadowTexture();
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} renderOrder={1}>
            <planeGeometry args={[size, size]} />
            <meshBasicMaterial map={shadowTexture} transparent opacity={opacity} depthWrite={false} />
        </mesh>
    );
}

export type WallStyle = { color: string; trim: string; wainscot: boolean };

const DEFAULT_WALL_STYLE: WallStyle = { color: COLORS.wall, trim: COLORS.trim, wainscot: true };

/** Spans along the wall not interrupted by doorways, for baseboards and panelling. */
function solidSpans(width: number, holes: Hole[]) {
    const doors = holes.filter((hole) => hole.kind === "doorway")
        .map((hole) => [hole.x - hole.w / 2, hole.x + hole.w / 2])
        .sort((a, b) => a[0] - b[0]);
    const spans: [number, number][] = [];
    let start = -width / 2;
    for (const [from, to] of doors) {
        if (from > start) spans.push([start, from]);
        start = Math.max(start, to);
    }
    if (start < width / 2) spans.push([start, width / 2]);
    return spans;
}

/** A wall in local space: x along the wall, y up from the floor, +z into the room. */
function Wall({
    width,
    position,
    rotationY,
    holes = [],
    style = DEFAULT_WALL_STYLE,
    children,
}: {
    width: number;
    position: [number, number, number];
    rotationY: number;
    holes?: Hole[];
    style?: WallStyle;
    children?: ReactNode;
}) {
    const geometry = useMemo(() => {
        const shape = new THREE.Shape();
        shape.moveTo(-width / 2, 0);
        shape.lineTo(width / 2, 0);
        shape.lineTo(width / 2, HEIGHT);
        shape.lineTo(-width / 2, HEIGHT);
        shape.closePath();
        for (const hole of holes) {
            const path = new THREE.Path();
            path.moveTo(hole.x - hole.w / 2, hole.y);
            path.lineTo(hole.x - hole.w / 2, hole.y + hole.h);
            path.lineTo(hole.x + hole.w / 2, hole.y + hole.h);
            path.lineTo(hole.x + hole.w / 2, hole.y);
            path.closePath();
            shape.holes.push(path);
        }
        return new THREE.ShapeGeometry(shape);
    }, [width, holes]);
    const spans = useMemo(() => solidSpans(width, holes), [width, holes]);

    return (
        <group position={position} rotation={[0, rotationY, 0]}>
            <mesh geometry={geometry}>
                <meshStandardMaterial color={style.color} roughness={0.95} />
            </mesh>
            {spans.map(([from, to]) => (
                <group key={from} position={[(from + to) / 2, 0, 0]}>
                    {style.wainscot && <Wainscot width={to - from} trim={style.trim} />}
                    <mesh position={[0, 0.06, 0.012]}>
                        <boxGeometry args={[to - from, 0.12, 0.024]} />
                        <meshStandardMaterial color={style.trim} roughness={0.7} />
                    </mesh>
                </group>
            ))}
            {/* Crown molding. */}
            <mesh position={[0, HEIGHT - 0.04, 0.02]}>
                <boxGeometry args={[width, 0.08, 0.04]} />
                <meshStandardMaterial color={style.trim} roughness={0.7} />
            </mesh>
            {holes.map((hole, index) => hole.kind === "doorway"
                ? <Doorway key={index} {...hole} style={style} />
                : <Window key={index} {...hole} wallColor={style.color} />)}
            {children}
        </group>
    );
}

/** An open passage: frame on this side, reveal through the gap between rooms. */
function Doorway({ x, w, h, style }: Hole & { style: WallStyle }) {
    const depth = WALL_GAP + 0.02;
    return (
        <group position={[x, 0, 0]}>
            {[-w / 2, w / 2].map((side) => (
                <mesh key={side} position={[side, h / 2, -depth / 2]}>
                    <boxGeometry args={[0.01, h, depth]} />
                    <meshStandardMaterial color={style.color} roughness={0.95} />
                </mesh>
            ))}
            <mesh position={[0, h, -depth / 2]}>
                <boxGeometry args={[w, 0.01, depth]} />
                <meshStandardMaterial color={style.color} roughness={0.95} />
            </mesh>
            {/* Threshold across the gap. */}
            <mesh position={[0, 0.006, -depth / 2]}>
                <boxGeometry args={[w, 0.012, depth]} />
                <meshStandardMaterial color={COLORS.darkWood} roughness={0.7} />
            </mesh>
            {[
                [0, h + 0.05, w + 0.2, 0.1],
                [-w / 2 - 0.05, h / 2, 0.1, h],
                [w / 2 + 0.05, h / 2, 0.1, h],
            ].map(([px, py, sw, sh], index) => (
                <mesh key={index} position={[px, py, 0.02]}>
                    <boxGeometry args={[sw, sh, 0.04]} />
                    <meshStandardMaterial color={style.trim} roughness={0.7} />
                </mesh>
            ))}
        </group>
    );
}

const WAINSCOT_HEIGHT = 0.85;

/** Wooden boards along the lower part of a wall, topped by a small rail. */
function Wainscot({ width, trim }: { width: number; trim: string }) {
    const texture = useMemo(() => {
        panelTexture ??= makePanelTexture();
        const repeated = panelTexture.clone();
        repeated.repeat.set(width / 0.6, 1);
        return repeated;
    }, [width]);

    return (
        <>
            <mesh position={[0, WAINSCOT_HEIGHT / 2, 0.008]}>
                <planeGeometry args={[width, WAINSCOT_HEIGHT]} />
                <meshStandardMaterial map={texture} roughness={0.75} />
            </mesh>
            <mesh position={[0, WAINSCOT_HEIGHT, 0.018]}>
                <boxGeometry args={[width, 0.045, 0.036]} />
                <meshStandardMaterial color={trim} roughness={0.7} />
            </mesh>
        </>
    );
}

/** A sagging string of warm bulbs between two points on a wall (local space). */
export function FairyLights({ from, to, sag = 0.25, count = 15 }: { from: [number, number]; to: [number, number]; sag?: number; count?: number }) {
    const { wire, bulbs } = useMemo(() => {
        const pointAt = (t: number) => new THREE.Vector3(
            THREE.MathUtils.lerp(from[0], to[0], t),
            THREE.MathUtils.lerp(from[1], to[1], t) - Math.sin(Math.PI * t) * sag,
            0.04,
        );
        const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => pointAt(i / 11)));
        return {
            wire: new THREE.TubeGeometry(curve, 48, 0.004, 4),
            bulbs: Array.from({ length: count }, (_, i) => pointAt((i + 0.5) / count)),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from[0], from[1], to[0], to[1], sag, count]);

    return (
        <group>
            <mesh geometry={wire}>
                <meshStandardMaterial color="#4a3a2c" />
            </mesh>
            {bulbs.map((bulb, index) => (
                <mesh key={index} position={[bulb.x, bulb.y - 0.025, bulb.z]}>
                    <sphereGeometry args={[0.022, 10, 8]} />
                    <meshBasicMaterial color={index % 3 === 1 ? "#ffc27a" : "#ffe0a6"} toneMapped={false} />
                </mesh>
            ))}
        </group>
    );
}

function WavyCurtain({ width, height, color = COLORS.curtain }: { width: number; height: number; color?: string }) {
    const geometry = useMemo(() => {
        const plane = new THREE.PlaneGeometry(width, height, 28, 1);
        const positions = plane.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            positions.setZ(i, Math.sin((positions.getX(i) / width) * Math.PI * 7) * 0.035);
        }
        plane.computeVertexNormals();
        return plane;
    }, [width, height]);

    return (
        <mesh geometry={geometry}>
            <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
        </mesh>
    );
}

let skyTexture: THREE.Texture | null = null;

function Window({ x, y, w, h, curtain, wallColor }: Hole & { wallColor: string }) {
    skyTexture ??= makeSkyTexture();
    const frame = 0.07;
    const bar = 0.04;
    // Curtains hang from just above the window down to the floor.
    const curtainHeight = h + y + 0.1;

    return (
        <group position={[x, y, 0]}>
            {/* View outside, slightly behind the wall so it reads as depth. */}
            <mesh position={[0, h / 2, -0.35]}>
                <planeGeometry args={[w + 1.2, h + 0.9]} />
                <meshBasicMaterial map={skyTexture} toneMapped={false} />
            </mesh>
            {/* Window reveal gives the thin wall some thickness. */}
            {[
                [0, 0, w, 0.01],
                [0, h, w, 0.01],
            ].map(([px, py, sw, sh], index) => (
                <mesh key={`h${index}`} position={[px, py, -0.09]}>
                    <boxGeometry args={[sw, sh, 0.18]} />
                    <meshStandardMaterial color={wallColor} roughness={0.95} />
                </mesh>
            ))}
            {[-w / 2, w / 2].map((px, index) => (
                <mesh key={`v${index}`} position={[px, h / 2, -0.09]}>
                    <boxGeometry args={[0.01, h, 0.18]} />
                    <meshStandardMaterial color={wallColor} roughness={0.95} />
                </mesh>
            ))}
            {/* Frame, mullions and sill. */}
            {[
                [0, frame / 2, w, frame],
                [0, h - frame / 2, w, frame],
                [-w / 2 + frame / 2, h / 2, frame, h],
                [w / 2 - frame / 2, h / 2, frame, h],
                [0, h / 2, bar, h],
                [0, h * 0.68, w, bar],
            ].map(([px, py, sw, sh], index) => (
                <mesh key={`f${index}`} position={[px, py, -0.04]}>
                    <boxGeometry args={[sw, sh, 0.06]} />
                    <meshStandardMaterial color={COLORS.windowFrame} roughness={0.6} />
                </mesh>
            ))}
            <mesh position={[0, -0.02, 0.05]}>
                <boxGeometry args={[w + 0.2, 0.04, 0.16]} />
                <meshStandardMaterial color={COLORS.windowFrame} roughness={0.6} />
            </mesh>
            {/* Curtain rod and two curtains. */}
            <mesh position={[0, h + 0.18, 0.12]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.015, 0.015, w + 0.9, 8]} />
                <meshStandardMaterial color={COLORS.darkWood} roughness={0.5} />
            </mesh>
            {[-1, 1].map((side) => (
                <group key={side} position={[side * (w / 2 + 0.2), h + 0.16 - curtainHeight / 2, 0.12]}>
                    <WavyCurtain width={0.42} height={curtainHeight} color={curtain} />
                </group>
            ))}
        </group>
    );
}

export function Plant({ position, scale = 1, seed = 1 }: { position: [number, number, number]; scale?: number; seed?: number }) {
    const leaves = useMemo(() => {
        const random = seededRandom(seed);
        return Array.from({ length: 7 }, (_, i) => ({
            position: [
                (random() - 0.5) * 0.16,
                0.2 + random() * 0.14,
                (random() - 0.5) * 0.16,
            ] as [number, number, number],
            size: 0.06 + random() * 0.05,
            color: i % 2 ? COLORS.leaf : COLORS.leafDark,
        }));
    }, [seed]);

    return (
        <group position={position} scale={scale}>
            <mesh position={[0, 0.08, 0]}>
                <cylinderGeometry args={[0.09, 0.065, 0.16, 16]} />
                <meshStandardMaterial color={COLORS.pot} roughness={0.85} />
            </mesh>
            {leaves.map((leaf, index) => (
                <mesh key={index} position={leaf.position} scale={leaf.size}>
                    <icosahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color={leaf.color} roughness={0.8} flatShading />
                </mesh>
            ))}
        </group>
    );
}

export function Books({ width, seed }: { width: number; seed: number }) {
    const books = useMemo(() => {
        const random = seededRandom(seed);
        const colors = ["#c96f5b", "#e2b55c", "#7c9ccf", "#8bb17a", "#b48ac4", "#e9dccb", "#d58aa0"];
        const result: { x: number; w: number; h: number; color: string; tilt: number }[] = [];
        let x = -width / 2 + 0.02;
        while (x < width / 2 - 0.08) {
            const w = 0.03 + random() * 0.03;
            const h = 0.16 + random() * 0.08;
            result.push({ x: x + w / 2, w, h, color: colors[Math.floor(random() * colors.length)], tilt: random() < 0.1 ? 0.25 : 0 });
            x += w + 0.004;
            if (random() < 0.12) x += 0.08;
        }
        return result;
    }, [width, seed]);

    return (
        <>
            {books.map((book, index) => (
                <mesh key={index} position={[book.x, book.h / 2, 0]} rotation={[0, 0, book.tilt]}>
                    <boxGeometry args={[book.w, book.h, 0.2]} />
                    <meshStandardMaterial color={book.color} roughness={0.8} />
                </mesh>
            ))}
        </>
    );
}

export function Bookshelf({ position }: { position: [number, number, number] }) {
    const width = 0.85;
    const height = 1.15;
    const depth = 0.32;
    const shelves = [0.04, 0.4, 0.77, height - 0.02];
    return (
        <group position={position}>
            <BlobShadow size={1.2} opacity={0.6} />
            {[-1, 1].map((side) => (
                <mesh key={side} position={[side * (width / 2 - 0.02), height / 2, 0]}>
                    <boxGeometry args={[0.04, height, depth]} />
                    <meshStandardMaterial color={COLORS.wood} roughness={0.7} />
                </mesh>
            ))}
            <mesh position={[0, height / 2, -depth / 2 + 0.01]}>
                <boxGeometry args={[width, height, 0.02]} />
                <meshStandardMaterial color={COLORS.darkWood} roughness={0.8} />
            </mesh>
            {shelves.map((y) => (
                <mesh key={y} position={[0, y, 0]}>
                    <boxGeometry args={[width, 0.03, depth]} />
                    <meshStandardMaterial color={COLORS.wood} roughness={0.7} />
                </mesh>
            ))}
            <group position={[0, 0.055, 0.02]}><Books width={width - 0.08} seed={11} /></group>
            <group position={[0, 0.415, 0.02]}><Books width={width - 0.3} seed={12} /></group>
            <Plant position={[0.26, 0.415, 0.02]} scale={0.8} seed={4} />
            <group position={[0, 0.785, 0.02]}><Books width={width - 0.08} seed={13} /></group>
            <Plant position={[-0.2, height, 0]} scale={0.9} seed={9} />
        </group>
    );
}

export function Dresser({ position, width = 0.95 }: { position: [number, number, number]; width?: number }) {
    const height = 0.72;
    const depth = 0.45;
    return (
        <group position={position}>
            <BlobShadow size={width + 0.5} opacity={0.6} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[width, height, depth]} radius={0.02} position={[0, height / 2, 0]}>
                <meshStandardMaterial color={COLORS.wood} roughness={0.65} />
            </RoundedBox>
            {[0.17, 0.42].map((y) =>
                [-1, 1].map((side) => (
                    <group key={`${y}${side}`} position={[side * width / 4, y, depth / 2]}>
                        <mesh>
                            <boxGeometry args={[width / 2 - 0.05, 0.2, 0.01]} />
                            <meshStandardMaterial color={COLORS.darkWood} roughness={0.7} />
                        </mesh>
                        <mesh position={[0, 0, 0.015]}>
                            <sphereGeometry args={[0.018, 10, 8]} />
                            <meshStandardMaterial color="#e3c27a" metalness={0.6} roughness={0.3} />
                        </mesh>
                    </group>
                )),
            )}
        </group>
    );
}

export function TableLamp({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <mesh position={[0, 0.1, 0]}>
                <cylinderGeometry args={[0.05, 0.07, 0.2, 16]} />
                <meshStandardMaterial color="#e8d9c4" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.3, 0]}>
                <cylinderGeometry args={[0.09, 0.14, 0.18, 20, 1, true]} />
                <meshStandardMaterial color="#fff1d8" emissive={COLORS.lampGlow} emissiveIntensity={1.4} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

export function Painting({ position, size, texture }: { position: [number, number, number]; size: [number, number]; texture: THREE.Texture }) {
    return (
        <group position={position}>
            <mesh>
                <boxGeometry args={[size[0] + 0.06, size[1] + 0.06, 0.03]} />
                <meshStandardMaterial color={COLORS.windowFrame} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.017]}>
                <planeGeometry args={size} />
                <meshStandardMaterial map={texture} roughness={0.9} />
            </mesh>
        </group>
    );
}

export function Bed({ position }: { position: [number, number, number] }) {
    const width = 1.6;
    const length = 2.0;
    return (
        <group position={position}>
            <BlobShadow size={2.6} opacity={0.7} />
            <mesh position={[0, 0.16, 0]}>
                <boxGeometry args={[width, 0.24, length]} />
                <meshStandardMaterial color={COLORS.wood} roughness={0.65} />
            </mesh>
            <RoundedBox smoothness={2} bevelSegments={1} args={[width + 0.06, 0.95, 0.08]} radius={0.03} position={[0, 0.48, -length / 2 + 0.04]}>
                <meshStandardMaterial color={COLORS.wood} roughness={0.65} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[width - 0.06, 0.22, length - 0.08]} radius={0.06} position={[0, 0.38, 0.02]}>
                <meshStandardMaterial color={COLORS.sheet} roughness={0.95} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[width + 0.02, 0.09, length * 0.66]} radius={0.04} position={[0, 0.49, length * 0.17 + 0.02]}>
                <meshStandardMaterial color={COLORS.blanket} roughness={1} />
            </RoundedBox>
            {[-0.38, 0.38].map((x) => (
                <RoundedBox smoothness={2} bevelSegments={1} key={x} args={[0.66, 0.17, 0.42]} radius={0.08} position={[x, 0.58, -length / 2 + 0.34]} rotation={[0.25, 0, 0]}>
                    <meshStandardMaterial color={COLORS.pillow} roughness={1} />
                </RoundedBox>
            ))}
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.34, 0.1, 0.3]} radius={0.05} position={[0.1, 0.58, 0.15]} rotation={[0, 0.5, 0.1]}>
                <meshStandardMaterial color="#e8c879" roughness={1} />
            </RoundedBox>
        </group>
    );
}

export function Desk({ position }: { position: [number, number, number] }) {
    const width = 1.1;
    const depth = 0.55;
    const height = 0.74;
    return (
        <group position={position}>
            <BlobShadow size={1.6} opacity={0.5} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[width, 0.04, depth]} radius={0.015} position={[0, height, 0]}>
                <meshStandardMaterial color={COLORS.wood} roughness={0.6} />
            </RoundedBox>
            {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => (
                <mesh key={`${sx}${sz}`} position={[sx * (width / 2 - 0.05), height / 2, sz * (depth / 2 - 0.05)]}>
                    <boxGeometry args={[0.045, height, 0.045]} />
                    <meshStandardMaterial color={COLORS.darkWood} roughness={0.7} />
                </mesh>
            ))}
            {/* Stack of notebooks and a mug. */}
            <mesh position={[-0.3, height + 0.04, 0.02]} rotation={[0, 0.2, 0]}>
                <boxGeometry args={[0.26, 0.04, 0.2]} />
                <meshStandardMaterial color="#7c9ccf" roughness={0.8} />
            </mesh>
            <mesh position={[-0.28, height + 0.075, 0.03]} rotation={[0, -0.1, 0]}>
                <boxGeometry args={[0.24, 0.03, 0.18]} />
                <meshStandardMaterial color="#e2b55c" roughness={0.8} />
            </mesh>
            <mesh position={[0.25, height + 0.06, 0.08]}>
                <cylinderGeometry args={[0.04, 0.04, 0.09, 14]} />
                <meshStandardMaterial color="#f4ede4" roughness={0.5} />
            </mesh>
            <Plant position={[0.42, height + 0.02, -0.12]} scale={0.7} seed={21} />
            {/* Chair. */}
            <group position={[0, 0, 0.55]} rotation={[0, 0.25, 0]}>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.44, 0.05, 0.42]} radius={0.02} position={[0, 0.46, 0]}>
                    <meshStandardMaterial color={COLORS.wood} roughness={0.6} />
                </RoundedBox>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.44, 0.4, 0.04]} radius={0.02} position={[0, 0.7, 0.2]}>
                    <meshStandardMaterial color={COLORS.wood} roughness={0.6} />
                </RoundedBox>
                {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => (
                    <mesh key={`${sx}${sz}`} position={[sx * 0.18, 0.23, sz * 0.17]}>
                        <boxGeometry args={[0.035, 0.46, 0.035]} />
                        <meshStandardMaterial color={COLORS.darkWood} roughness={0.7} />
                    </mesh>
                ))}
            </group>
        </group>
    );
}

export function WallShelf({ position, width = 0.8 }: { position: [number, number, number]; width?: number }) {
    return (
        <group position={position}>
            <mesh position={[0, 0, 0.11]}>
                <boxGeometry args={[width, 0.03, 0.22]} />
                <meshStandardMaterial color={COLORS.wood} roughness={0.65} />
            </mesh>
            <Plant position={[-width / 2 + 0.14, 0.015, 0.11]} scale={0.75} seed={31} />
            <group position={[0.05, 0.015, 0.11]}><Books width={0.22} seed={33} /></group>
            <mesh position={[width / 2 - 0.12, 0.08, 0.11]}>
                <sphereGeometry args={[0.065, 16, 12]} />
                <meshStandardMaterial color="#f1d7c4" roughness={0.7} />
            </mesh>
        </group>
    );
}

export function CeilingLamp({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <mesh position={[0, -0.15, 0]}>
                <cylinderGeometry args={[0.006, 0.006, 0.3, 6]} />
                <meshStandardMaterial color="#5b4636" />
            </mesh>
            <mesh position={[0, -0.32, 0]}>
                <cylinderGeometry args={[0.3, 0.34, 0.08, 32]} />
                <meshStandardMaterial color="#ffd6a3" emissive="#ff9f4d" emissiveIntensity={1.6} roughness={0.6} />
            </mesh>
        </group>
    );
}

export function Rug({ position }: { position: [number, number, number] }) {
    const texture = useMemo(makeRugTexture, []);
    return (
        <RoundedBox smoothness={2} bevelSegments={1} args={[2.8, 0.016, 2.0]} radius={0.007} position={position}>
            <meshStandardMaterial map={texture} roughness={1} />
        </RoundedBox>
    );
}

/**
 * The room is ~400 small meshes, which would cost one draw call each per frame.
 * Bake them into one mesh per distinct material and hide the originals; lights
 * stay where they are.
 */
export function mergeStaticMeshes(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const batches = new Map<string, { material: THREE.Material; renderOrder: number; geometries: THREE.BufferGeometry[] }>();
    const sources: THREE.Mesh[] = [];

    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.visible) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        const key = [
            material.type, material.color?.getHexString(), material.emissive?.getHexString(), material.emissiveIntensity,
            material.roughness, material.metalness, material.map?.uuid, material.side, material.transparent,
            material.opacity, material.flatShading, material.toneMapped, material.depthWrite, mesh.renderOrder,
        ].join("|");

        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        for (const name of Object.keys(geometry.attributes)) {
            if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
        }
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        if (!geometry.attributes.uv) {
            geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
        }
        geometry.applyMatrix4(mesh.matrixWorld);

        const batch = batches.get(key) ?? { material, renderOrder: mesh.renderOrder, geometries: [] };
        batch.geometries.push(geometry);
        batches.set(key, batch);
        sources.push(mesh);
    });

    const merged = new THREE.Group();
    for (const { material, renderOrder, geometries } of batches.values()) {
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        geometries.forEach((geometry) => geometry.dispose());
        mesh.renderOrder = renderOrder;
        mesh.matrixAutoUpdate = false;
        merged.add(mesh);
    }
    sources.forEach((mesh) => { mesh.visible = false; });
    root.add(merged);
    // Nothing in the room moves, so skip recomposing ~400 matrices every frame.
    root.traverse((object) => { object.matrixAutoUpdate = false; });

    return () => {
        root.remove(merged);
        merged.children.forEach((mesh) => (mesh as THREE.Mesh).geometry.dispose());
        sources.forEach((mesh) => { mesh.visible = true; });
    };
}

export type WallSpec = { holes?: Hole[]; children?: ReactNode };

/**
 * Floor, ceiling and four walls inside `bounds`, with wall-local furniture.
 * Wall-local x runs along the wall; +z points into the room.
 */
export function Room({
    bounds,
    floorTones,
    ceilingColor,
    style = DEFAULT_WALL_STYLE,
    beams = true,
    north,
    south,
    east,
    west,
    children,
}: {
    bounds: Bounds;
    floorTones?: string[];
    ceilingColor: string;
    style?: WallStyle;
    beams?: boolean;
    north?: WallSpec;
    south?: WallSpec;
    east?: WallSpec;
    west?: WallSpec;
    children?: ReactNode;
}) {
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const { x: cx, z: cz } = center(bounds);
    const floorTexture = useMemo(() => makeFloorTexture(width, depth, floorTones),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [width, depth, floorTones?.join()]);

    const rootRef = useRef<THREE.Group>(null);
    // Layout effects run after the children are attached and before the warm-up compiles them.
    useLayoutEffect(() => mergeStaticMeshes(rootRef.current!), []);

    return (
        <group ref={rootRef}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, FLOOR_Y, cz]}>
                <planeGeometry args={[width, depth]} />
                <meshStandardMaterial map={floorTexture} roughness={0.75} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, FLOOR_Y + HEIGHT, cz]}>
                <planeGeometry args={[width, depth]} />
                <meshStandardMaterial color={ceilingColor} roughness={1} />
            </mesh>
            <Wall width={width} position={[cx, FLOOR_Y, bounds.minZ]} rotationY={0} holes={north?.holes} style={style}>{north?.children}</Wall>
            <Wall width={width} position={[cx, FLOOR_Y, bounds.maxZ]} rotationY={Math.PI} holes={south?.holes} style={style}>{south?.children}</Wall>
            <Wall width={depth} position={[bounds.minX, FLOOR_Y, cz]} rotationY={Math.PI / 2} holes={west?.holes} style={style}>{west?.children}</Wall>
            <Wall width={depth} position={[bounds.maxX, FLOOR_Y, cz]} rotationY={-Math.PI / 2} holes={east?.holes} style={style}>{east?.children}</Wall>
            {beams && [bounds.minZ + depth * 0.17, bounds.minZ + depth * 0.5, bounds.minZ + depth * 0.82].map((z) => (
                <mesh key={z} position={[cx, FLOOR_Y + HEIGHT - 0.07, z]}>
                    <boxGeometry args={[width, 0.14, 0.18]} />
                    <meshStandardMaterial color={style.trim} roughness={0.8} />
                </mesh>
            ))}
            {children}
        </group>
    );
}

export function doorwayHole(bounds: Bounds, side: "west" | "east"): Hole {
    return { kind: "doorway", x: doorwayLocalX(bounds, side), y: 0, w: DOORWAY_WIDTH, h: DOORWAY_HEIGHT };
}

const JENNY = ROOM_BOUNDS.jenny;

/** World positions of Jenny's lamps; lights for every room exist from the start. */
export const JENNY_LIGHTS = [
    { position: [-1.0, FLOOR_Y + HEIGHT - 0.45, -1.6], color: "#ffd1a0", intensity: 5, distance: 10, decay: 1.2 },
    { position: [JENNY.minX + 0.33, FLOOR_Y + 1.02, center(JENNY).z - 1.35], color: "#ffc489", intensity: 1.2, distance: 3, decay: 1.5 },
    { position: [center(JENNY).x + 1.8, FLOOR_Y + 2.25, JENNY.minZ + 0.3], color: "#ffb870", intensity: 1.2, distance: 3, decay: 1.5 },
] as const;

export default function CozyRoom() {
    const paintings = useMemo(() => [
        makePaintingTexture(5, ["#f2b8a2", "#9cc4e4", "#f5d48f", "#b6d7a8"]),
        makePaintingTexture(8, ["#c9b6e4", "#f6c1cf", "#a8d5cf", "#fbe0a6"]),
        makePaintingTexture(13, ["#9cc4e4", "#f6c1cf", "#f5d48f"]),
    ], []);

    const northHoles = useMemo<Hole[]>(() => [
        { x: -1.0, y: 1.0, w: 1.25, h: 1.25 },
        { x: 1.8, y: 1.05, w: 1.35, h: 1.2 },
    ], []);
    const westHoles = useMemo(() => [doorwayHole(JENNY, "west")], []);
    const eastHoles = useMemo(() => [doorwayHole(JENNY, "east")], []);

    return (
        <Room
            bounds={JENNY}
            ceilingColor={COLORS.ceiling}
            north={{ holes: northHoles, children: (
                <>
                    <Desk position={[-1.0, 0, 0.3]} />
                    <Bed position={[1.8, 0, 1.0]} />
                    <FairyLights from={[0.85, 2.5]} to={[2.75, 2.5]} />
                    <group position={[0.75, 0, 0.25]}>
                        <BlobShadow size={0.8} opacity={0.5} />
                        <RoundedBox smoothness={2} bevelSegments={1} args={[0.45, 0.5, 0.4]} radius={0.02} position={[0, 0.25, 0]}>
                            <meshStandardMaterial color={COLORS.wood} roughness={0.65} />
                        </RoundedBox>
                        <Plant position={[0.05, 0.5, 0]} scale={0.8} seed={41} />
                    </group>
                </>
            ) }}
            west={{ holes: westHoles, children: (
                <>
                    {/* Bookshelf, dresser with lamp and pictures; the doorway leads to Bob. */}
                    <Bookshelf position={[2.9, 0, 0.17]} />
                    <Dresser position={[1.6, 0, 0.23]} />
                    <TableLamp position={[1.35, 0.72, 0.23]} />
                    <Plant position={[1.9, 0.72, 0.2]} scale={0.8} seed={51} />
                    <WallShelf position={[1.65, 1.6, 0]} />
                    <Painting position={[2.9, 1.7, 0.02]} size={[0.5, 0.62]} texture={paintings[0]} />
                    <Painting position={[0.45, 1.4, 0.02]} size={[0.42, 0.42]} texture={paintings[2]} />
                    <Plant position={[-0.45, 0, 0.25]} scale={1.6} seed={61} />
                </>
            ) }}
            east={{ holes: eastHoles, children: (
                <>
                    {/* The doorway leads to Smyth. */}
                    <Dresser position={[-0.4, 0, 0.23]} width={0.8} />
                    <Plant position={[-0.6, 0.72, 0.2]} scale={0.9} seed={71} />
                    <Painting position={[-0.35, 1.5, 0.02]} size={[0.55, 0.4]} texture={paintings[1]} />
                    <Plant position={[2.6, 0, 0.3]} scale={1.8} seed={73} />
                </>
            ) }}
            south={{ children: (
                <>
                    <Bookshelf position={[-1.2, 0, 0.17]} />
                    <Painting position={[0.6, 1.5, 0.02]} size={[0.8, 0.55]} texture={paintings[1]} />
                    <WallShelf position={[1.9, 1.4, 0]} width={1} />
                    <Plant position={[2.6, 0, 0.3]} scale={1.6} seed={81} />
                </>
            ) }}
        >
            <Rug position={[-0.5, FLOOR_Y + 0.008, -0.6]} />
            <CeilingLamp position={[-1.0, FLOOR_Y + HEIGHT, -1.6]} />
        </Room>
    );
}
