import type { CharacterId } from "../data/characters";

// Three rooms in a row, Jinx | Jenny | Smyth, joined by doorways in Jenny's side
// walls. Walls are planes; neighbouring rooms keep a gap so doorways have depth.

export const FLOOR_Y = -2;
export const HEIGHT = 2.9;
export const WALL_GAP = 0.24;

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const ROOM_BOUNDS: Record<CharacterId, Bounds> = {
    jinx: { minX: -10.0, maxX: -3.6 - WALL_GAP, minZ: -4, maxZ: 2.2 },
    jenny: { minX: -3.6, maxX: 4.4, minZ: -4, maxZ: 3.2 },
    smyth: { minX: 4.4 + WALL_GAP, maxX: 10.8, minZ: -4, maxZ: 2.2 },
};

/** Rooms from west to east; walking between two rooms passes the doorways in between. */
export const ROOM_ORDER: CharacterId[] = ["jinx", "jenny", "smyth"];

/** Doorways sit at the same z in both walls; x is the middle of the gap. */
export const DOORWAY_Z = 0.9;
export const DOORWAY_WIDTH = 1.0;
export const DOORWAY_HEIGHT = 2.1;
export const DOORWAYS = [
    { x: -3.6 - WALL_GAP / 2, west: "jinx", east: "jenny" },
    { x: 4.4 + WALL_GAP / 2, west: "jenny", east: "smyth" },
] as const;

/** Where each resident stands; the camera looks at them from the +x/+z side. */
export const SEATS: Record<CharacterId, [number, number]> = {
    jinx: [-7.4, -1.5],
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

export type PcScreen = { position: [number, number, number]; yaw: number; width: number; height: number };

/**
 * World position of each character's PC screen. These follow the desks in the
 * room files (Desk in CozyRoom, GamingDesk in JinxRoom, StudyDesk in SmythRoom);
 * keep them in sync when moving furniture.
 */
export const PCS: Record<CharacterId, PcScreen> = {
    // Jenny's desk at north-wall x −1.0; monitor 0.12 m back on the 0.76 m desk top.
    jenny: { position: [-0.58, FLOOR_Y + 1.04, -3.8065], yaw: 0, width: 0.52, height: 0.32 },
    // Jinx's gaming desk at north-wall x −0.3; his left monitor, turned 0.18 rad toward the chair.
    jinx: { position: [-7.577, FLOOR_Y + 1.08, -3.704], yaw: 0.18, width: 0.6, height: 0.36 },
    // Smyth's study desk at north-wall x −0.7, between microscope and banker's lamp.
    smyth: { position: [7.07, FLOOR_Y + 1.07, -3.7165], yaw: 0, width: 0.52, height: 0.32 },
};
