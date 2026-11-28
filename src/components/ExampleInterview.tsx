import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpen, ChevronsDown, Pause, Play, Shuffle, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { DATASET_CREDIT } from "../data/patients";
import "./ExampleInterview.css";

// A recorded history-taking interview from the dataset (public/examples, built by a script),
// shown in full or played line by line, with each doctor question tagged by the part of the
// history it belongs to. For students who don't yet know what to ask.

type Section = "opening" | "complaint" | "associated" | "past" | "medication" | "family" | "social" | "sexual" | "concerns" | "closing" | "other";
type ExampleEntry = { id: string; category: string; reason: string; proxy: boolean; questions: number };
type Example = ExampleEntry & { diagnosis: string; keyPoints: string[]; turns: { s: "D" | "P"; t: string; sec?: Section }[] };

/** The parts of a history, in the order they are usually taken. */
const SECTIONS: { id: Section; label: string; hint: string; color: string }[] = [
    { id: "opening", label: "Opening", hint: "Greet, introduce yourself, ask an open question", color: "#6fd8c3" },
    { id: "complaint", label: "Current complaint", hint: "Onset, site, character, course, severity, triggers", color: "#5aa9ff" },
    { id: "associated", label: "Associated symptoms", hint: "Other symptoms, review of systems", color: "#8f8cff" },
    { id: "past", label: "Past medical history", hint: "Illnesses, operations, hospital stays", color: "#d58bff" },
    { id: "medication", label: "Medication & allergies", hint: "Tablets, supplements, allergies", color: "#ff8fb8" },
    { id: "family", label: "Family history", hint: "Illnesses in the family", color: "#ffa36b" },
    { id: "social", label: "Social history", hint: "Smoking, alcohol, drugs, work, home, travel", color: "#f2c94c" },
    { id: "sexual", label: "Sexual & reproductive", hint: "Periods, pregnancy, sexual health", color: "#b5d96a" },
    { id: "concerns", label: "Ideas & concerns", hint: "What they think, fear and expect", color: "#ff6b6b" },
    { id: "closing", label: "Closing", hint: "Summary, plan, questions, goodbye", color: "#9aa5b1" },
];
const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((section) => [section.id, section])) as Record<Section, (typeof SECTIONS)[number]>;
const PACE = { slow: 1.6, normal: 1, fast: 0.55 };

let exampleIndex: Promise<ExampleEntry[]> | null = null;
function loadIndex() {
    exampleIndex ??= fetch("/examples/index.json").then((response) => {
        if (!response.ok) throw new Error(`Examples ${response.status}`);
        return response.json();
    });
    exampleIndex.catch(() => { exampleIndex = null; });
    return exampleIndex;
}

/** One line read aloud: the doctor and the patient in different voices. Starts loading at once. */
function lineAudio(text: string, doctor: boolean) {
    const params = new URLSearchParams({ text, voice: doctor ? "cedar" : "marin", role: doctor ? "doctor" : "patient" });
    const audio = new Audio(`/api/voice?${params}`);
    audio.preload = "auto";
    return audio;
}

