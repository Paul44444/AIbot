import { useEffect, useRef } from "react";
import { FRONT_DOOR, HOUSE_BLOCKS } from "../roomLayout";
import { outdoorState } from "./input";
import { WATER_LEVEL, forestAt, heightAt } from "./world";

// A round, north-up map around the walker. The terrain image is sampled again
// only after moving a few metres; every frame it is just shifted and the
// marker and the way home are drawn on top.

/** Metres from the centre to the edge of the map. */
const RANGE = 70;
/** Terrain samples per side of the cached image. */
const SAMPLES = 72;

function terrainColor(x: number, z: number) {
    const h = heightAt(x, z);
    if (h < WATER_LEVEL - 1.1) return "#2f6f98";
    if (h < WATER_LEVEL) return "#4c8fb5";
    if (h < WATER_LEVEL + 0.35) return "#d8c992";
    return forestAt(x, z) ? "#3f7a3d" : "#8fbf6a";
}

export default function Minimap({ size }: { size: number }) {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const element = canvas.current!;
        const ratio = window.devicePixelRatio || 1;
        element.width = size * ratio;
        element.height = size * ratio;
        const ctx = element.getContext("2d")!;
        const terrain = document.createElement("canvas");
        terrain.width = SAMPLES;
        terrain.height = SAMPLES;
        const terrainCtx = terrain.getContext("2d")!;
        // The cached image covers a bit more than the map so shifting never shows an edge.
        const span = RANGE * 2.4;
        let cachedAt: { x: number; z: number } | null = null;
        let frame = 0;

        const sampleTerrain = (cx: number, cz: number) => {
            const cell = span / SAMPLES;
            for (let j = 0; j < SAMPLES; j++) {
                for (let i = 0; i < SAMPLES; i++) {
                    const x = cx - span / 2 + (i + 0.5) * cell;
                    const z = cz - span / 2 + (j + 0.5) * cell;
                    terrainCtx.fillStyle = terrainColor(x, z);
                    terrainCtx.fillRect(i, j, 1, 1);
                }
            }
            terrainCtx.fillStyle = "#8a5a3c";
            for (const b of HOUSE_BLOCKS) {
                terrainCtx.fillRect(
                    ((b.minX - (cx - span / 2)) / span) * SAMPLES,
                    ((b.minZ - (cz - span / 2)) / span) * SAMPLES,
                    ((b.maxX - b.minX) / span) * SAMPLES,
                    ((b.maxZ - b.minZ) / span) * SAMPLES,
                );
            }
            cachedAt = { x: cx, z: cz };
        };

        const draw = () => {
            frame = requestAnimationFrame(draw);
            const { x, z, yaw } = outdoorState;
            if (!cachedAt || Math.hypot(x - cachedAt.x, z - cachedAt.z) > 6) sampleTerrain(x, z);
            const s = size * ratio;
            const pxPerMetre = s / (RANGE * 2);
            ctx.save();
            ctx.clearRect(0, 0, s, s);
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
            ctx.clip();
            // Terrain, shifted by how far we walked since it was sampled.
            const imageSize = span * pxPerMetre;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(
                terrain,
                s / 2 - imageSize / 2 + (cachedAt!.x - x) * pxPerMetre,
                s / 2 - imageSize / 2 + (cachedAt!.z - z) * pxPerMetre,
                imageSize,
                imageSize,
            );

            // The way home: the front door on the map, or an arrow on the rim.
            const dx = FRONT_DOOR.x - x;
            const dz = FRONT_DOOR.z + 0.8 - z;
            const distance = Math.hypot(dx, dz);
            const homeX = s / 2 + dx * pxPerMetre;
            const homeY = s / 2 + dz * pxPerMetre;
            const radius = s / 2 - 14 * ratio;
            ctx.font = `${13 * ratio}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            if (distance * pxPerMetre < radius) {
                ctx.fillText("🏠", homeX, homeY);
            } else {
                const angle = Math.atan2(dz, dx);
                const edgeX = s / 2 + Math.cos(angle) * radius;
                const edgeY = s / 2 + Math.sin(angle) * radius;
                // A small pointer on the rim of the badge, aimed at home.
                ctx.fillStyle = "#ffcf6b";
                ctx.beginPath();
                ctx.moveTo(edgeX + Math.cos(angle) * 19 * ratio, edgeY + Math.sin(angle) * 19 * ratio);
                ctx.lineTo(edgeX + Math.cos(angle + 0.6) * 11 * ratio, edgeY + Math.sin(angle + 0.6) * 11 * ratio);
                ctx.lineTo(edgeX + Math.cos(angle - 0.6) * 11 * ratio, edgeY + Math.sin(angle - 0.6) * 11 * ratio);
                ctx.fill();
                ctx.fillStyle = "rgba(20, 23, 37, 0.9)";
                ctx.strokeStyle = "#ffcf6b";
                ctx.lineWidth = 2 * ratio;
                ctx.beginPath();
                ctx.arc(edgeX, edgeY, 12 * ratio, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillText("🏠", edgeX, edgeY);
            }

            // You: an arrow in the direction you look (yaw 0 looks north, −z).
            ctx.translate(s / 2, s / 2);
            ctx.rotate(-yaw);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#e5484d";
            ctx.lineWidth = 2 * ratio;
            ctx.beginPath();
            ctx.moveTo(0, -9 * ratio);
            ctx.lineTo(7 * ratio, 7 * ratio);
            ctx.lineTo(0, 3 * ratio);
            ctx.lineTo(-7 * ratio, 7 * ratio);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // North marker and the distance home.
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 ${11 * ratio}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText("N", s / 2, 10 * ratio);
            const label = element.parentElement?.querySelector<HTMLElement>(".minimapDistance");
            if (label) label.textContent = distance < 8 ? "Home is right here" : `🏠 ${Math.round(distance)} m`;
        };
        draw();
        return () => cancelAnimationFrame(frame);
    }, [size]);

    return (
        <div className="minimap" style={{ width: size }} aria-label="Map around you">
            <canvas ref={canvas} style={{ width: size, height: size }} />
            <span className="minimapDistance" />
        </div>
    );
}
