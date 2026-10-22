import type { CharacterId } from "../data/characters";

// Three rooms in a row, Bob | Jenny | Smyth, joined by doorways in Jenny's side
// walls. Walls are planes; neighbouring rooms keep a gap so doorways have depth.

export const FLOOR_Y = -2;
export const HEIGHT = 2.9;
export const WALL_GAP = 0.24;

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const ROOM_BOUNDS: Record<CharacterId, Bounds> = {
    bob: { minX: -10.0, maxX: -3.6 - WALL_GAP, minZ: -4, maxZ: 2.2 },
    jenny: { minX: -3.6, maxX: 4.4, minZ: -4, maxZ: 3.2 },
    smyth: { minX: 4.4 + WALL_GAP, maxX: 10.8, minZ: -4, maxZ: 2.2 },
};

/** Rooms from west to east; walking between two rooms passes the doorways in between. */
export const ROOM_ORDER: CharacterId[] = ["bob", "jenny", "smyth"];

/** Doorways sit at the same z in both walls; x is the middle of the gap. */
export const DOORWAY_Z = 0.9;
export const DOORWAY_WIDTH = 1.0;
export const DOORWAY_HEIGHT = 2.1;
export const DOORWAYS = [
    { x: -3.6 - WALL_GAP / 2, west: "bob", east: "jenny" },
    { x: 4.4 + WALL_GAP / 2, west: "jenny", east: "smyth" },
] as const;

/** Where each resident stands; the camera looks at them from the +x/+z side. */
export const SEATS: Record<CharacterId, [number, number]> = {
    bob: [-7.4, -1.5],
    jenny: [0, 0],
    smyth: [7.1, -1.5],
};

export function center(bounds: Bounds) {
    return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}

export function roomAt(x: number, z: number): CharacterId | null {
    for (const id of ROOM_ORDER) {
        const b = ROOM_BOUNDS[id];
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return id;
    }
    return null;
}

/** Wall-local x of a doorway at world z, for a west (+π/2) or east (−π/2) wall. */
export function doorwayLocalX(bounds: Bounds, side: "west" | "east") {
    const { z } = center(bounds);
    return side === "west" ? -(DOORWAY_Z - z) : DOORWAY_Z - z;
}
