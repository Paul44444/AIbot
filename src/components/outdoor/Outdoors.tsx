import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOOR_Y, FRONT_DOOR, HEIGHT, HOUSE_BLOCKS, ROOM_BOUNDS, WALL_GAP, insideHouse } from "../roomLayout";
import { CHUNK_SIZE, VIEW_RADIUS, WATER_LEVEL, blockedByTree, buildChunk, heightAt, type ChunkData, type Instance } from "./world";

// The forest around the house, streamed in tiles like a map: only tiles near
// the camera exist, at most one is built per frame, and tiles left behind are
// disposed, so memory stays flat however far you walk.

export const SKY_HORIZON = "#d3e4ea";

import { outdoorInput } from "./input";

/** Where you stand after stepping out of the front door, looking away from the house. */
export const OUTSIDE_START = new THREE.Vector3(FRONT_DOOR.x, FLOOR_Y + 1.6, ROOM_BOUNDS.jenny.maxZ + WALL_GAP + 3.2);

type LoadedChunk = { data: ChunkData; mesh: THREE.Mesh };

function treeGeometry(kind: "pine" | "leafy") {
    const parts = kind === "pine"
        ? [
            new THREE.CylinderGeometry(0.1, 0.16, 2.4, 6).translate(0, 1.2, 0),
            new THREE.ConeGeometry(1.15, 2.3, 7).translate(0, 3.1, 0),
            new THREE.ConeGeometry(0.85, 1.9, 7).translate(0, 4.2, 0),
            new THREE.ConeGeometry(0.5, 1.3, 7).translate(0, 5.1, 0),
        ]
        : [
            new THREE.CylinderGeometry(0.13, 0.2, 2.9, 6).translate(0, 1.45, 0),
            new THREE.IcosahedronGeometry(1.35, 0).translate(0, 3.5, 0),
            new THREE.IcosahedronGeometry(0.9, 0).translate(0.7, 3.0, 0.3),
        ];
    // Per-vertex colours: trunk brown, crowns green.
    const colored = parts.map((part, index) => {
        const geometry = part.toNonIndexed();
        const color = new THREE.Color(index === 0 ? "#6b4a30" : kind === "pine" ? "#2f6a3c" : "#4f8f3f");
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.deleteAttribute("uv");
        return geometry;
    });
    return mergeGeometries(colored)!;
}

const FLOWER_COLORS = ["#f6a5c0", "#ffe27a", "#ffffff", "#b99cf0"].map((c) => new THREE.Color(c));

