import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CheckCircle2, CircleDashed, Download, Play, Square, Trash2, TriangleAlert, XCircle, MessageSquarePlus } from "lucide-react";
import { CHARACTERS, CHARACTER_BY_ID, type CharacterId } from "../data/characters";
import { DATASET_CREDIT, datasetPatientInstructions, loadCaseIndex, loadDatasetCase, type DatasetCase } from "../data/patients";
import { startRealtimeVoiceSession } from "../utils/realtimeVoice";
import "./EvalPage.css";

// Validation of patient mode: the doctor's questions from a recorded interview are put to the
// AI patient one by one, exactly as in the app (same realtime model, same instructions), and a
// judge model compares each answer with what the real patient said.

type Verdict = "match" | "partial" | "contradiction" | "none";
type Turn = { question: string; reference: string; answer: string; facts?: Verdict; volunteered?: boolean; note?: string };
type CaseRun = {
    caseId: string;
    category: string;
    character: CharacterId;
    reason: string;
    diagnosis: string;
    turns: Turn[];
    summary?: string;
    error?: string;
    finishedAt?: string;
};

const RESULTS_KEY = "patientEvalResults";
const VERDICTS: { id: Verdict; label: string; color: string }[] = [
    { id: "match", label: "Same facts", color: "var(--good)" },
    { id: "partial", label: "Partly", color: "var(--warning)" },
    { id: "contradiction", label: "Contradicts", color: "var(--critical)" },
    { id: "none", label: "No facts", color: "var(--neutral)" },
];
const VERDICT_ICON = { match: CheckCircle2, partial: TriangleAlert, contradiction: XCircle, none: CircleDashed };

/** The doctor's turns, each with what the real patient answered. */
function questionPairs(transcript: string) {
    const pairs: { question: string; reference: string }[] = [];
    for (const line of transcript.split("\n")) {
        const speaker = line.slice(0, 2);
        const text = line.slice(2).trim();
        if (!text) continue;
        const last = pairs[pairs.length - 1];
        if (speaker === "D:") {
            // A doctor speaking twice in a row asked one question.
            if (last && !last.reference) last.question += ` ${text}`;
            else pairs.push({ question: text, reference: "" });
        } else if (speaker === "P:" && last) {
            last.reference = last.reference ? `${last.reference} ${text}` : text;
        }
    }
    return pairs.filter((pair) => pair.reference);
}

const spoken = (text: string) => text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
const words = (text: string) => spoken(text).split(" ").filter(Boolean).length;

/** Plays one recorded case with a realtime session in text, question by question. */
async function replay(patientCase: DatasetCase, character: CharacterId, limit: number, signal: AbortSignal, onAnswer: (turn: Turn) => void) {
    const pairs = questionPairs(patientCase.transcript).slice(0, limit);
    const session = await startRealtimeVoiceSession({ microphone: false, muteRemoteAudio: true, signal });
    const { dc } = session;
    let waiting: { resolve: (text: string) => void; reject: (error: Error) => void } | null = null;
    let configured: (() => void) | null = null;
    dc.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "session.updated") configured?.();
        if (message.type === "error") waiting?.reject(new Error(message.error?.message ?? "Realtime error"));
        if (message.type === "response.done") {
            const text = (message.response?.output ?? [])
                .flatMap((item: { content?: { type: string; text?: string; transcript?: string }[] }) => item.content ?? [])
                .map((part: { text?: string; transcript?: string }) => part.text ?? part.transcript ?? "")
                .join("");
            waiting?.resolve(text);
        }
    });
    const timeout = <T,>(promise: Promise<T>, what: string) => Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), 40_000)),
    ]);
    try {
        if (dc.readyState !== "open") await timeout(new Promise((resolve) => dc.addEventListener("open", resolve, { once: true })), "Connecting");
        const ready = new Promise<void>((resolve) => { configured = resolve; });
        dc.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["text"],
                instructions: datasetPatientInstructions(CHARACTER_BY_ID[character], patientCase),
                audio: { input: { turn_detection: null } },
                tools: [],
            },
        }));
        await timeout(ready, "Setting up the patient");
        for (const pair of pairs) {
            signal.throwIfAborted();
            const answer = new Promise<string>((resolve, reject) => { waiting = { resolve, reject }; });
            dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: pair.question }] } }));
            dc.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["text"] } }));
            onAnswer({ ...pair, answer: (await timeout(answer, "The answer")).trim() });
        }
    } finally {
        session.dispose();
    }
}

async function judge(turns: Turn[]) {
    const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "judge", turns: turns.map((turn) => ({ ...turn, answer: spoken(turn.answer) })) }),
    });
    if (!response.ok) throw new Error(`Judge ${response.status}`);
    return response.json() as Promise<{ turns: { facts: Verdict; volunteered: boolean; note: string }[]; summary: string }>;
}

