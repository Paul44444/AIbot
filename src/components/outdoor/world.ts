import { FLOOR_Y, HOUSE_BLOCKS, insideHouse } from "../roomLayout";
import { fbm, hash2, noise2 } from "./noise";

// The forest around the house: terrain height, lakes and what grows where.
// Everything is a pure function of position, so tiles can be thrown away and
// rebuilt identically later.

export const CHUNK_SIZE = 32;
/** Grid cells per tile side; vertices are one more. */
export const CHUNK_SEGMENTS = 20;
/** Tiles kept in each direction around the camera (fog hides the edge). */
export const VIEW_RADIUS = 2;
export const WATER_LEVEL = FLOOR_Y - 0.9;

function distanceToHouse(x: number, z: number) {
    let best = Infinity;
    for (const b of HOUSE_BLOCKS) {
        const dx = Math.max(b.minX - x, 0, x - b.maxX);
        const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** Whether a point lies in dense forest (vs. meadow); also used for the minimap. */
export function forestAt(x: number, z: number) {
    return fbm(x * 0.02 + 5, z * 0.02 - 9, 2) > 0.05;
}

/** Ground height at a point: rolling hills, lake basins, flat around the house. */
export function heightAt(x: number, z: number) {
    const hills = fbm(x * 0.011, z * 0.011, 4) * 7;
    const bumps = noise2(x * 0.09, z * 0.09) * 0.35;
    let height = FLOOR_Y + 0.6 + hills + bumps;
    // Lakes: where this broad noise is low, dig a basin below the water line.
    const lake = noise2(x * 0.018 + 71, z * 0.018 - 33);
    if (lake < -0.25) height -= (-0.25 - lake) * 16;
    // A level clearing around the house so you step out onto flat ground.
    const blend = smoothstep(4, 26, distanceToHouse(x, z));
    return (FLOOR_Y - 0.04) * (1 - blend) + height * blend;
}

export type Instance = { x: number; y: number; z: number; scale: number; rotation: number; variant: number };

export type ChunkData = {
    key: string;
    cx: number;
    cz: number;
    positions: Float32Array;
    colors: Float32Array;
    pines: Instance[];
    leafy: Instance[];
    rocks: Instance[];
    flowers: Instance[];
};

const GRASS = [[0.36, 0.55, 0.27], [0.31, 0.49, 0.24], [0.42, 0.6, 0.3]];
const FOREST_FLOOR = [0.29, 0.4, 0.22];
const SHORE = [0.72, 0.66, 0.47];
const ROCK = [0.52, 0.52, 0.5];

/** Builds one tile's ground mesh data and what grows on it. */
export function buildChunk(cx: number, cz: number): ChunkData {
    const n = CHUNK_SEGMENTS;
    const step = CHUNK_SIZE / n;
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) heights[j * (n + 1) + i] = heightAt(originX + i * step, originZ + j * step);
    }

    // Flat-shaded triangles with per-face colours: the low-poly look.
    const positions = new Float32Array(n * n * 6 * 3);
    const colors = new Float32Array(n * n * 6 * 3);
    let p = 0;
    const vertex = (i: number, j: number) => [originX + i * step, heights[j * (n + 1) + i], originZ + j * step];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i, j + 1), d = vertex(i + 1, j + 1);
            for (const tri of [[a, c, b], [b, c, d]]) {
                const mid = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
                const slope = Math.max(...tri.map((v) => v[1])) - Math.min(...tri.map((v) => v[1]));
                let color = GRASS[Math.floor(hash2(i + originX, j + originZ, 3) * GRASS.length)];
                if (forestAt(tri[0][0], tri[0][2])) color = FOREST_FLOOR;
                if (mid < WATER_LEVEL + 0.35) color = SHORE;
                if (slope > step * 0.9) color = ROCK;
                for (const v of tri) {
                    positions.set(v, p);
                    colors.set(color, p);
                    p += 3;
                }
            }
        }
    }

    // What grows here, on a jittered 3 m grid so neighbouring tiles match.
    const pines: Instance[] = [];
    const leafy: Instance[] = [];
    const rocks: Instance[] = [];
    const flowers: Instance[] = [];
    const cell = 3;
    for (let gz = 0; gz < CHUNK_SIZE / cell; gz++) {
        for (let gx = 0; gx < CHUNK_SIZE / cell; gx++) {
            const wx = originX + (gx + hash2(cx * 97 + gx, cz * 89 + gz, 1)) * cell;
            const wz = originZ + (gz + hash2(cx * 97 + gx, cz * 89 + gz, 2)) * cell;
            const y = heightAt(wx, wz);
            const roll = hash2(Math.floor(wx * 10), Math.floor(wz * 10), 7);
            const clearing = distanceToHouse(wx, wz);
            // Nothing grows through the floor of the house.
            if (insideHouse(wx, wz, 0.6)) continue;
            if (y < WATER_LEVEL + 0.25 || clearing < 11) {
                // Reeds and flowers like the shore and the clearing.
                if (y >= WATER_LEVEL + 0.1 && roll < 0.35) flowers.push({ x: wx, y, z: wz, scale: 0.8 + roll, rotation: roll * 6, variant: Math.floor(roll * 40) % 4 });
                continue;
            }
            const dense = forestAt(wx, wz);
            const density = dense ? 0.62 : 0.12;
            const instance = { x: wx, y, z: wz, scale: 0.75 + hash2(gx, gz, cx * 13 + cz) * 0.8, rotation: roll * Math.PI * 2, variant: 0 };
            if (roll < density) {
                (hash2(gx + 3, gz + 5, cx - cz) < 0.62 ? pines : leafy).push(instance);
            } else if (roll < density + 0.05) {
                rocks.push({ ...instance, scale: 0.4 + roll * 0.8 });
            } else if (!dense && roll < density + 0.4) {
                flowers.push({ ...instance, scale: 0.8 + roll * 0.5, variant: Math.floor(roll * 40) % 4 });
            }
        }
    }

    return { key: `${cx},${cz}`, cx, cz, positions, colors, pines, leafy, rocks, flowers };
}

/** Trees in a tile block walking; a cheap radius check against nearby trunks. */
export function blockedByTree(chunk: ChunkData | undefined, x: number, z: number) {
    if (!chunk) return false;
    // A little more than the trunk, so it never fills the whole view, but the
    // gaps between trees in dense forest stay walkable.
    for (const tree of chunk.pines) if (Math.hypot(tree.x - x, tree.z - z) < 0.45 + 0.12 * tree.scale) return true;
    for (const tree of chunk.leafy) if (Math.hypot(tree.x - x, tree.z - z) < 0.5 + 0.14 * tree.scale) return true;
    return false;
}
