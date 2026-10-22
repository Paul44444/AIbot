import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dagre from "@dagrejs/dagre";
import { Download, List, Maximize2, Minimize2, PencilLine, Scan, X } from "lucide-react";
import type { DiagramColor, DiagramSpec } from "../types/diagram";

// Lays out a planned diagram with dagre and draws it as SVG on a whiteboard.

const PALETTE: Record<DiagramColor, { main: string; soft: string }> = {
    blue: { main: "#3f7be0", soft: "#e8f0fd" },
    green: { main: "#2f9e6a", soft: "#e5f5ec" },
    orange: { main: "#e48a2c", soft: "#fdf0e2" },
    purple: { main: "#7d5ce0", soft: "#efeafd" },
    pink: { main: "#d9558f", soft: "#fce9f1" },
    teal: { main: "#22a3a0", soft: "#e2f5f4" },
    red: { main: "#d9473f", soft: "#fce8e6" },
    gray: { main: "#6f7889", soft: "#eef0f4" },
};
const NEUTRAL = PALETTE.gray;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const LABEL_FONT = `650 14px ${FONT}`;
const DETAIL_FONT = `400 12px ${FONT}`;
const EDGE_FONT = `500 11px ${FONT}`;
const TEXT_WIDTH = 168;

let measureContext: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string) {
    measureContext ??= document.createElement("canvas").getContext("2d")!;
    measureContext.font = font;
    return measureContext.measureText(text).width;
}

function wrap(text: string, font: string, maxWidth: number) {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && textWidth(next, font) > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

type PlacedNode = DiagramSpec["nodes"][number] & {
    x: number; y: number; width: number; height: number;
    labelLines: string[]; detailLines: string[]; color: { main: string; soft: string };
};
type PlacedGroup = DiagramSpec["groups"][number] & { x: number; y: number; width: number; height: number };
type PlacedEdge = DiagramSpec["edges"][number] & { points: { x: number; y: number }[]; labelX?: number; labelY?: number; labelWidth: number };

/** Too many arrows turn a sketch into spaghetti; keep the meaningful ones. */
function readableEdges(spec: DiagramSpec, nodeIds: Set<string>) {
    const valid = spec.edges.map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to);
    const limit = Math.max(6, Math.round(nodeIds.size * 1.4));
    if (valid.length <= limit) return valid;
    const rank = ({ edge }: { edge: DiagramSpec["edges"][number] }) => (edge.dashed ? 2 : 0) + (edge.label ? 0 : 1);
    return valid.slice().sort((a, b) => rank(a) - rank(b)).slice(0, limit).sort((a, b) => a.index - b.index);
}

