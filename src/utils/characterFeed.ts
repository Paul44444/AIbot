import type { CharacterId } from "../data/characters";
import type { VideoSummary } from "../types/youtube";

export type FeedVideo = VideoSummary & { description?: string };
export type CharacterFeed = { topic: string; videos: FeedVideo[] };

// A character's YouTube feed: shown on their PC and told to them as what they
// watched lately. One request per character, shared by both.
const feeds = new Map<CharacterId, Promise<CharacterFeed>>();

export function loadFeed(id: CharacterId) {
    if (!feeds.has(id)) {
        const request = fetch(`/api/youtube?${new URLSearchParams({ action: "feed", character: id, lang: navigator.language.split("-")[0] })}`)
            .then((response) => response.ok ? response.json() as Promise<CharacterFeed> : Promise.reject(new Error(String(response.status))));
        request.catch(() => feeds.delete(id));
        feeds.set(id, request);
    }
    return feeds.get(id)!;
}

function ago(publishedAt: string) {
    const days = Math.floor((Date.now() - Date.parse(publishedAt)) / 86_400_000);
    if (!Number.isFinite(days)) return "";
    return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
}

/** The feed as a system line for the character's session. */
export function describeFeed(feed: CharacterFeed) {
    const videos = feed.videos.slice(0, 6).map((video) => {
        const views = video.views ? `, ${video.views.toLocaleString("en")} views` : "";
        const about = video.description ? `: ${video.description}` : "";
        return `- "${video.title}" by ${video.channelTitle}, uploaded ${ago(video.publishedAt)}${views}${about}`;
    });
    return `[Your YouTube] Real videos you watched lately (today you were into "${feed.topic}"):
${videos.join("\n")}
Bring them up like someone who watched them when it fits, naming title or channel. You only know what is written here
plus your general knowledge; keep details to that, and if asked for more, stay vague in your own style.`;
}