/** The cottage around the three rooms, as seen from outside. */
function House() {
    const { plaster, stone, trim, roof, glow } = useMemo(() => ({
        plaster: new THREE.MeshStandardMaterial({ color: "#e6d2b2", roughness: 0.95 }),
        stone: new THREE.MeshStandardMaterial({ color: "#8b7f6c", roughness: 1, flatShading: true }),
        trim: new THREE.MeshStandardMaterial({ color: "#6e4a2f", roughness: 0.8 }),
        roof: new THREE.MeshStandardMaterial({ color: "#7c3d2f", roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
        glow: new THREE.MeshBasicMaterial({ color: "#ffd99c" }),
    }), []);

    const faces = useMemo(() => {
        const [jinx, jenny, smyth] = HOUSE_BLOCKS;
        // Each face: start and end point along the outside, outward direction.
        return [
            { a: [jinx.minX, jinx.minZ], b: [smyth.maxX, smyth.minZ], out: "north" },
            { a: [jinx.minX, jinx.maxZ], b: [jinx.maxX - WALL_GAP, jinx.maxZ], out: "south" },
            { a: [jenny.minX + WALL_GAP / 2, jenny.maxZ], b: [jenny.maxX - WALL_GAP / 2, jenny.maxZ], out: "south", door: true },
            { a: [smyth.minX + WALL_GAP, smyth.maxZ], b: [smyth.maxX, smyth.maxZ], out: "south" },
            { a: [jinx.minX, jinx.minZ], b: [jinx.minX, jinx.maxZ], out: "west" },
            { a: [jenny.minX + WALL_GAP / 2, jinx.maxZ], b: [jenny.minX + WALL_GAP / 2, jenny.maxZ], out: "west" },
            { a: [smyth.maxX, smyth.minZ], b: [smyth.maxX, smyth.maxZ], out: "east" },
            { a: [jenny.maxX - WALL_GAP / 2, smyth.maxZ], b: [jenny.maxX - WALL_GAP / 2, jenny.maxZ], out: "east" },
        ] as { a: [number, number]; b: [number, number]; out: "north" | "south" | "east" | "west"; door?: boolean }[];
    }, []);

    const bottom = FLOOR_Y - 0.5;
    const top = FLOOR_Y + HEIGHT + 0.3;

    const walls = useMemo(() => faces.map((face) => {
        const length = Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]);
        const center: [number, number, number] = [(face.a[0] + face.b[0]) / 2, 0, (face.a[1] + face.b[1]) / 2];
        // Local x runs along the face; the door is measured from the face centre.
        const doorX = face.door ? FRONT_DOOR.x - center[0] : null;
        const windows: number[] = [];
        for (let x = -length / 2 + 1.6; x < length / 2 - 1; x += 3.2) {
            if (doorX === null || Math.abs(x - doorX) > 1.4) windows.push(x);
        }
        const shape = new THREE.Shape();
        shape.moveTo(-length / 2, bottom);
        shape.lineTo(length / 2, bottom);
        shape.lineTo(length / 2, top);
        shape.lineTo(-length / 2, top);
        shape.closePath();
        if (doorX !== null) {
            const hole = new THREE.Path();
            hole.moveTo(doorX - 0.5, FLOOR_Y);
            hole.lineTo(doorX - 0.5, FLOOR_Y + 2.1);
            hole.lineTo(doorX + 0.5, FLOOR_Y + 2.1);
            hole.lineTo(doorX + 0.5, FLOOR_Y);
            hole.closePath();
            shape.holes.push(hole);
        }
        return { face, length, center, doorX, windows, geometry: new THREE.ShapeGeometry(shape) };
    }), [faces, bottom, top]);
    const rotation = { south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 };

    const roofGeometry = useMemo(() => {
        const minX = HOUSE_BLOCKS[0].minX - 0.5;
        const maxX = HOUSE_BLOCKS[2].maxX + 0.5;
        const minZ = HOUSE_BLOCKS[1].minZ - 0.6;
        const maxZ = HOUSE_BLOCKS[1].maxZ + 0.6;
        const ridgeZ = (minZ + maxZ) / 2;
        const eave = top - 0.15;
        const ridge = top + 2.4;
        const v = (x: number, y: number, z: number) => [x, y, z];
        const quads = [
            [v(minX, eave, minZ), v(maxX, eave, minZ), v(maxX, ridge, ridgeZ), v(minX, ridge, ridgeZ)],
            [v(minX, eave, maxZ), v(minX, ridge, ridgeZ), v(maxX, ridge, ridgeZ), v(maxX, eave, maxZ)],
        ];
        const positions: number[] = [];
        for (const [a, b, c, d] of quads) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        return { geometry, minX, maxX, minZ, maxZ, ridgeZ, eave, ridge };
    }, [top]);

    // The triangles under the roof at both ends of the house.
    const gables = useMemo(() => {
        const { minX, maxX, minZ, maxZ, ridgeZ, eave, ridge } = roofGeometry;
        const positions: number[] = [];
        for (const x of [minX + 0.5, maxX - 0.5]) {
            positions.push(x, eave, minZ + 0.6, x, eave, maxZ - 0.6, x, ridge - 0.25, ridgeZ);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        return geometry;
    }, [roofGeometry]);

    return (
        <group>
            {walls.map(({ face, length, center, doorX, windows, geometry }, index) => {
                return (
                    <group key={index} position={center} rotation={[0, rotation[face.out], 0]}>
                        <mesh geometry={geometry} material={plaster} />
                        <mesh position={[0, FLOOR_Y + 0.05, 0.06]} material={stone}>
                            <boxGeometry args={[length, 0.5, 0.12]} />
                        </mesh>
                        {windows.map((x) => (
                            <group key={x} position={[x, FLOOR_Y + 1.65, 0.03]}>
                                <mesh material={trim}><boxGeometry args={[1.0, 1.15, 0.06]} /></mesh>
                                <mesh position={[0, 0, 0.032]} material={glow}><planeGeometry args={[0.84, 0.99]} /></mesh>
                                <mesh position={[0, 0, 0.04]} material={trim}><boxGeometry args={[0.05, 0.99, 0.02]} /></mesh>
                                <mesh position={[0, 0.08, 0.04]} material={trim}><boxGeometry args={[0.84, 0.05, 0.02]} /></mesh>
                            </group>
                        ))}
                        {doorX !== null && (
                            <group position={[doorX, FLOOR_Y, 0.03]}>
                                {[[0, 2.16, 1.24, 0.12], [-0.56, 1.05, 0.12, 2.1], [0.56, 1.05, 0.12, 2.1]].map(([px, py, w, h]) => (
                                    <mesh key={`${px}${py}`} position={[px, py, 0]} material={trim}><boxGeometry args={[w, h, 0.08]} /></mesh>
                                ))}
                                {/* Porch lamp and doormat. */}
                                <mesh position={[0.85, 1.9, 0.12]} material={glow}><sphereGeometry args={[0.1, 12, 8]} /></mesh>
                                <mesh position={[0, 0.01, 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
                                    <planeGeometry args={[1.0, 0.6]} />
                                    <meshStandardMaterial color="#9b5b3a" roughness={1} />
                                </mesh>
                            </group>
                        )}
                    </group>
                );
            })}
            <mesh geometry={roofGeometry.geometry} material={roof} />
            <mesh geometry={gables}>
                <meshStandardMaterial color="#e6d2b2" roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
            {/* Chimney above Jenny's room. */}
            <mesh position={[-1.2, roofGeometry.ridge - 0.2, roofGeometry.ridgeZ - 1.2]} material={stone}>
                <boxGeometry args={[0.7, 1.8, 0.7]} />
            </mesh>
        </group>
    );
}

/** Streams terrain tiles and their vegetation around the camera. */
function Forest({ active, chunks }: { active: boolean; chunks: Map<string, LoadedChunk> }) {
    const { camera } = useThree();
    const group = useRef<THREE.Group>(null);
    const dirty = useRef(false);
    const lastInstanceRebuild = useRef(0);

    const parts = useMemo(() => {
        const terrain = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
        const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
        const stone = new THREE.MeshStandardMaterial({ color: "#8d8d88", flatShading: true, roughness: 1 });
        const petals = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
        const make = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) => {
            const mesh = new THREE.InstancedMesh(geometry, material, capacity);
            mesh.count = 0;
            mesh.frustumCulled = false;
            return mesh;
        };
        const flowerMesh = make(new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.14, 0), petals, 5000);
        flowerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(5000 * 3), 3);
        return {
            terrain,
            pines: make(treeGeometry("pine"), foliage, 4000),
            leafy: make(treeGeometry("leafy"), foliage, 3000),
            rocks: make(new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.6, 1), stone, 1200),
            flowers: flowerMesh,
        };
    }, []);

    useEffect(() => () => {
        // Leaving for good: free every tile and shared resource.
        for (const chunk of chunks.values()) chunk.mesh.geometry.dispose();
        chunks.clear();
        for (const mesh of [parts.pines, parts.leafy, parts.rocks, parts.flowers]) {
            mesh.geometry.dispose();
            mesh.dispose();
        }
        parts.terrain.dispose();
    }, [chunks, parts]);

    const matrix = useMemo(() => new THREE.Matrix4(), []);
    const quaternion = useMemo(() => new THREE.Quaternion(), []);
    const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

    const fill = (mesh: THREE.InstancedMesh, items: Instance[], sink: number, colored = false) => {
        const count = Math.min(items.length, mesh.instanceMatrix.count);
        for (let i = 0; i < count; i++) {
            const item = items[i];
            quaternion.setFromAxisAngle(up, item.rotation);
            matrix.compose(new THREE.Vector3(item.x, item.y - sink, item.z), quaternion, new THREE.Vector3(item.scale, item.scale, item.scale));
            mesh.setMatrixAt(i, matrix);
            if (colored) mesh.setColorAt(i, FLOWER_COLORS[item.variant % FLOWER_COLORS.length]);
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    useFrame(() => {
        if (!group.current) return;
        // Inside the house only the few tiles in front of the door are prepared,
        // so stepping out never shows an empty world.
        const center = active ? camera.position : OUTSIDE_START;
        const radius = active ? VIEW_RADIUS : 1;
        const centerX = Math.floor(center.x / CHUNK_SIZE);
        const centerZ = Math.floor(center.z / CHUNK_SIZE);

        // Drop tiles that fell behind (with one tile of slack against flicker).
        for (const [key, chunk] of chunks) {
            if (Math.max(Math.abs(chunk.data.cx - centerX), Math.abs(chunk.data.cz - centerZ)) > radius + 1) {
                group.current.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunks.delete(key);
                dirty.current = true;
            }
        }

        // Build the nearest missing tile; one per frame keeps frames short.
        let nearest: [number, number] | null = null;
        let nearestDistance = Infinity;
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const cx = centerX + dx;
                const cz = centerZ + dz;
                if (chunks.has(`${cx},${cz}`)) continue;
                const distance = dx * dx + dz * dz;
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = [cx, cz];
                }
            }
        }
        if (nearest) {
            const data = buildChunk(nearest[0], nearest[1]);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
            geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, parts.terrain);
            mesh.matrixAutoUpdate = false;
            group.current.add(mesh);
            chunks.set(data.key, { data, mesh });
            dirty.current = true;
        }

        // Re-pack the instanced vegetation now and then, not after every tile.
        const now = performance.now();
        if (dirty.current && (now - lastInstanceRebuild.current > 300 || !nearest)) {
            const all = [...chunks.values()].map((chunk) => chunk.data);
            fill(parts.pines, all.flatMap((c) => c.pines), 0.15);
            fill(parts.leafy, all.flatMap((c) => c.leafy), 0.15);
            fill(parts.rocks, all.flatMap((c) => c.rocks), 0.2);
            fill(parts.flowers, all.flatMap((c) => c.flowers), 0, true);
            dirty.current = false;
            lastInstanceRebuild.current = now;
        }
    });

    return (
        <group ref={group}>
            <primitive object={parts.pines} />
            <primitive object={parts.leafy} />
            <primitive object={parts.rocks} />
            <primitive object={parts.flowers} />
        </group>
    );
}

