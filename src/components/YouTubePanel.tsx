import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, MicOff, Search, Sparkles, X } from "lucide-react";
import { formatTime, videoIdFromUrl, type VideoDetails, type VideoPlayback, type VideoSummary } from "../types/youtube";

// An in-app YouTube browser: search and trending via /api/youtube, playback with
// the official IFrame player (youtube.com itself refuses to be embedded).

type YTPlayer = {
    getCurrentTime: () => number;
    getPlayerState: () => number;
    pauseVideo: () => void;
    playVideo: () => void;
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
    setVolume: (volume: number) => void;
    loadVideoById: (id: string) => void;
    destroy: () => void;
};
type YTNamespace = {
    Player: new (element: HTMLElement, options: object) => YTPlayer;
    PlayerState: { PLAYING: number };
};

let iframeApi: Promise<YTNamespace> | null = null;
function loadIframeApi() {
    iframeApi ??= new Promise((resolve) => {
        const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
        if (w.YT?.Player) return resolve(w.YT);
        w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.append(script);
    });
    return iframeApi;
}

export type YouTubeHandle = {
    playback: () => VideoPlayback | null;
    pause: () => void;
};

type ApiError = "missing_key" | "quota" | "failed";

async function api<T>(params: Record<string, string>): Promise<T> {
    const response = await fetch(`/api/youtube?${new URLSearchParams(params)}`);
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error === "missing_key" || body.error === "quota" ? body.error : "failed");
    }
    return response.json() as Promise<T>;
}

const region = (navigator.language.split("-")[1] ?? "US").toUpperCase();
const language = navigator.language.split("-")[0];

function compactViews(views: number | null) {
    if (views === null) return "";
    return `${new Intl.NumberFormat(undefined, { notation: "compact" }).format(views)} views`;
}

function VideoCard({ video, compact = false, onOpen }: { video: VideoSummary; compact?: boolean; onOpen: (video: VideoSummary) => void }) {
    return (
        <button type="button" className={`ytCard${compact ? " isCompact" : ""}`} onClick={() => onOpen(video)}>
            <span className="ytThumb">
                <img src={video.thumbnail} alt="" loading="lazy" />
                {video.duration > 0 && <span className="ytDuration">{formatTime(video.duration)}</span>}
            </span>
            <span className="ytCardText">
                <strong>{video.title}</strong>
                <small>{video.channelTitle}</small>
                {video.views !== null && <small>{compactViews(video.views)}</small>}
            </span>
        </button>
    );
}

function errorText(error: ApiError) {
    if (error === "missing_key") return "Search needs a YouTube API key (YOUTUBE_API_KEY in Vercel). Until then, paste a YouTube link into the search bar.";
    if (error === "quota") return "Today's YouTube search quota is used up. Pasting a link still works.";
    return "YouTube did not answer. Please try again.";
}

