import type { VercelRequest, VercelResponse } from "@vercel/node";

// Thin wrapper around the YouTube Data API v3 for the in-app viewer.
// Quota per call: search 100 units, everything else 1 unit (10,000 per day free),
// so responses are cached at the edge and "more from this channel" avoids search.

const API = "https://www.googleapis.com/youtube/v3";

type ApiVideo = {
    id: string;
    snippet: {
        title: string;
        description: string;
        channelId: string;
        channelTitle: string;
        publishedAt: string;
        thumbnails: Record<string, { url: string; width?: number; height?: number }>;
    };
    contentDetails?: { duration: string };
    statistics?: { viewCount?: string };
};

export type VideoSummary = {
    id: string;
    title: string;
    channelId: string;
    channelTitle: string;
    thumbnail: string;
    duration: number;
    views: number | null;
    publishedAt: string;
};

class QuotaError extends Error {}

// Each character's feed: one topic per day, rotating, so a feed costs a single
// search per character and language per day (cached at the edge for everyone).
const FEEDS: Record<string, string[]> = {
    jenny: ["flower garden tour", "cozy cooking recipe", "relaxing nature walk", "houseplant care tips", "acoustic cover songs", "baking for beginners"],
    jinx: ["skateboard tricks", "funny life hacks", "gaming highlights", "street food challenge", "parkour", "magic tricks revealed"],
    smyth: ["science explained", "how the universe works", "biology explained", "physics explained", "history of science", "how the brain works"],
};

function seconds(isoDuration = "") {
    const match = isoDuration.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const [, days, hours, minutes, secs] = match.map((part) => Number(part ?? 0));
    return days * 86400 + hours * 3600 + minutes * 60 + secs;
}

/** "0:00 Intro" lines in the description, as YouTube itself uses them for chapters. */
function chapters(description: string) {
    const found: { start: number; title: string }[] = [];
    for (const line of description.split("\n")) {
        const match = line.match(/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:|]?\s*(.+?)\s*$/);
        if (!match) continue;
        const [, h, m, s, title] = match;
        found.push({ start: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s), title });
    }
    return found.length >= 3 && found[0].start === 0 ? found : [];
}

function summary(video: ApiVideo): VideoSummary {
    const thumbs = video.snippet.thumbnails;
    return {
        id: video.id,
        title: video.snippet.title,
        channelId: video.snippet.channelId,
        channelTitle: video.snippet.channelTitle,
        thumbnail: (thumbs.medium ?? thumbs.high ?? thumbs.default)?.url ?? `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
        duration: seconds(video.contentDetails?.duration),
        views: video.statistics?.viewCount ? Number(video.statistics.viewCount) : null,
        publishedAt: video.snippet.publishedAt,
    };
}

async function youtube<T>(path: string, params: Record<string, string>) {
    const url = new URL(`${API}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("key", process.env.YOUTUBE_API_KEY!);
    const response = await fetch(url);
    const data = await response.json() as T & { error?: { message?: string; errors?: { reason?: string }[] } };
    if (!response.ok) {
        const reason = data.error?.errors?.[0]?.reason ?? "";
        if (response.status === 403 && /quota/i.test(reason)) throw new QuotaError(reason);
        throw new Error(data.error?.message ?? `YouTube API ${response.status}`);
    }
    return data;
}

async function details(ids: string[]) {
    if (!ids.length) return [];
    const data = await youtube<{ items: ApiVideo[] }>("videos", {
        part: "snippet,contentDetails,statistics",
        id: ids.join(","),
        maxResults: "50",
    });
    // Keep the order of the ids (search relevance).
    const byId = new Map(data.items.map((item) => [item.id, item]));
    return ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
}

/** Without an API key, a single video still works through oEmbed. */
async function oembedVideo(id: string) {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (!response.ok) throw new Error("Video not found");
    const data = await response.json() as { title: string; author_name: string };
    return {
        id,
        title: data.title,
        channelId: "",
        channelTitle: data.author_name,
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        duration: 0,
        views: null,
        publishedAt: "",
        description: "",
        chapters: [],
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const query = req.query as Record<string, string | undefined>;
    const action = query.action;
    const hasKey = Boolean(process.env.YOUTUBE_API_KEY);

    try {
        if (action === "video" && query.id) {
            res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
            if (!hasKey) return res.status(200).json(await oembedVideo(query.id));
            const [video] = await details([query.id]);
            if (!video) return res.status(404).json({ error: "not_found" });
            return res.status(200).json({ ...summary(video), description: video.snippet.description, chapters: chapters(video.snippet.description) });
        }

        if (!hasKey) return res.status(503).json({ error: "missing_key" });

        if (action === "trending") {
            res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
            const region = /^[A-Z]{2}$/.test(query.region ?? "") ? query.region! : "US";
            const data = await youtube<{ items: ApiVideo[] }>("videos", {
                part: "snippet,contentDetails,statistics",
                chart: "mostPopular",
                regionCode: region,
                maxResults: "24",
            });
            return res.status(200).json({ videos: data.items.map(summary) });
        }

        if (action === "search" && query.q?.trim()) {
            res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
            const params: Record<string, string> = { part: "id", type: "video", q: query.q.slice(0, 200), maxResults: "24", safeSearch: "moderate" };
            if (query.pageToken) params.pageToken = query.pageToken;
            if (/^[a-z]{2}$/.test(query.lang ?? "")) params.relevanceLanguage = query.lang!;
            const found = await youtube<{ items: { id: { videoId: string } }[]; nextPageToken?: string }>("search", params);
            const videos = await details(found.items.map((item) => item.id.videoId).filter(Boolean));
            return res.status(200).json({ videos: videos.map(summary), nextPageToken: found.nextPageToken ?? null });
        }

        if (action === "feed" && query.character && FEEDS[query.character]) {
            res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
            const topics = FEEDS[query.character];
            const topic = topics[Math.floor(Date.now() / 86_400_000) % topics.length];
            const params: Record<string, string> = {
                part: "id",
                type: "video",
                q: topic,
                maxResults: "12",
                safeSearch: "strict",
                // Skip shorts; 4–20 minute videos suit watching together.
                videoDuration: "medium",
            };
            if (/^[a-z]{2}$/.test(query.lang ?? "")) params.relevanceLanguage = query.lang!;
            const found = await youtube<{ items: { id: { videoId: string } }[] }>("search", params);
            const videos = await details(found.items.map((item) => item.id.videoId).filter(Boolean));
            return res.status(200).json({ topic, videos: videos.map(summary) });
        }

        if (action === "channel" && query.channelId) {
            res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
            const channel = await youtube<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>("channels", {
                part: "contentDetails",
                id: query.channelId,
            });
            const uploads = channel.items[0]?.contentDetails.relatedPlaylists.uploads;
            if (!uploads) return res.status(200).json({ videos: [] });
            const items = await youtube<{ items: { contentDetails: { videoId: string } }[] }>("playlistItems", {
                part: "contentDetails",
                playlistId: uploads,
                maxResults: "13",
            });
            const videos = await details(items.items.map((item) => item.contentDetails.videoId).filter((id) => id !== query.exclude));
            return res.status(200).json({ videos: videos.slice(0, 12).map(summary) });
        }

        return res.status(400).json({ error: "bad_request" });
    } catch (error) {
        if (error instanceof QuotaError) return res.status(429).json({ error: "quota" });
        console.error("YouTube API failed:", error);
        return res.status(502).json({ error: "youtube_failed" });
    }
}
