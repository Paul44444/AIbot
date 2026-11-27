import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import { BlobShadow, Plant, Room, canvasTexture, doorwayHole, type Hole } from "./CozyRoom";
import { DOORWAY_HEIGHT, DOORWAY_WIDTH, DOORWAY_Z, FLOOR_Y, FRONT_DOOR, HEIGHT, ROOM_BOUNDS, SEATS, WALL_GAP, center } from "./roomLayout";
import type { CharacterId } from "../data/characters";
import { PATIENT_CASES } from "../data/patients";

// Patient mode turns the house into a medical practice: each character's room becomes
// an exam room in the same place (same walls and doorways), and the patient sits on a
// chair where the resident usually stands. The usual rooms (CozyRoom, JinxRoom,
// SmythRoom) are unchanged and come back when patient mode is off.

const WALLS = { color: "#eef3f1", trim: "#a9bdb7", wainscot: false };
const FLOOR_TONES = ["#c9cfd0", "#c3c9cb", "#ced4d4", "#c6cccd"];
const WHITE = "#f5f6f4";
const STEEL = "#b8bec3";
const TEAL = "#2fa58f";
const ROOM_NUMBER: Record<CharacterId, number> = { jinx: 1, jenny: 2, smyth: 3 };

/** The patient chair faces the usual camera view (toward +x/+z); see Character's seated pose. */
export const CHAIR_YAW = Math.PI / 4;

function makeRecordTexture(id: CharacterId) {
    const patient = PATIENT_CASES[id];
    return canvasTexture(520, 320, (ctx) => {
        ctx.fillStyle = "#f4f7f8";
        ctx.fillRect(0, 0, 520, 320);
        ctx.fillStyle = TEAL;
        ctx.fillRect(0, 0, 520, 44);
        ctx.fillStyle = "white";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.fillText("Patient record", 18, 30);
        ctx.fillStyle = "#1d2a33";
        ctx.font = "bold 26px system-ui, sans-serif";
        ctx.fillText(`${patient.fullName.replace(/ “.*”/, "")}, ${patient.age}`, 18, 88);
        ctx.font = "18px system-ui, sans-serif";
        ctx.fillStyle = "#56656f";
        ctx.fillText("Reason for visit", 18, 124);
        ctx.fillStyle = "#1d2a33";
        ctx.fillText(patient.reason.replace(/[“”]/g, ""), 18, 150);
        ctx.fillStyle = "#56656f";
        ["History", "Medication", "Allergies", "Notes"].forEach((label, index) => {
            const y = 190 + index * 32;
            ctx.fillText(label, 18, y);
            ctx.fillStyle = "#d7dee2";
            ctx.fillRect(150, y - 14, 340, 16);
            ctx.fillStyle = "#56656f";
        });
    });
}

/** A sign as a texture: drei's Text would fetch a font and render late. */
function makeSignTexture(width: number, height: number, lines: { text: string; font: string; color: string; y: number }[], band?: { color: string; height: number }) {
    return canvasTexture(width, height, (ctx) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        if (band) {
            ctx.fillStyle = band.color;
            ctx.fillRect(0, 0, width, band.height);
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const line of lines) {
            ctx.font = line.font;
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, width / 2, line.y);
        }
    });
}

function makeEyeChartTexture() {
    return canvasTexture(240, 360, (ctx) => {
        ctx.fillStyle = "#fbfbf8";
        ctx.fillRect(0, 0, 240, 360);
        ctx.fillStyle = "#111";
        ctx.textAlign = "center";
        const rows = ["E", "F P", "T O Z", "L P E D", "P E C F D", "E D F C Z P", "F E L O P Z D"];
        rows.forEach((row, index) => {
            ctx.font = `bold ${Math.round(70 * 0.72 ** index)}px Georgia, serif`;
            ctx.fillText(row, 120, 70 + index * 44 - index * index * 1.5);
        });
        ctx.fillStyle = "#c33";
        ctx.fillRect(30, 318, 180, 3);
    });
}

