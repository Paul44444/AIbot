// A diagram is planned by a language model as data and laid out and drawn by
// DiagramView, so every sketch gets a clean layout and a consistent style.

export const DIAGRAM_COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "red", "gray"] as const;
export type DiagramColor = (typeof DIAGRAM_COLORS)[number];

export type DiagramSpec = {
    title: string;
    subtitle: string | null;
    /** LR reads left to right, TB top to bottom. */
    direction: "LR" | "TB";
    groups: { id: string; label: string; color: DiagramColor }[];
    nodes: {
        id: string;
        label: string;
        detail: string | null;
        icon: string | null;
        group: string | null;
        emphasis: "normal" | "key" | "note";
    }[];
    edges: { from: string; to: string; label: string | null; dashed: boolean }[];
    takeaway: string | null;
};