function layout(spec: DiagramSpec, direction: "LR" | "TB") {
    const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
    graph.setGraph({ rankdir: direction, nodesep: 38, ranksep: 58, edgesep: 12, marginx: 30, marginy: 40 });
    graph.setDefaultEdgeLabel(() => ({}));

    const groupIds = new Set(spec.groups.map((group) => group.id));
    for (const group of spec.groups) graph.setNode(`group:${group.id}`, {});

    const nodeIds = new Set<string>();
    for (const node of spec.nodes) {
        if (nodeIds.has(node.id)) continue;
        nodeIds.add(node.id);
        const labelLines = wrap(node.label, LABEL_FONT, TEXT_WIDTH);
        const detailLines = node.detail ? wrap(node.detail, DETAIL_FONT, TEXT_WIDTH) : [];
        const widest = Math.max(...labelLines.map((l) => textWidth(l, LABEL_FONT)), ...detailLines.map((l) => textWidth(l, DETAIL_FONT)), 60);
        const width = Math.round(widest + (node.icon ? 66 : 32));
        const height = Math.max(54, 24 + labelLines.length * 18 + (detailLines.length ? 4 + detailLines.length * 15 : 0));
        graph.setNode(node.id, { width, height, labelLines, detailLines });
        if (node.group && groupIds.has(node.group)) graph.setParent(node.id, `group:${node.group}`);
    }
    // Groups without members would be laid out as empty boxes.
    for (const group of spec.groups) {
        if (!graph.children(`group:${group.id}`)?.length) graph.removeNode(`group:${group.id}`);
    }

    readableEdges(spec, nodeIds).forEach(({ edge, index }) => {
        // Labels are placed on the drawn path afterwards: as dagre nodes they would add
        // a whole extra rank between every pair of ranks and make sketches twice as wide.
        graph.setEdge(edge.from, edge.to, {}, String(index));
    });

    dagre.layout(graph);

    const groupColor = new Map(spec.groups.map((group) => [group.id, PALETTE[group.color] ?? NEUTRAL]));
    const nodes: PlacedNode[] = spec.nodes.filter((node, index, all) => all.findIndex((n) => n.id === node.id) === index).map((node) => {
        const placed = graph.node(node.id) as dagre.Node & { labelLines: string[]; detailLines: string[] };
        return {
            ...node,
            x: placed.x, y: placed.y, width: placed.width, height: placed.height,
            labelLines: placed.labelLines, detailLines: placed.detailLines,
            color: (node.group && groupColor.get(node.group)) || NEUTRAL,
        };
    });
    const groups: PlacedGroup[] = spec.groups.flatMap((group) => {
        const placed = graph.node(`group:${group.id}`);
        return placed ? [{ ...group, x: placed.x, y: placed.y, width: placed.width, height: placed.height }] : [];
    });
    const edges: PlacedEdge[] = graph.edges().map((key) => {
        const placed = graph.edge(key);
        const edge = spec.edges[Number(key.name)];
        const middle = halfway(placed.points);
        return { ...edge, points: placed.points, labelX: middle.x, labelY: middle.y, labelWidth: edge.label ? textWidth(edge.label, EDGE_FONT) + 14 : 0 };
    });
    const { width = 400, height = 300 } = graph.graph();
    return { nodes, groups, edges, width, height };
}

function halfway(points: { x: number; y: number }[]) {
    const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
    let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i]) {
            const t = lengths[i] ? remaining / lengths[i] : 0;
            return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
        }
        remaining -= lengths[i];
    }
    return points[points.length - 1];
}

/** Smooth path through dagre's bend points. */
function edgePath(points: { x: number; y: number }[]) {
    if (points.length < 3) return `M${points[0].x},${points[0].y} L${points[points.length - 1].x},${points[points.length - 1].y}`;
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
        d += ` Q${points[i].x},${points[i].y} ${i === points.length - 2 ? `${points[i + 1].x},${points[i + 1].y}` : `${mid.x},${mid.y}`}`;
    }
    return d;
}

/** Lays out both reading directions and keeps the one that is largest in the board. */
function bestLayout(spec: DiagramSpec, boardAspect: number) {
    const candidates = [spec.direction, spec.direction === "LR" ? "TB" : "LR"] as const;
    let best: ReturnType<typeof layout> | null = null;
    let bestScale = 0;
    for (const direction of candidates) {
        const placed = layout(spec, direction);
        const scale = Math.min(boardAspect / placed.width, 1 / placed.height);
        // Prefer the planned direction unless the other one is clearly larger.
        if (!best || scale > bestScale * 1.12) {
            best = placed;
            bestScale = scale;
        }
    }
    return best!;
}

type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };

