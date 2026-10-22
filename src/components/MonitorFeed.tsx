import { useEffect, useState, type CSSProperties } from "react";
import { CHARACTER_BY_ID, type CharacterId } from "../data/characters";
import { formatTime, type VideoSummary } from "../types/youtube";

// A character's YouTube feed shown on their PC screen in the 3D room. Picking a
// video opens it in the big viewer; anywhere else on the screen opens the viewer.

const feeds = new Map<CharacterId, Promise<{ topic: string; videos: VideoSummary[] }>>();
function loadFeed(id: CharacterId) {
    if (!feeds.has(id)) {
        const request = fetch(`/api/youtube?${new URLSearchParams({ action: "feed", character: id, lang: navigator.language.split("-")[0] })}`)
            .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))));
        request.catch(() => feeds.delete(id));
        feeds.set(id, request);
    }
    return feeds.get(id)!;
}

export default function MonitorFeed({ characterId, width, height, onOpenVideo, onOpenYouTube }: {
    characterId: CharacterId;
    width: number;
    height: number;
    onOpenVideo: (videoId: string) => void;
    onOpenYouTube: () => void;
}) {
    const character = CHARACTER_BY_ID[characterId];
    const [feed, setFeed] = useState<{ topic: string; videos: VideoSummary[] } | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadFeed(characterId)
            .then((data) => { if (!cancelled) setFeed(data); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [characterId]);

    return (
        <div
            className="monitorFeed"
            style={{ width, height, "--member-color": character.color } as CSSProperties}
            onClick={onOpenYouTube}
            role="button"
            tabIndex={0}
            aria-label={`Open ${character.name}'s YouTube`}
        >
            <header>
                <span className="monitorLogo" aria-hidden="true">▶</span>
                <strong>YouTube</strong>
                <span className="monitorTitle">{character.name}'s picks</span>
                {feed && <small>today: {feed.topic}</small>}
            </header>
            {failed && <p className="monitorMessage">Could not load the feed. Click to open YouTube.</p>}
            {!feed && !failed && <p className="monitorMessage">Loading…</p>}
            <div className="monitorGrid">
                {feed?.videos.slice(0, 6).map((video) => (
                    <button
                        type="button"
                        key={video.id}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenVideo(video.id);
                        }}
                    >
                        <span className="monitorThumb">
                            <img src={video.thumbnail} alt="" />
                            {video.duration > 0 && <span>{formatTime(video.duration)}</span>}
                        </span>
                        <span className="monitorVideoTitle">{video.title}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
