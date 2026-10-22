// Shapes returned by /api/youtube.

export type VideoSummary = {
    id: string;
    title: string;
    channelId: string;
    channelTitle: string;
    thumbnail: string;
    /** Seconds; 0 when unknown. */
    duration: number;
    views: number | null;
    publishedAt: string;
};

export type VideoDetails = VideoSummary & {
    description: string;
    chapters: { start: number; title: string }[];
};

export type VideoPlayback = { seconds: number; playing: boolean };

export function formatTime(totalSeconds: number) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Video id from a YouTube link (watch, youtu.be, shorts, embed), or null. */
export function videoIdFromUrl(text: string) {
    const match = text.trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return match?.[1] ?? null;
}