export default function YouTubePanel({
    ref,
    duck,
    micPaused,
    onClose,
    onVideoChange,
    onPlayingChange,
}: {
    ref?: Ref<YouTubeHandle>;
    /** Lower the video while a character is speaking. */
    duck: boolean;
    micPaused: boolean;
    onClose: () => void;
    onVideoChange: (video: VideoDetails | null) => void;
    onPlayingChange: (playing: boolean) => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<{ title: string; videos: VideoSummary[]; nextPageToken?: string | null; q?: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [video, setVideo] = useState<VideoDetails | null>(null);
    const [related, setRelated] = useState<VideoSummary[]>([]);
    const [showDescription, setShowDescription] = useState(false);
    const [position, setPosition] = useState(0);
    const playerElement = useRef<HTMLDivElement>(null);
    const player = useRef<YTPlayer | null>(null);
    const callbacks = useRef({ onPlayingChange });
    callbacks.current = { onPlayingChange };

    useImperativeHandle(ref, () => ({
        playback: () => player.current && video
            ? { seconds: player.current.getCurrentTime(), playing: player.current.getPlayerState() === 1 }
            : null,
        pause: () => player.current?.pauseVideo(),
    }), [video]);

    const run = async (load: () => Promise<void>) => {
        setLoading(true);
        setError(null);
        try {
            await load();
        } catch (failure) {
            setError((failure as Error).message as ApiError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void run(async () => {
            const data = await api<{ videos: VideoSummary[] }>({ action: "trending", region });
            setResults({ title: "Trending", videos: data.videos });
        });
    }, []);

    const openVideo = (id: string) => void run(async () => {
        const details = await api<VideoDetails>({ action: "video", id });
        setVideo(details);
        setShowDescription(false);
        setRelated([]);
        onVideoChange(details);
        if (details.channelId) {
            api<{ videos: VideoSummary[] }>({ action: "channel", channelId: details.channelId, exclude: id })
                .then((data) => setRelated(data.videos))
                .catch(() => setRelated([]));
        }
    });

    const search = (text: string, pageToken?: string) => {
        const id = videoIdFromUrl(text);
        if (id) return openVideo(id);
        if (!text.trim()) return;
        void run(async () => {
            const params: Record<string, string> = { action: "search", q: text.trim(), lang: language };
            if (pageToken) params.pageToken = pageToken;
            const data = await api<{ videos: VideoSummary[]; nextPageToken: string | null }>(params);
            setResults((previous) => ({
                title: `Results for “${text.trim()}”`,
                q: text.trim(),
                videos: pageToken && previous ? [...previous.videos, ...data.videos] : data.videos,
                nextPageToken: data.nextPageToken,
            }));
            if (!pageToken) {
                setVideo(null);
                onVideoChange(null);
            }
        });
    };

    // One player for the panel's lifetime; later videos load into it.
    useEffect(() => {
        if (!video) return;
        if (player.current) {
            player.current.loadVideoById(video.id);
            return;
        }
        let cancelled = false;
        void loadIframeApi().then((YT) => {
            if (cancelled || !playerElement.current) return;
            // The player replaces its element with an iframe; give it one React does not own.
            const host = document.createElement("div");
            playerElement.current.append(host);
            player.current = new YT.Player(host, {
                videoId: video.id,
                playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
                events: {
                    onStateChange: (event: { data: number }) => callbacks.current.onPlayingChange(event.data === YT.PlayerState.PLAYING),
                },
            });
        });
        return () => { cancelled = true; };
    }, [video]);

    useEffect(() => () => {
        player.current?.destroy();
        player.current = null;
        callbacks.current.onPlayingChange(false);
    }, []);

    useEffect(() => {
        player.current?.setVolume(duck ? 20 : 100);
    }, [duck]);

    // The current chapter follows playback.
    useEffect(() => {
        if (!video?.chapters.length) return;
        const timer = window.setInterval(() => setPosition(player.current?.getCurrentTime() ?? 0), 1000);
        return () => window.clearInterval(timer);
    }, [video]);
    const currentChapter = video?.chapters.filter((chapter) => chapter.start <= position).at(-1);

    return (
        <section className={`ytPanel${video ? " isWatching" : ""}`} aria-label="YouTube">
            <header className="ytHeader">
                {video && (
                    <button type="button" className="ytIconButton" onClick={() => { setVideo(null); onVideoChange(null); player.current?.pauseVideo(); }} title="Back to results" aria-label="Back to results">
                        <ArrowLeft size={18} />
                    </button>
                )}
                <form
                    className="ytSearch"
                    onSubmit={(event) => {
                        event.preventDefault();
                        search(query);
                    }}
                >
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search YouTube or paste a link"
                        aria-label="Search YouTube or paste a link"
                    />
                    <button type="submit" aria-label="Search"><Search size={17} /></button>
                </form>
                <button type="button" className="ytIconButton" onClick={onClose} title="Close YouTube" aria-label="Close YouTube">
                    <X size={18} />
                </button>
            </header>

            {/* While watching, a missing key does not matter; only show it where search is used. */}
            {error && !(video && error === "missing_key") && <p className="ytError" role="status">{errorText(error)}</p>}

            <div className="ytBody">
                {/* The player element stays mounted so the iframe survives going back to results. */}
                <div className="ytWatch" hidden={!video}>
                    <div className="ytPlayerFrame"><div ref={playerElement} /></div>
                    {video && (
                        <div className="ytInfo">
                            <h2>{video.title}</h2>
                            <p className="ytMeta">
                                {video.channelTitle}
                                {video.views !== null && ` · ${compactViews(video.views)}`}
                                {currentChapter && <span className="ytNowChapter"> · Now: {currentChapter.title}</span>}
                            </p>
                            {micPaused && (
                                <p className="ytMicHint"><MicOff size={14} aria-hidden="true" /> The microphone pauses while the video plays. Press the mic button to pause the video and talk.</p>
                            )}
                            {video.chapters.length > 0 && (
                                <div className="ytChapters">
                                    {video.chapters.map((chapter) => (
                                        <button
                                            type="button"
                                            key={chapter.start}
                                            className={chapter === currentChapter ? "isCurrent" : undefined}
                                            onClick={() => { player.current?.seekTo(chapter.start, true); player.current?.playVideo(); }}
                                        >
                                            <span>{formatTime(chapter.start)}</span> {chapter.title}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {video.description && (
                                <div className="ytDescription">
                                    <p className={showDescription ? "isOpen" : undefined}>{video.description}</p>
                                    <button type="button" onClick={() => setShowDescription((open) => !open)}>
                                        {showDescription ? <>Less <ChevronUp size={14} /></> : <>More <ChevronDown size={14} /></>}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {video ? (
                    <aside className="ytSide">
                        {/* Without an API key (no channel id) there is no search to find similar videos. */}
                        {video.channelId && (
                            <button type="button" className="ytSimilar" onClick={() => search(video.title.split(/[|([\]–—-]/)[0])}>
                                <Sparkles size={15} aria-hidden="true" /> Similar videos
                            </button>
                        )}
                        {related.length > 0 && <h3>More from {video.channelTitle}</h3>}
                        {related.map((item) => <VideoCard key={item.id} video={item} compact onOpen={(v) => openVideo(v.id)} />)}
                    </aside>
                ) : (
                    <div className="ytResults">
                        {results && <h2>{results.title}</h2>}
                        <div className="ytGrid">
                            {results?.videos.map((item) => <VideoCard key={item.id} video={item} onOpen={(v) => openVideo(v.id)} />)}
                        </div>
                        {results?.nextPageToken && results.q && (
                            <button type="button" className="ytMore" onClick={() => search(results.q!, results.nextPageToken!)} disabled={loading}>
                                More results
                            </button>
                        )}
                        {loading && <p className="ytLoading">Loading…</p>}
                    </div>
                )}
            </div>
        </section>
    );
}
