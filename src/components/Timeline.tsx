import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { CHARACTER_BY_ID, type CharacterId } from "../data/characters";
import type { Forecast } from "../utils/groupConversation";

// A vertical time axis beside the conversation: a dot when the user asked something,
// a bar for how long the answer took (dashed ahead of it: the forecast the character
// announced). Hovering shows the question, clicking jumps to it.

export type TimelineEntry = {
    id: string;
    /** The user's message in the transcript, to jump to. */
    messageId: string;
    text: string;
    /** When the user asked. */
    at: number;
    /** When the first words of the answer appeared. */
    firstAt?: number;
    /** When the answer was complete. */
    doneAt?: number;
    character?: CharacterId;
    estimate?: Forecast;
};

/** The axis shows at least this much time, so the first answers don't fill it. */
const MIN_SPAN = 2 * 60_000;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120].map((minutes) => minutes * 60_000);
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function seconds(ms: number) {
    const total = Math.round(ms / 1000);
    return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}

export default function Timeline({ entries, expanded, onNavigate }: {
    entries: TimelineEntry[];
    expanded: boolean;
    onNavigate: (messageId: string) => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    const waiting = entries.some((entry) => !entry.doneAt);
    useEffect(() => {
        // Every second while an answer is on its way, otherwise often enough for the axis to keep up.
        const timer = window.setInterval(() => setNow(Date.now()), waiting ? 1000 : 15_000);
        return () => window.clearInterval(timer);
    }, [waiting]);

    if (!entries.length) return null;
    const start = entries[0].at;
    const end = Math.max(now, start + MIN_SPAN, ...entries.map((entry) => entry.at + (entry.estimate?.seconds ?? 0) * 1000));
    const span = end - start;
    const y = (time: number) => `${((time - start) / span) * 100}%`;
    const length = (from: number, to: number) => `${(Math.max(0, to - from) / span) * 100}%`;

    const step = TICK_STEPS.find((candidate) => span / candidate <= 6) ?? TICK_STEPS.at(-1)!;
    const ticks: number[] = [];
    for (let tick = Math.ceil(start / step) * step; tick < end; tick += step) ticks.push(tick);

    return (
        <nav className={`timeline${expanded ? " isExpanded" : ""}`} aria-label="Timeline of your requests">
            {/* Positions are percentages of this track, inset so the first and last dots stay inside. */}
            <div className="tlTrack">
            <div className="tlAxis" />
            {ticks.map((tick) => (
                <span key={tick} className="tlTick" style={{ top: y(tick) }}>{clock.format(tick)}</span>
            ))}
            <span className="tlNow" style={{ top: y(now) }} />
            {entries.map((entry) => {
                const done = entry.doneAt ?? now;
                const color = entry.character ? CHARACTER_BY_ID[entry.character].color : "#c9d3ff";
                const took = done - entry.at;
                const forecast = entry.estimate ? entry.estimate.seconds * 1000 : null;
                // The entry spans its bar and forecast; both are drawn as shares of that span.
                const reach = Math.max(took, forecast ?? 0, 1);
                return (
                    <button
                        key={entry.id}
                        type="button"
                        className="tlEntry"
                        data-open={!entry.doneAt}
                        style={{ top: y(entry.at), height: length(entry.at, entry.at + reach), "--entry-color": color } as CSSProperties}
                        onClick={() => onNavigate(entry.messageId)}
                        aria-label={`${clock.format(entry.at)}: ${entry.text}`}
                    >
                        {forecast !== null && <span className="tlForecast" style={{ height: `${(forecast / reach) * 100}%` }} />}
                        <span className="tlBar" style={{ height: `${(took / reach) * 100}%` }}>
                            {entry.firstAt && entry.doneAt && (
                                // Lighter once the answer started: the rest is reading time, not waiting.
                                <span className="tlStreaming" style={{ top: `${((entry.firstAt - entry.at) / Math.max(1, took)) * 100}%` }} />
                            )}
                        </span>
                        <span className="tlDot" />
                        {!entry.doneAt && <span className="tlLive">{seconds(took)}</span>}
                        <span className="tlTip" role="tooltip">
                            <small>
                                {clock.format(entry.at)}
                                {entry.character && ` · ${CHARACTER_BY_ID[entry.character].name}`}
                                {` · ${entry.doneAt ? seconds(took) : `${seconds(took)} so far`}`}
                                {forecast !== null && ` (forecast ${seconds(forecast)}${entry.estimate!.plan ? `: ${entry.estimate!.plan}` : ""})`}
                            </small>
                            <span>{entry.text.length > 110 ? `${entry.text.slice(0, 110)}…` : entry.text}</span>
                        </span>
                    </button>
                );
            })}
            </div>
        </nav>
    );
}