function makeAnatomyTexture() {
    return canvasTexture(300, 420, (ctx) => {
        ctx.fillStyle = "#fdfbf5";
        ctx.fillRect(0, 0, 300, 420);
        ctx.fillStyle = "#1d2a33";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("The Human Heart", 150, 34);
        // Body outline with heart and lungs.
        ctx.fillStyle = "#f1d3bf";
        ctx.beginPath();
        ctx.arc(150, 84, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(92, 118, 116, 190, 40);
        ctx.fill();
        ctx.fillStyle = "#f2a5ad";
        ctx.beginPath();
        ctx.ellipse(124, 190, 24, 48, 0.1, 0, Math.PI * 2);
        ctx.ellipse(176, 190, 24, 48, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c62f3b";
        ctx.beginPath();
        ctx.moveTo(150, 236);
        ctx.bezierCurveTo(112, 206, 128, 172, 150, 190);
        ctx.bezierCurveTo(172, 172, 188, 206, 150, 236);
        ctx.fill();
        ctx.strokeStyle = "#3d6fb6";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(150, 190);
        ctx.lineTo(150, 150);
        ctx.stroke();
        ctx.fillStyle = "#56656f";
        ctx.font = "14px system-ui, sans-serif";
        ["Right atrium · Left atrium", "Right ventricle · Left ventricle", "Aorta · Pulmonary artery"].forEach((line, index) => {
            ctx.fillText(line, 150, 340 + index * 22);
        });
    });
}

/** Padded chair for the patient; its front faces +z. */
export function PatientChair({ position, rotation = CHAIR_YAW, handbag = false }: {
    position: [number, number, number];
    rotation?: number;
    /** A handbag on the lap of whoever sits there (it also keeps a skirt decent from the camera's angle). */
    handbag?: boolean;
}) {
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            {handbag && (
                <group position={[0, 0.7, 0.2]} rotation={[-0.12, 0, 0]}>
                    <RoundedBox smoothness={2} bevelSegments={1} args={[0.3, 0.2, 0.12]} radius={0.035}>
                        <meshStandardMaterial color="#b0614f" roughness={0.55} />
                    </RoundedBox>
                    <mesh position={[0, 0.1, 0]}>
                        <torusGeometry args={[0.08, 0.011, 6, 20, Math.PI]} />
                        <meshStandardMaterial color="#7d3f33" roughness={0.5} />
                    </mesh>
                    <mesh position={[0, 0.04, 0.061]}>
                        <boxGeometry args={[0.07, 0.03, 0.005]} />
                        <meshStandardMaterial color="#d8b36a" metalness={0.6} roughness={0.3} />
                    </mesh>
                </group>
            )}
            <BlobShadow size={0.8} opacity={0.5} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.5, 0.08, 0.48]} radius={0.03} position={[0, 0.44, 0]}>
                <meshStandardMaterial color="#3b7f9a" roughness={0.6} />
            </RoundedBox>
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.5, 0.48, 0.07]} radius={0.03} position={[0, 0.74, -0.24]} rotation={[-0.1, 0, 0]}>
                <meshStandardMaterial color="#3b7f9a" roughness={0.6} />
            </RoundedBox>
            {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => (
                <mesh key={`${sx}${sz}`} position={[sx * 0.22, 0.2, sz * 0.2]}>
                    <cylinderGeometry args={[0.015, 0.015, 0.4, 8]} />
                    <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.35} />
                </mesh>
            ))}
        </group>
    );
}

/** Examination couch with a paper roll; its length runs along x. */
function ExamCouch({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            <BlobShadow size={2.0} opacity={0.5} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.9, 0.12, 0.7]} radius={0.04} position={[0, 0.66, 0]}>
                <meshStandardMaterial color="#5a8fa8" roughness={0.55} />
            </RoundedBox>
            {/* Raised head end. */}
            <RoundedBox smoothness={2} bevelSegments={1} args={[0.55, 0.1, 0.7]} radius={0.04} position={[-0.78, 0.8, 0]} rotation={[0, 0, -0.35]}>
                <meshStandardMaterial color="#5a8fa8" roughness={0.55} />
            </RoundedBox>
            {/* Paper sheet over the middle and the roll at the foot. */}
            <mesh position={[0.15, 0.725, 0]}>
                <boxGeometry args={[1.3, 0.005, 0.5]} />
                <meshStandardMaterial color="#fbfbf6" roughness={0.9} />
            </mesh>
            <mesh position={[0.98, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.06, 0.06, 0.52, 14]} />
                <meshStandardMaterial color="#fbfbf6" roughness={0.9} />
            </mesh>
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.7, 0.56, 0.6]} radius={0.03} position={[0, 0.3, 0]}>
                <meshStandardMaterial color={WHITE} roughness={0.5} />
            </RoundedBox>
            {/* Step. */}
            <mesh position={[0.3, 0.1, 0.45]}>
                <boxGeometry args={[0.5, 0.2, 0.28]} />
                <meshStandardMaterial color={STEEL} metalness={0.3} roughness={0.5} />
            </mesh>
        </group>
    );
}