function loadResults(): CaseRun[] {
    try {
        const saved = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? "[]");
        return Array.isArray(saved) ? saved : [];
    } catch {
        return [];
    }
}

type Stats = { counts: Record<Verdict, number>; judged: number; agreement: number | null; contradictions: number | null; volunteered: number | null; lengthRatio: number | null };

function stats(runs: CaseRun[]): Stats {
    const turns = runs.flatMap((run) => run.turns.filter((turn) => turn.facts));
    const counts = { match: 0, partial: 0, contradiction: 0, none: 0 } as Record<Verdict, number>;
    for (const turn of turns) counts[turn.facts!] += 1;
    const factual = counts.match + counts.partial + counts.contradiction;
    const ratios = turns.filter((turn) => words(turn.reference) > 0).map((turn) => words(turn.answer) / words(turn.reference)).sort((a, b) => a - b);
    return {
        counts,
        judged: turns.length,
        agreement: factual ? (counts.match + counts.partial * 0.5) / factual : null,
        contradictions: factual ? counts.contradiction / factual : null,
        volunteered: turns.length ? turns.filter((turn) => turn.volunteered).length / turns.length : null,
        lengthRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null,
    };
}

const percent = (value: number | null) => value === null ? "–" : `${Math.round(value * 100)}%`;