export default function ExampleInterview({ avoidId, onClose }: { avoidId?: string; onClose: () => void }) {
    const [entries, setEntries] = useState<ExampleEntry[]>([]);
    const [category, setCategory] = useState("all");
    const [example, setExample] = useState<Example | null>(null);
    const [error, setError] = useState("");
    // How many lines are visible; all of them unless it is playing.
    const [shown, setShown] = useState(Infinity);
    const [playing, setPlaying] = useState(false);
    const [pace, setPace] = useState<keyof typeof PACE>("normal");
    const [readAloud, setReadAloud] = useState(false);
    const [solution, setSolution] = useState(false);
    const listRef = useRef<HTMLOListElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const preloadRef = useRef<{ index: number; audio: HTMLAudioElement } | null>(null);

    const open = async (id: string) => {
        setError("");
        try {
            const response = await fetch(`/examples/${encodeURIComponent(id)}.json`);
            if (!response.ok) throw new Error(`Example ${id} ${response.status}`);
            setExample(await response.json());
            setShown(Infinity);
            setPlaying(false);
            setSolution(false);
            listRef.current?.scrollTo({ top: 0 });
        } catch (loadError) {
            setError(String((loadError as Error).message ?? loadError));
        }
    };

    const another = (list = entries, filter = category) => {
        // A patient answering for themselves, and not the case the student is practising.
        const pool = list.filter((entry) => !entry.proxy && entry.id !== avoidId && entry.id !== example?.id && (filter === "all" || entry.category === filter));
        if (pool.length) void open(pool[Math.floor(Math.random() * pool.length)].id);
    };

    useEffect(() => {
        loadIndex().then((list) => {
            setEntries(list);
            another(list);
        }).catch((loadError) => setError(String(loadError.message ?? loadError)));
        // Opens one example on mount only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [onClose]);

    const turns = useMemo(() => example?.turns ?? [], [example]);
    const visible = Math.min(shown, turns.length);
    const done = visible >= turns.length;

    // Playing: the newest line stays for a reading pause, or until it has been read aloud; then the next one appears.
    useEffect(() => {
        if (!playing) return;
        const line = turns[visible - 1];
        if (!line) return;
        let cancelled = false;
        let timer = 0;
        const next = () => {
            if (cancelled) return;
            if (done) setPlaying(false);
            else setShown(visible + 1);
        };
        if (readAloud) {
            // The line was usually loaded while the one before it played.
            const preloaded = preloadRef.current;
            const audio = preloaded?.index === visible - 1 ? preloaded.audio : lineAudio(line.t, line.s === "D");
            audioRef.current = audio;
            const following = turns[visible];
            preloadRef.current = following ? { index: visible, audio: lineAudio(following.t, following.s === "D") } : null;
            audio.onended = () => { timer = window.setTimeout(next, 250); };
            audio.onerror = () => { timer = window.setTimeout(next, 1200); };
            audio.play().catch(() => { timer = window.setTimeout(next, 1200); });
        } else {
            const words = line.t.split(" ").length;
            timer = window.setTimeout(next, (500 + words * 160) * PACE[pace]);
        }
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            audioRef.current?.pause();
        };
    }, [playing, visible, done, turns, pace, readAloud]);

    // Keeps the newest line in view while playing.
    useEffect(() => {
        if (shown === Infinity) return;
        const list = listRef.current;
        list?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [shown]);

    useEffect(() => () => audioRef.current?.pause(), []);

    const play = () => {
        if (done) setShown(1);
        else if (shown === Infinity) setShown(1);
        setPlaying(true);
    };
    const step = () => {
        setPlaying(false);
        setShown((count) => Math.min(turns.length, (count === Infinity ? 0 : count) + 1));
    };
    const showAll = () => {
        setPlaying(false);
        setShown(Infinity);
    };

    // Questions per part of the history, and the part the doctor is in now.
    const counts = useMemo(() => {
        const result = {} as Record<Section, number>;
        for (const turn of turns) if (turn.s === "D" && turn.sec) result[turn.sec] = (result[turn.sec] ?? 0) + 1;
        return result;
    }, [turns]);
    const current = useMemo(() => {
        for (let i = visible - 1; i >= 0; i--) if (turns[i]?.s === "D") return turns[i].sec;
        return undefined;
    }, [turns, visible]);
    const jumpTo = (section: Section) => {
        const index = turns.findIndex((turn) => turn.s === "D" && turn.sec === section);
        if (index < 0) return;
        if (index >= visible) showAll();
        requestAnimationFrame(() => listRef.current?.children[index]?.scrollIntoView({ behavior: "smooth", block: "center" }));
    };

    const categories = [...new Set(entries.map((entry) => entry.category))].sort();

    return (
        <div className="exampleBackdrop" role="dialog" aria-modal="true" aria-label="Example interview" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="examplePanel">
                <header className="exampleHeader">
                    <div>
                        <small><BookOpen size={13} aria-hidden="true" /> Example interview · how a doctor takes a history</small>
                        {example && <h2>{example.id} · {example.category} <span>“{example.reason}”</span></h2>}
                    </div>
                    <div className="examplePick">
                        <select value={category} onChange={(event) => { setCategory(event.target.value); another(entries, event.target.value); }} aria-label="Topic">
                            <option value="all">All topics</option>
                            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                        <button type="button" onClick={() => another()}><Shuffle size={14} aria-hidden="true" /> Another example</button>
                        <button type="button" className="exampleClose" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
                    </div>
                </header>

                <div className="exampleBody">
                    <aside className="exampleGuide" aria-label="Parts of a history">
                        <strong>The parts of a history</strong>
                        <ol>
                            {SECTIONS.map((section) => (
                                <li key={section.id}>
                                    <button
                                        type="button"
                                        className={`${current === section.id ? "isCurrent" : ""}${counts[section.id] ? "" : " isEmpty"}`}
                                        style={{ "--section": section.color } as CSSProperties}
                                        onClick={() => jumpTo(section.id)}
                                        disabled={!counts[section.id]}
                                    >
                                        <span className="exampleGuideLabel">{section.label}<em>{counts[section.id] ?? 0}</em></span>
                                        <small>{section.hint}</small>
                                    </button>
                                </li>
                            ))}
                        </ol>
                        <p>The number is how many questions the doctor asks in each part. Click a part to jump there.</p>
                    </aside>

                    <div className="exampleMain">
                        {error && <p className="exampleError">{error}</p>}
                        <ol className="exampleTurns" ref={listRef}>
                            {turns.slice(0, visible).map((turn, i) => {
                                const section = turn.sec ? SECTION_BY_ID[turn.sec] : undefined;
                                return (
                                    <li key={i} className={turn.s === "D" ? "isDoctor" : "isPatient"} style={{ "--section": section?.color ?? "#9aa5b1" } as CSSProperties}>
                                        <span className="exampleWho">
                                            {turn.s === "D" ? "Doctor" : "Patient"}
                                            {turn.s === "D" && section && <span className="exampleTag">{section.label}</span>}
                                        </span>
                                        <p>{turn.t}</p>
                                    </li>
                                );
                            })}
                        </ol>
                        {done && example && (
                            <div className="exampleSolution">
                                <button type="button" onClick={() => setSolution((open) => !open)} aria-expanded={solution}>
                                    {solution ? "Hide" : "Show"} what the history points to
                                </button>
                                {solution && (
                                    <>
                                        <p><strong>Likely diagnosis:</strong> {example.diagnosis}</p>
                                        <ul>{example.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <footer className="exampleControls">
                    {playing ? (
                        <button type="button" className="examplePrimary" onClick={() => setPlaying(false)}><Pause size={16} aria-hidden="true" /> Pause</button>
                    ) : (
                        <button type="button" className="examplePrimary" onClick={play} disabled={!turns.length}>
                            <Play size={16} aria-hidden="true" /> {shown === Infinity || done ? "Play from the start" : "Continue"}
                        </button>
                    )}
                    <button type="button" onClick={step} disabled={done}><SkipForward size={15} aria-hidden="true" /> Next line</button>
                    <button type="button" onClick={showAll} disabled={shown === Infinity}><ChevronsDown size={15} aria-hidden="true" /> Show all</button>
                    <label className="examplePace">
                        Pace
                        <select value={pace} onChange={(event) => setPace(event.target.value as keyof typeof PACE)} disabled={readAloud}>
                            <option value="slow">Slow</option>
                            <option value="normal">Normal</option>
                            <option value="fast">Fast</option>
                        </select>
                    </label>
                    <button type="button" onClick={() => setReadAloud((on) => !on)} aria-pressed={readAloud} className={readAloud ? "isOn" : ""}>
                        {readAloud ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />} Read aloud
                    </button>
                    <span className="exampleProgress">{Math.min(visible, turns.length)} / {turns.length} lines</span>
                    <small className="exampleCredit">Recorded practice interview with medical students and residents. {DATASET_CREDIT.replace("Case from", "From")}.</small>
                </footer>
            </section>
        </div>
    );
}