/** Desk with the patient record on the screen and a chair for the doctor; front toward +z. */
function DoctorDesk({ position, record }: { position: [number, number, number]; record: THREE.Texture }) {
    const height = 0.74;
    return (
        <group position={position}>
            <BlobShadow size={1.7} opacity={0.5} />
            <RoundedBox smoothness={2} bevelSegments={1} args={[1.3, 0.04, 0.65]} radius={0.015} position={[0, height, 0]}>
                <meshStandardMaterial color="#e4e0d8" roughness={0.5} />
            </RoundedBox>
            <mesh position={[-0.42, height / 2, 0]}>
                <boxGeometry args={[0.42, height, 0.6]} />
                <meshStandardMaterial color={WHITE} roughness={0.5} />
            </mesh>
            {[[0.6, -0.27], [0.6, 0.27]].map(([x, z]) => (
                <mesh key={z} position={[x, height / 2, z]}>
                    <boxGeometry args={[0.04, height, 0.04]} />
                    <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.35} />
                </mesh>
            ))}
            {/* Screen with the patient record. */}
            <group position={[0.1, height + 0.02, -0.16]}>
                <mesh position={[0, 0.07, -0.03]}>
                    <boxGeometry args={[0.04, 0.14, 0.03]} />
                    <meshStandardMaterial color="#2a2d33" roughness={0.5} />
                </mesh>
                <mesh position={[0, 0.32, 0]}>
                    <boxGeometry args={[0.6, 0.38, 0.025]} />
                    <meshStandardMaterial color="#1b1d22" roughness={0.4} />
                </mesh>
                <mesh position={[0, 0.32, 0.0135]}>
                    <planeGeometry args={[0.56, 0.345]} />
                    <meshBasicMaterial map={record} toneMapped={false} />
                </mesh>
            </group>
            <mesh position={[0.1, height + 0.03, 0.12]}>
                <boxGeometry args={[0.42, 0.015, 0.13]} />
                <meshStandardMaterial color="#d8dadd" roughness={0.6} />
            </mesh>
            {/* Stethoscope on the desk. */}
            <mesh position={[-0.35, height + 0.03, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.09, 0.008, 8, 24]} />
                <meshStandardMaterial color="#2b2f36" roughness={0.4} />
            </mesh>
            <mesh position={[-0.27, height + 0.035, 0.2]}>
                <cylinderGeometry args={[0.025, 0.025, 0.012, 16]} />
                <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.25} />
            </mesh>
            {/* Doctor's swivel chair. */}
            <group position={[0.15, 0, 0.62]} rotation={[0, Math.PI + 0.4, 0]}>
                <mesh position={[0, 0.025, 0]}>
                    <cylinderGeometry args={[0.28, 0.28, 0.03, 5]} />
                    <meshStandardMaterial color="#2b2f36" roughness={0.5} />
                </mesh>
                <mesh position={[0, 0.24, 0]}>
                    <cylinderGeometry args={[0.03, 0.03, 0.42, 8]} />
                    <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.3} />
                </mesh>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.46, 0.07, 0.44]} radius={0.03} position={[0, 0.47, 0]}>
                    <meshStandardMaterial color="#2b2f36" roughness={0.6} />
                </RoundedBox>
                <RoundedBox smoothness={2} bevelSegments={1} args={[0.44, 0.5, 0.06]} radius={0.03} position={[0, 0.8, -0.22]}>
                    <meshStandardMaterial color="#2b2f36" roughness={0.6} />
                </RoundedBox>
            </group>
        </group>
    );
}