/** Water and sky follow the camera, so they never end. */
function WaterAndSky() {
    const { camera } = useThree();
    const water = useRef<THREE.Mesh>(null);
    const sky = useRef<THREE.Mesh>(null);
    const skyGeometry = useMemo(() => {
        const geometry = new THREE.SphereGeometry(420, 24, 12);
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        const top = new THREE.Color("#79b0e2");
        const horizon = new THREE.Color(SKY_HORIZON);
        const color = new THREE.Color();
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const y = geometry.attributes.position.getY(i) / 420;
            color.lerpColors(horizon, top, Math.max(0, Math.min(1, y * 2.2)));
            color.toArray(colors, i * 3);
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        return geometry;
    }, []);

    useFrame(() => {
        // Snap to whole tiles so the water's surface does not appear to slide.
        water.current?.position.set(Math.round(camera.position.x / CHUNK_SIZE) * CHUNK_SIZE, WATER_LEVEL, Math.round(camera.position.z / CHUNK_SIZE) * CHUNK_SIZE);
        sky.current?.position.copy(camera.position);
    });

    return (
        <>
            <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[CHUNK_SIZE * (VIEW_RADIUS * 2 + 4), CHUNK_SIZE * (VIEW_RADIUS * 2 + 4)]} />
                <meshStandardMaterial color="#3d7ea3" roughness={0.15} metalness={0.15} transparent opacity={0.88} />
            </mesh>
            <mesh ref={sky} geometry={skyGeometry} renderOrder={-1}>
                <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
            </mesh>
        </>
    );
}