export function DiagramSvg({ spec, svgRef, boardAspect = 16 / 9, view = FIT }: {
    spec: DiagramSpec;
    svgRef?: React.Ref<SVGSVGElement>;
    boardAspect?: number;
    view?: View;
}) {
    const placed = useMemo(() => bestLayout(spec, boardAspect), [spec, boardAspect]);
    const pad = { side: 10, top: 26 };

    return (
        <svg
            ref={svgRef}
            className="diagramSvg"
            viewBox={`0 0 ${placed.width} ${placed.height}`}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={spec.title}
            fontFamily={FONT}
        >
            <defs>
                <pattern id="diagramDots" width="18" height="18" patternUnits="userSpaceOnUse">
                    <circle cx="1.5" cy="1.5" r="1.1" fill="#dfe3ea" />
                </pattern>
                <marker id="diagramArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#7b8496" />
                </marker>
                <filter id="diagramShadow" x="-10%" y="-10%" width="120%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#1d2433" floodOpacity="0.12" />
                </filter>
            </defs>
            <rect width={placed.width} height={placed.height} fill="#fbfbfd" />
            <rect width={placed.width} height={placed.height} fill="url(#diagramDots)" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>

            {placed.groups.map((group) => {
                const color = PALETTE[group.color] ?? NEUTRAL;
                const x = group.x - group.width / 2 - pad.side;
                const y = group.y - group.height / 2 - pad.top;
                return (
                    <g key={group.id}>
                        <rect x={x} y={y} width={group.width + pad.side * 2} height={group.height + pad.top + pad.side} rx={18}
                            fill={color.soft} fillOpacity={0.75} stroke={color.main} strokeOpacity={0.35} strokeDasharray="6 5" />
                        <text x={x + 14} y={y + 20} fill={color.main} fontSize={11.5} fontWeight={750} letterSpacing="0.06em">
                            {group.label.toUpperCase()}
                        </text>
                    </g>
                );
            })}

            {placed.edges.map((edge, index) => (
                <g key={index}>
                    <path d={edgePath(edge.points)} fill="none" stroke="#7b8496" strokeWidth={1.8}
                        strokeDasharray={edge.dashed ? "6 5" : undefined} markerEnd="url(#diagramArrow)" />
                    {edge.label && edge.labelX !== undefined && edge.labelY !== undefined && (
                        <g>
                            <rect x={edge.labelX - edge.labelWidth / 2} y={edge.labelY - 10} width={edge.labelWidth} height={20} rx={10}
                                fill="#ffffff" stroke="#d6dbe4" />
                            <text x={edge.labelX} y={edge.labelY + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill="#4a5263">
                                {edge.label}
                            </text>
                        </g>
                    )}
                </g>
            ))}

            {placed.nodes.map((node) => {
                const left = node.x - node.width / 2;
                const top = node.y - node.height / 2;
                const isKey = node.emphasis === "key";
                const isNote = node.emphasis === "note";
                const textX = left + (node.icon ? 54 : 18);
                const textBlock = node.labelLines.length * 18 + (node.detailLines.length ? 4 + node.detailLines.length * 15 : 0);
                const textTop = node.y - textBlock / 2;
                return (
                    <g key={node.id} filter="url(#diagramShadow)">
                        <rect x={left} y={top} width={node.width} height={node.height} rx={12}
                            fill={isNote ? "#fff8dd" : "#ffffff"}
                            stroke={isKey ? node.color.main : isNote ? "#e3bd4f" : "#d9dee8"}
                            strokeWidth={isKey ? 2.4 : 1.2}
                            strokeDasharray={isNote ? "5 4" : undefined} />
                        {!isNote && <rect x={left} y={top + 10} width={4} height={node.height - 20} rx={2} fill={node.color.main} />}
                        {node.icon && (
                            <g>
                                <circle cx={left + 30} cy={node.y} r={16} fill={isNote ? "#fdeeb8" : node.color.soft} />
                                <text x={left + 30} y={node.y + 6} textAnchor="middle" fontSize={17}>{node.icon}</text>
                            </g>
                        )}
                        {node.labelLines.map((line, index) => (
                            <text key={`l${index}`} x={textX} y={textTop + 14 + index * 18} fontSize={14} fontWeight={650} fill="#1f2633">{line}</text>
                        ))}
                        {node.detailLines.map((line, index) => (
                            <text key={`d${index}`} x={textX} y={textTop + node.labelLines.length * 18 + 16 + index * 15} fontSize={12} fill="#5b6475">{line}</text>
                        ))}
                        {isKey && (
                            <g>
                                <circle cx={left + node.width - 4} cy={top + 4} r={9} fill={node.color.main} />
                                <text x={left + node.width - 4} y={top + 8} textAnchor="middle" fontSize={11} fill="#fff">★</text>
                            </g>
                        )}
                    </g>
                );
            })}
            </g>
        </svg>
    );
}

export type DiagramState = {
    status: "drawing" | "ready" | "error" | "empty";
    artistName: string;
    artistColor: string;
    request: string;
    spec?: DiagramSpec;
    /** Identifies the sketch in the library, to highlight it there. */
    key?: string;
};

export type SketchEntry = { key: string; spec: DiagramSpec; artistName: string; artistColor: string };
export type SketchLibrary = {
    current: SketchEntry[];
    earlier: { id: string; title: string; sketches: SketchEntry[] }[];
};

async function downloadImage(svg: SVGSVGElement, title: string, format: "jpeg" | "png") {
    // Always export the whole sketch, not the zoomed view.
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.querySelector(":scope > g[transform]")?.removeAttribute("transform");
    const source = new XMLSerializer().serializeToString(copy);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    const box = svg.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = box.width * 2;
    canvas.height = box.height * 2;
    const context = canvas.getContext("2d")!;
    context.scale(2, 2);
    // JPEG has no transparency; start from the whiteboard colour.
    context.fillStyle = "#fbfbfd";
    context.fillRect(0, 0, box.width, box.height);
    context.drawImage(image, 0, 0, box.width, box.height);
    const link = document.createElement("a");
    const extension = format === "jpeg" ? "jpg" : "png";
    link.download = `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "sketch"}.${extension}`;
    link.href = canvas.toDataURL(`image/${format}`, 0.92);
    link.click();
}

function LibraryItem({ entry, active, onOpen }: { entry: SketchEntry; active: boolean; onOpen: (entry: SketchEntry) => void }) {
    return (
        <button
            type="button"
            className={`diagramLibraryItem${active ? " isActive" : ""}`}
            style={{ "--artist-color": entry.artistColor } as CSSProperties}
            onClick={() => onOpen(entry)}
            aria-current={active ? "true" : undefined}
        >
            <strong>{entry.spec.title}</strong>
            <small>{entry.artistName}</small>
        </button>
    );
}

/** The shared whiteboard: shows a sketch while it is drawn and when it is ready, plus all saved sketches. */
export default function DiagramPanel({ diagram, library, onOpen, onClose }: {
    diagram: DiagramState;
    library: SketchLibrary;
    onOpen: (entry: SketchEntry) => void;
    onClose: () => void;
}) {
    const sketchCount = library.current.length + library.earlier.reduce((sum, group) => sum + group.sketches.length, 0);
    const [showLibrary, setShowLibrary] = useState(() => sketchCount > 0 && window.innerWidth >= 1000);
    const svgRef = useRef<SVGSVGElement>(null);
    const boardRef = useRef<HTMLDivElement>(null);
    const [boardAspect, setBoardAspect] = useState(16 / 9);
    const [maximized, setMaximized] = useState(false);
    const [view, setView] = useState<View>(FIT);
    const drag = useRef<{ x: number; y: number; view: View } | null>(null);

    // A new sketch starts fitted to the board.
    useEffect(() => setView(FIT), [diagram.spec]);

    /** Zooms around a point given in board-relative fractions (0–1). */
    const zoomAt = (factor: number, fx = 0.5, fy = 0.5) => {
        const box = svgRef.current?.viewBox.baseVal;
        if (!box) return;
        setView((current) => {
            const zoom = Math.min(6, Math.max(1, current.zoom * factor));
            const px = fx * box.width;
            const py = fy * box.height;
            if (zoom === 1) return FIT;
            return { zoom, x: px - ((px - current.x) / current.zoom) * zoom, y: py - ((py - current.y) / current.zoom) * zoom };
        });
    };
    const style = { "--artist-color": diagram.artistColor } as CSSProperties;

    useEffect(() => {
        const board = boardRef.current;
        if (!board) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            // Round so tiny resizes do not lay the diagram out again.
            if (width && height) setBoardAspect(Math.round((width / height) * 4) / 4);
        });
        observer.observe(board);
        return () => observer.disconnect();
    }, []);

    return (
        <section className={`diagramPanel${maximized ? " isMaximized" : ""}`} style={style} aria-label={`${diagram.artistName}'s sketch`}>
            <header className="diagramHeader">
                <div>
                    <small><PencilLine size={13} aria-hidden="true" /> {diagram.artistName}'s sketch</small>
                    <h2>{diagram.spec?.title ?? (diagram.status === "error" ? "Could not draw this" : diagram.status === "empty" ? "Whiteboard" : "Sketching…")}</h2>
                    {diagram.spec?.subtitle && <p>{diagram.spec.subtitle}</p>}
                </div>
                <div className="diagramActions">
                    <button
                        type="button"
                        onClick={() => setShowLibrary((value) => !value)}
                        title="Earlier sketches"
                        aria-label="Show earlier sketches"
                        aria-pressed={showLibrary}
                        className={showLibrary ? "isOn" : undefined}
                    >
                        <List size={17} />
                    </button>
                    {diagram.spec && (["jpeg", "png"] as const).map((format) => (
                        <button
                            key={format}
                            type="button"
                            className="diagramDownload"
                            onClick={() => svgRef.current && void downloadImage(svgRef.current, diagram.spec!.title, format)}
                            title={`Download as ${format === "jpeg" ? "JPG" : "PNG"}`}
                        >
                            <Download size={15} aria-hidden="true" /> {format === "jpeg" ? "JPG" : "PNG"}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="diagramMaximize"
                        onClick={() => setMaximized((value) => !value)}
                        title={maximized ? "Smaller" : "Larger"}
                        aria-label={maximized ? "Make sketch smaller" : "Make sketch larger"}
                        aria-pressed={maximized}
                    >
                        {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                    <button type="button" onClick={onClose} title="Close" aria-label="Close sketch">
                        <X size={18} />
                    </button>
                </div>
            </header>
            <div className="diagramBody">
            {showLibrary && (
                <aside className="diagramLibrary" aria-label="Sketches">
                    <h3>This conversation</h3>
                    {library.current.length === 0 && <p>No sketches yet.</p>}
                    {library.current.slice().reverse().map((entry) => (
                        <LibraryItem key={entry.key} entry={entry} active={entry.key === diagram.key} onOpen={onOpen} />
                    ))}
                    {library.earlier.length > 0 && <h3>Earlier conversations</h3>}
                    {library.earlier.map((group) => (
                        <div key={group.id} className="diagramLibraryGroup">
                            <small>{group.title}</small>
                            {group.sketches.slice().reverse().map((entry) => (
                                <LibraryItem key={entry.key} entry={entry} active={entry.key === diagram.key} onOpen={onOpen} />
                            ))}
                        </div>
                    ))}
                </aside>
            )}
            <div
                className={`diagramBoard${view.zoom > 1 ? " isZoomed" : ""}`}
                ref={boardRef}
                onWheel={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
                }}
                onPointerDown={(event) => {
                    if (view.zoom === 1) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { x: event.clientX, y: event.clientY, view };
                }}
                onPointerMove={(event) => {
                    const start = drag.current;
                    const box = svgRef.current?.viewBox.baseVal;
                    if (!start || !box) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const unitsPerPixel = Math.max(box.width / rect.width, box.height / rect.height);
                    setView({ ...start.view, x: start.view.x + (event.clientX - start.x) * unitsPerPixel, y: start.view.y + (event.clientY - start.y) * unitsPerPixel });
                }}
                onPointerUp={() => { drag.current = null; }}
                onDoubleClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    zoomAt(2, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
                }}
            >
                {diagram.status === "drawing" && (
                    <div className="diagramDrawing" role="status">
                        <PencilLine size={30} className="diagramPencil" aria-hidden="true" />
                        <span>{diagram.artistName} is sketching</span>
                        <small>{diagram.request}</small>
                    </div>
                )}
                {diagram.status === "empty" && (
                    <div className="diagramDrawing" role="status">
                        <PencilLine size={30} aria-hidden="true" />
                        <span>No sketches yet</span>
                        <small>Ask Jenny, Jinx or Smyth to sketch something, for example an overview of a topic.</small>
                    </div>
                )}
                {diagram.status === "error" && (
                    <div className="diagramDrawing" role="status"><span>The sketch did not work this time. Ask again in a moment.</span></div>
                )}
                {diagram.spec && <DiagramSvg spec={diagram.spec} svgRef={svgRef} boardAspect={boardAspect} view={view} />}
                {diagram.spec && (
                    <div className="diagramZoom" aria-label="Zoom">
                        <button type="button" onClick={() => zoomAt(1.4)} aria-label="Zoom in" title="Zoom in">+</button>
                        <button type="button" onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out" title="Zoom out">−</button>
                        <button type="button" onClick={() => setView(FIT)} aria-label="Fit to board" title="Fit to board"><Scan size={15} /></button>
                    </div>
                )}
            </div>
            </div>
            {diagram.spec?.takeaway && (
                <footer className="diagramTakeaway"><strong>Key insight</strong> {diagram.spec.takeaway}</footer>
            )}
        </section>
    );
}