/** Base cabinet with a sink, soap and disinfectant, and a wall cabinet; front toward +z. */
function SinkUnit({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <BlobShadow size={1.2} opacity={0.45} />
            <mesh position={[0, 0.43, 0]}>
                <boxGeometry args={[1.0, 0.86, 0.55]} />
                <meshStandardMaterial color={WHITE} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.88, 0]}>
                <boxGeometry args={[1.04, 0.04, 0.58]} />
                <meshStandardMaterial color="#c9d1d4" roughness={0.35} />
            </mesh>
            <mesh position={[0, 0.895, 0.02]}>
                <boxGeometry args={[0.44, 0.012, 0.34]} />
                <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.2} />
            </mesh>
            <mesh position={[0, 1.0, -0.2]} rotation={[0.5, 0, 0]}>
                <cylinderGeometry args={[0.015, 0.015, 0.22, 8]} />
                <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Drawer lines. */}
            {[0.3, 0.6].map((y) => (
                <mesh key={y} position={[0, y, 0.278]}>
                    <boxGeometry args={[0.96, 0.008, 0.005]} />
                    <meshStandardMaterial color="#c8ced0" />
                </mesh>
            ))}
            {/* Wall cabinet and dispensers. */}
            <mesh position={[0, 1.85, -0.1]}>
                <boxGeometry args={[1.0, 0.6, 0.34]} />
                <meshStandardMaterial color={WHITE} roughness={0.45} />
            </mesh>
            <mesh position={[0, 1.85, 0.072]}>
                <boxGeometry args={[0.005, 0.56, 0.005]} />
                <meshStandardMaterial color="#c8ced0" />
            </mesh>
            {[-0.62, 0.62].map((x, index) => (
                <group key={x} position={[x, 1.3, -0.22]}>
                    <mesh>
                        <boxGeometry args={[0.12, 0.22, 0.1]} />
                        <meshStandardMaterial color={index ? "#e9eef0" : WHITE} roughness={0.4} />
                    </mesh>
                    <mesh position={[0, -0.05, 0.051]}>
                        <planeGeometry args={[0.08, 0.06]} />
                        <meshStandardMaterial color={index ? TEAL : "#4a86c5"} roughness={0.5} />
                    </mesh>
                </group>
            ))}
        </group>
    );
}

/** Wall-mounted blood pressure monitor. */
function BloodPressureMonitor({ position }: { position: [number, number, number] }) {
    return (
        <group position={position}>
            <mesh>
                <boxGeometry args={[0.26, 0.2, 0.06]} />
                <meshStandardMaterial color="#e9edef" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.02, 0.031]}>
                <circleGeometry args={[0.07, 24]} />
                <meshStandardMaterial color="#fafafa" roughness={0.4} />
            </mesh>
            <mesh position={[0.02, -0.12, 0.03]} rotation={[0, 0, 0.4]}>
                <torusGeometry args={[0.08, 0.008, 6, 20, Math.PI]} />
                <meshStandardMaterial color="#2b2f36" roughness={0.5} />
            </mesh>
        </group>
    );
}

function CeilingPanel({ position }: { position: [number, number, number] }) {
    return (
        <mesh position={position}>
            <boxGeometry args={[1.2, 0.04, 0.6]} />
            <meshStandardMaterial color="#ffffff" emissive="#f2f7ff" emissiveIntensity={1.2} />
        </mesh>
    );
}

