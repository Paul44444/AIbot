import type { CharacterId } from "../data/characters";
import { ROOM_ORDER } from "./roomLayout";

/**
 * What can be seen from the camera this frame, set by VisibilityControl in
 * SceneView before anything else runs. Rooms and residents outside it are
 * neither drawn nor animated; the forest is drawn only from outside.
 */
export const sceneVisibility = { rooms: new Set<CharacterId>(ROOM_ORDER), outdoors: false };