/**
 * First-person walking: WASD or arrows (Shift runs), drag to look, joystick on
 * touch screens. Follows the ground; the house, trees and deep water block.
 */
function Walker({ active, chunks, onReachDoor }: { active: boolean; chunks: Map<string, LoadedChunk>; onReachDoor: () => void }) {
    const { camera, gl } = useThree();
    const keys = useRef(new Set<string>());
    const look = useRef({ yaw: 0, pitch: 0, ready: false });
    const doorReported = useRef(false);

    useEffect(() => {
        if (!active) {
            look.current.ready = false;
            keys.current.clear();
            return;
        }
        doorReported.current = false;
        const typing = (event: Event) => (event.target as HTMLElement | null)?.matches?.("input, textarea, select, [contenteditable]");
        const down = (event: KeyboardEvent) => {
            if (typing(event)) return;
            const key = event.key.toLowerCase();
            if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
                keys.current.add(key);
                if (key.startsWith("arrow")) event.preventDefault();
            }
        };
        const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
        const blur = () => keys.current.clear();

        let dragging: { x: number; y: number } | null = null;
        const element = gl.domElement;
        const pointerDown = (event: PointerEvent) => { dragging = { x: event.clientX, y: event.clientY }; };
        const pointerMove = (event: PointerEvent) => {
            if (!dragging) return;
            look.current.yaw -= (event.clientX - dragging.x) * 0.0042;
            look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - (event.clientY - dragging.y) * 0.0042, -1.2, 1.2);
            dragging = { x: event.clientX, y: event.clientY };
        };
        const pointerUp = () => { dragging = null; };

        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", blur);
        element.addEventListener("pointerdown", pointerDown);
        window.addEventListener("pointermove", pointerMove);
        window.addEventListener("pointerup", pointerUp);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
            element.removeEventListener("pointerdown", pointerDown);
            window.removeEventListener("pointermove", pointerMove);
            window.removeEventListener("pointerup", pointerUp);
        };
    }, [active, gl]);

    const forward = useMemo(() => new THREE.Vector3(), []);
    const right = useMemo(() => new THREE.Vector3(), []);

    useFrame((_, delta) => {
        if (!active) return;
        if (!look.current.ready) {
            // Take over from wherever the camera flight left the view.
            const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
            look.current = { yaw: euler.y, pitch: euler.x, ready: true };
        }
        const pressed = keys.current;
        let ahead = Number(pressed.has("w") || pressed.has("arrowup")) - Number(pressed.has("s") || pressed.has("arrowdown")) + outdoorInput.y;
        let side = Number(pressed.has("d") || pressed.has("arrowright")) - Number(pressed.has("a") || pressed.has("arrowleft")) + outdoorInput.x;
        const length = Math.hypot(ahead, side);
        if (length > 1) { ahead /= length; side /= length; }
        const speed = (pressed.has("shift") ? 7 : 3.4) * Math.min(delta, 0.05);

        forward.set(-Math.sin(look.current.yaw), 0, -Math.cos(look.current.yaw));
        right.set(Math.cos(look.current.yaw), 0, -Math.sin(look.current.yaw));
        const x = camera.position.x + (forward.x * ahead + right.x * side) * speed;
        const z = camera.position.z + (forward.z * ahead + right.z * side) * speed;

        // Walking into the front door takes you back inside.
        const atDoor = Math.abs(x - FRONT_DOOR.x) < 0.5 && z < HOUSE_BLOCKS[1].maxZ + 0.35 && z > HOUSE_BLOCKS[1].maxZ - 0.5;
        if (atDoor && !doorReported.current) {
            doorReported.current = true;
            onReachDoor();
            return;
        }
        const blocked = (px: number, pz: number) => {
            if (insideHouse(px, pz, 0.3)) return true;
            if (heightAt(px, pz) < WATER_LEVEL - 0.3) return true;
            const chunk = chunks.get(`${Math.floor(px / CHUNK_SIZE)},${Math.floor(pz / CHUNK_SIZE)}`);
            return blockedByTree(chunk?.data, px, pz);
        };
        // Slide along obstacles: try both axes separately.
        if (!blocked(x, camera.position.z)) camera.position.x = x;
        if (!blocked(camera.position.x, z)) camera.position.z = z;

        const groundEye = Math.max(heightAt(camera.position.x, camera.position.z), WATER_LEVEL - 0.3) + 1.6;
        camera.position.y += (groundEye - camera.position.y) * Math.min(1, delta * 10);
        camera.rotation.set(look.current.pitch, look.current.yaw, 0, "YXZ");
    });

    return null;
}

/** Everything outside the house. Mounted on the first trip outside. */
export default function Outdoors({ active, onReachDoor }: { active: boolean; onReachDoor: () => void }) {
    const chunks = useMemo(() => new Map<string, LoadedChunk>(), []);
    return (
        <>
            <House />
            <Forest active={active} chunks={chunks} />
            <WaterAndSky />
            <Walker active={active} chunks={chunks} onReachDoor={onReachDoor} />
        </>
    );
}