/** An exam room in place of a character's room: same walls and doorways, a practice inside. */
export default function PracticeRoom({ id }: { id: CharacterId }) {
    const bounds = ROOM_BOUNDS[id];
    const { x: cx, z: cz } = center(bounds);
    const [sx, sz] = SEATS[id];
    const textures = useMemo(() => ({
        record: makeRecordTexture(id),
        eyeChart: makeEyeChartTexture(),
        anatomy: makeAnatomyTexture(),
        number: makeSignTexture(360, 90, [{ text: `Exam Room ${ROOM_NUMBER[id]}`, font: "bold 44px system-ui, sans-serif", color: TEAL, y: 46 }]),
    }), [id]);
    // The consultation corner sits in the north-west, behind the patient as the camera sees them.
    const deskX = sx + 1.15;
    const sinkX = sx - 1.55;
    // Clear of the doorway in the west wall (at DOORWAY_Z).
    const couchZ = Math.min(sz + 0.2, DOORWAY_Z - DOORWAY_WIDTH / 2 - 1.05);
    const holes = useMemo(() => {
        const north: Hole[] = [{ x: sx - 0.2 - cx, y: 1.0, w: 0.8, h: 1.1, curtain: "#dfe8ea" }];
        const west: Hole[] = id === "jinx" ? [] : [doorwayHole(bounds, "west")];
        const east: Hole[] = id === "smyth" ? [] : [doorwayHole(bounds, "east")];
        // The front door in Jenny's (now the middle exam room's) south wall; wall-local x runs opposite to world x.
        const south: Hole[] = id === "jenny"
            ? [{ kind: "doorway", x: -(FRONT_DOOR.x - cx), y: 0, w: DOORWAY_WIDTH, h: DOORWAY_HEIGHT }]
            : [];
        return { north, west, east, south };
    }, [id, bounds, cx, sx]);

    return (
        <Room
            bounds={bounds}
            style={WALLS}
            beams={false}
            ceilingColor="#f4f6f6"
            floorTones={FLOOR_TONES}
            north={{ holes: holes.north }}
            west={{ holes: holes.west }}
            east={{ holes: holes.east }}
            south={{ holes: holes.south }}
        >
            {/* The consultation: patient chair, the doctor's desk behind it, sink by the window. */}
            <PatientChair position={[sx, FLOOR_Y, sz]} handbag={id === "jenny"} />
            <DoctorDesk position={[deskX, FLOOR_Y, bounds.minZ + 0.38]} record={textures.record} />
            <SinkUnit position={[sinkX, FLOOR_Y, bounds.minZ + 0.3]} />
            <BloodPressureMonitor position={[deskX + 0.95, FLOOR_Y + 1.45, bounds.minZ + 0.04]} />
            {/* Anatomy poster above the desk, eye chart and couch on the west wall. */}
            <mesh position={[deskX - 0.1, FLOOR_Y + 1.75, bounds.minZ + 0.012]}>
                <planeGeometry args={[0.5, 0.7]} />
                <meshStandardMaterial map={textures.anatomy} roughness={0.85} />
            </mesh>
            <ExamCouch position={[bounds.minX + 0.42, FLOOR_Y, couchZ]} rotation={Math.PI / 2} />
            <mesh position={[bounds.minX + 0.012, FLOOR_Y + 1.6, couchZ - 1.55]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[0.4, 0.6]} />
                <meshStandardMaterial map={textures.eyeChart} roughness={0.85} />
            </mesh>
            <Plant position={[deskX + 1.0, FLOOR_Y, bounds.minZ + 0.35]} scale={1.3} seed={200 + ROOM_NUMBER[id]} />
            <CeilingPanel position={[cx, FLOOR_Y + HEIGHT - 0.03, cz]} />
            {/* Room number on the north wall. */}
            <mesh position={[deskX + 0.95, FLOOR_Y + 2.05, bounds.minZ + 0.012]}>
                <planeGeometry args={[0.72, 0.18]} />
                <meshStandardMaterial map={textures.number} roughness={0.6} />
            </mesh>
        </Room>
    );
}

/** The practice's sign outside, beside the front door. */
export function PracticeSign() {
    const z = ROOM_BOUNDS.jenny.maxZ + WALL_GAP + 0.03;
    const texture = useMemo(() => makeSignTexture(480, 300, [
        { text: "Medical Practice", font: "bold 46px system-ui, sans-serif", color: "#ffffff", y: 48 },
        { text: "Angie-O-Gram", font: "bold 50px system-ui, sans-serif", color: "#1d2a33", y: 160 },
        { text: "History-taking practice", font: "28px system-ui, sans-serif", color: "#56656f", y: 236 },
    ], { color: TEAL, height: 96 }), []);
    return (
        <group position={[FRONT_DOOR.x + DOORWAY_WIDTH / 2 + 0.55, FLOOR_Y + 1.55, z]}>
            <mesh>
                <boxGeometry args={[0.8, 0.5, 0.03]} />
                <meshStandardMaterial color="#ffffff" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.016]}>
                <planeGeometry args={[0.8, 0.5]} />
                <meshStandardMaterial map={texture} roughness={0.5} />
            </mesh>
        </group>
    );
}