export default function EvalPage() {
    const [results, setResults] = useState<CaseRun[]>(loadResults);
    const [character, setCharacter] = useState<CharacterId | "auto">("auto");
    const [caseCount, setCaseCount] = useState(3);
    const [questionLimit, setQuestionLimit] = useState(15);
    const [caseId, setCaseId] = useState("");
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [openCase, setOpenCase] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        document.title = "Patient validation";
        const page = [document.documentElement, document.body];
        page.forEach((element) => element.classList.add("evalBody"));
        // index.html shows the 3D room's loading poster until the scene is ready; there is no scene here.
        document.querySelectorAll(".sceneAtmosphere, .sceneLoading").forEach((element) => element.remove());
        return () => page.forEach((element) => element.classList.remove("evalBody"));
    }, []);
    useEffect(() => {
        try {
            localStorage.setItem(RESULTS_KEY, JSON.stringify(results.slice(-40)));
        } catch {
            // Results then last only for this visit.
        }
    }, [results]);

    const overall = useMemo(() => stats(results), [results]);
    const finished = results.filter((run) => run.finishedAt);

    /** Changes the case that is running now. */
    const update = (change: (run: CaseRun) => CaseRun) =>
        setResults((runs) => runs.map((r) => r.finishedAt ? r : change(r)));

    const run = async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setError("");
        try {
            const index = await loadCaseIndex();
            const wanted = caseId.trim().toUpperCase();
            const pool = wanted
                ? index.filter((entry) => entry.id === wanted)
                : index.filter((entry) => character === "auto" || entry.fits.includes(character));
            if (!pool.length) throw new Error(wanted ? `No case ${wanted}` : "No cases for this character");
            const picks = wanted ? pool : [...pool].sort(() => Math.random() - 0.5).slice(0, caseCount);
            for (const [n, entry] of picks.entries()) {
                controller.signal.throwIfAborted();
                const who = character !== "auto" && entry.fits.includes(character) ? character : entry.fits[Math.floor(Math.random() * entry.fits.length)];
                const patientCase = await loadDatasetCase(entry.id);
                const total = Math.min(questionLimit, questionPairs(patientCase.transcript).length);
                setResults((runs) => [...runs.filter((r) => r.finishedAt), {
                    caseId: entry.id, category: entry.category, character: who, reason: entry.reason, diagnosis: patientCase.diagnosis, turns: [],
                }]);
                const label = `Case ${n + 1} of ${picks.length}: ${entry.id} with ${CHARACTER_BY_ID[who].name}`;
                const turns: Turn[] = [];
                try {
                    setProgress(`${label}, connecting`);
                    await replay(patientCase, who, questionLimit, controller.signal, (turn) => {
                        turns.push(turn);
                        update((r) => ({ ...r, turns: [...turns] }));
                        setProgress(`${label}, question ${turns.length} of ${total}`);
                    });
                    setProgress(`${label}, judging ${turns.length} answers`);
                    const verdict = await judge(turns);
                    const finishedAt = new Date().toISOString();
                    update((r) => ({
                        ...r,
                        turns: turns.map((turn, i) => ({ ...turn, ...verdict.turns[i] })),
                        summary: verdict.summary,
                        finishedAt,
                    }));
                    setOpenCase(entry.id + finishedAt);
                } catch (caseError) {
                    if (controller.signal.aborted) throw caseError;
                    const finishedAt = new Date().toISOString();
                    update((r) => ({ ...r, error: String((caseError as Error).message ?? caseError), finishedAt }));
                }
            }
            setProgress("");
        } catch (runError) {
            setResults((runs) => runs.filter((r) => r.finishedAt));
            if (!controller.signal.aborted) setError(String((runError as Error).message ?? runError));
            setProgress("");
        } finally {
            setRunning(false);
            abortRef.current = null;
        }
    };

    const download = () => {
        const blob = new Blob([JSON.stringify(finished, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `patient-validation-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const live = results.find((r) => !r.finishedAt);

    return (
        <main className="evalPage">
            <header className="evalHeader">
                <div>
                    <h1>Patient validation</h1>
                    <p>
                        The doctor's questions from a recorded practice interview go to the AI patient one by one, exactly as in the app.
                        A judge model then compares each answer with what the real patient said.
                    </p>
                    <p className="evalCaveat">
                        The AI patient has the recorded interview as its memory, so this measures how faithfully and how naturally it plays
                        the case, not whether it knows medicine.
                    </p>
                </div>
                <a className="evalBack" href="/">← Back to the practice</a>
            </header>

            <section className="evalControls" aria-label="Run a validation">
                <label>
                    Patient
                    <select value={character} onChange={(event) => setCharacter(event.target.value as CharacterId | "auto")} disabled={running}>
                        <option value="auto">Any who fits</option>
                        {CHARACTERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </label>
                <label>
                    Cases
                    <select value={caseCount} onChange={(event) => setCaseCount(Number(event.target.value))} disabled={running || Boolean(caseId.trim())}>
                        {[1, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <label>
                    Questions per case
                    <select value={questionLimit} onChange={(event) => setQuestionLimit(Number(event.target.value))} disabled={running}>
                        <option value={10}>10</option>
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                        <option value={999}>All</option>
                    </select>
                </label>
                <label>
                    Case (optional)
                    <input value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="e.g. RES0051" disabled={running} />
                </label>
                {running ? (
                    <button type="button" className="evalRun isStop" onClick={() => abortRef.current?.abort()}>
                        <Square size={16} aria-hidden="true" /> Stop
                    </button>
                ) : (
                    <button type="button" className="evalRun" onClick={() => void run()}>
                        <Play size={16} aria-hidden="true" /> Run validation
                    </button>
                )}
            </section>
            {(progress || error) && <p className={`evalProgress${error ? " isError" : ""}`} role="status">{error || progress}</p>}

            <section className="evalTiles" aria-label="Overall results">
                <Tile label="Same facts" value={percent(overall.agreement)} hint="Answers with the real patient's facts (partly = half)" />
                <Tile label="Contradictions" value={percent(overall.contradictions)} hint="Answers with a fact that differs from the recording" />
                <Tile label="Unasked details" value={percent(overall.volunteered)} hint="Answers that tell more than was asked" />
                <Tile label="Answer length" value={overall.lengthRatio === null ? "–" : `${overall.lengthRatio.toFixed(1)}×`} hint="Median words of the AI's answer per word of the real one" />
                <Tile label="Answers judged" value={String(overall.judged)} hint={`${finished.length} case${finished.length === 1 ? "" : "s"}`} />
            </section>

            {finished.length > 0 && (
                <section className="evalChart" aria-label="Answers per case">
                    <div className="evalChartHead">
                        <h2>Answers per case</h2>
                        <Legend />
                    </div>
                    <CaseBars runs={finished} onOpen={setOpenCase} />
                    <div className="evalActions">
                        <button type="button" onClick={download}><Download size={14} aria-hidden="true" /> Download results</button>
                        <button type="button" onClick={() => setResults((runs) => runs.filter((r) => !r.finishedAt))} disabled={running}>
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    </div>
                </section>
            )}

            <section className="evalCases" aria-label="Cases">
                {live && <CaseDetails run={live} open live onToggle={() => {}} />}
                {[...finished].reverse().map((r) => (
                    <CaseDetails
                        key={r.caseId + r.finishedAt}
                        run={r}
                        open={openCase === r.caseId + r.finishedAt}
                        onToggle={() => setOpenCase((current) => current === r.caseId + r.finishedAt ? null : r.caseId + r.finishedAt)}
                    />
                ))}
                {!results.length && !running && <p className="evalEmpty">No results yet. Choose how many cases and press “Run validation”.</p>}
            </section>
            <footer className="evalFooter">{DATASET_CREDIT}. Answers come from the same realtime model and instructions as the app; a judge model ({"gpt-5.4-mini"}) compares them.</footer>
        </main>
    );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="evalTile">
            <span className="evalTileLabel">{label}</span>
            <strong>{value}</strong>
            <span className="evalTileHint">{hint}</span>
        </div>
    );
}

function Legend() {
    return (
        <ul className="evalLegend">
            {VERDICTS.map((v) => <li key={v.id}><span style={{ background: v.color }} aria-hidden="true" />{v.label}</li>)}
        </ul>
    );
}

/** One stacked bar per case: how many answers match, partly match, contradict or hold no facts. */
function CaseBars({ runs, onOpen }: { runs: CaseRun[]; onOpen: (key: string) => void }) {
    const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
    const max = Math.max(1, ...runs.map((r) => r.turns.length));
    return (
        <div className="evalBars" onMouseLeave={() => setTip(null)}>
            {runs.map((r) => {
                const s = stats([r]);
                const key = r.caseId + r.finishedAt;
                return (
                    <button type="button" className="evalBarRow" key={key} onClick={() => onOpen(key)}>
                        <span className="evalBarLabel">
                            <strong>{r.caseId}</strong>
                            <small style={{ "--member-color": CHARACTER_BY_ID[r.character].color } as CSSProperties}>{CHARACTER_BY_ID[r.character].name}</small>
                        </span>
                        <span className="evalBarTrack">
                            {r.error ? <span className="evalBarError">{r.error}</span> : (
                                <span className="evalBarFill" style={{ width: `${(r.turns.length / max) * 100}%` }}>
                                    {VERDICTS.filter((v) => s.counts[v.id]).map((v) => (
                                        <span
                                            key={v.id}
                                            className="evalSegment"
                                            style={{ flexGrow: s.counts[v.id], background: v.color }}
                                            onMouseMove={(event) => setTip({ x: event.clientX, y: event.clientY, text: `${r.caseId} · ${v.label}: ${s.counts[v.id]} of ${r.turns.length} answers` })}
                                        />
                                    ))}
                                </span>
                            )}
                        </span>
                        <span className="evalBarValue">{r.error ? "–" : percent(s.agreement)}</span>
                    </button>
                );
            })}
            {tip && <div className="evalTip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
        </div>
    );
}

function CaseDetails({ run, open, live, onToggle }: { run: CaseRun; open: boolean; live?: boolean; onToggle: () => void }) {
    const s = stats([run]);
    return (
        <article className={`evalCase${open ? " isOpen" : ""}`}>
            <button type="button" className="evalCaseHead" onClick={onToggle} aria-expanded={open}>
                <span>
                    <strong>{run.caseId}</strong> · {run.category} · played by {CHARACTER_BY_ID[run.character].name}
                    <small>“{run.reason}”</small>
                </span>
                <span className="evalCaseScore">
                    {live ? `${run.turns.length} answers so far…` : run.error ? "Failed" : `${percent(s.agreement)} same facts`}
                </span>
            </button>
            {open && (
                <div className="evalCaseBody">
                    {run.summary && <p className="evalSummary">{run.summary}</p>}
                    {run.error && <p className="evalProgress isError">{run.error}</p>}
                    <p className="evalDiagnosis"><strong>Diagnosis of the case:</strong> {run.diagnosis}</p>
                    <div className="evalTurns" role="table" aria-label="Answers">
                        <div className="evalTurn isHead" role="row">
                            <span role="columnheader">Doctor asked</span>
                            <span role="columnheader">Real patient</span>
                            <span role="columnheader">AI patient</span>
                            <span role="columnheader">Verdict</span>
                        </div>
                        {run.turns.map((turn, i) => {
                            const verdict = VERDICTS.find((v) => v.id === turn.facts);
                            const Icon = turn.facts ? VERDICT_ICON[turn.facts] : null;
                            return (
                                <div className="evalTurn" role="row" key={i}>
                                    <span role="cell" data-label="Doctor asked">{turn.question}</span>
                                    <span role="cell" data-label="Real patient">{turn.reference}</span>
                                    <span role="cell" data-label="AI patient">{turn.answer}</span>
                                    <span role="cell" data-label="Verdict" className="evalVerdict">
                                        {verdict && Icon ? (
                                            <span className="evalChip" style={{ "--chip": verdict.color } as CSSProperties}>
                                                <Icon size={14} aria-hidden="true" />{verdict.label}
                                            </span>
                                        ) : <span className="evalPending">{live ? "waiting" : ""}</span>}
                                        {turn.volunteered && (
                                            <span className="evalChip isExtra"><MessageSquarePlus size={14} aria-hidden="true" />Unasked details</span>
                                        )}
                                        {turn.note && <small>{turn.note}</small>}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </article>
    );
}
