import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, MapPin, Plus, Repeat as RepeatIcon, Trash2, X } from "lucide-react";
import {
    CALENDARS, CALENDAR_COLOR, DAY, addDays, dateKey, deleteEvent, getEvents, newEventId, occurrences,
    parseLocal, saveEvent, startOfDay, subscribe, toLocal,
} from "../utils/calendar";
import type { CalendarEvent, CalendarId, Occurrence, Repeat } from "../utils/calendar";

// A calendar in the style of Apple Calendar and Outlook: month, week and day
// views; drag in the week or day view to create an appointment, drag one to
// move it, drag its lower edge to change its length.

type View = "day" | "week" | "month";

const LOCALE = navigator.language || "en-GB";
const GERMAN = LOCALE.toLowerCase().startsWith("de");
const WEEK_START = /^en-(US|CA)$|^ja|^pt-BR$/i.test(LOCALE) ? 0 : 1;
const HOUR = 48;
const SNAP = 15;
const VIEW_KEY = "calendarView";

const TEXT = GERMAN ? {
    calendar: "Kalender", today: "Heute", day: "Tag", week: "Woche", month: "Monat", newEvent: "Neuer Termin",
    editEvent: "Termin bearbeiten", title: "Titel", allDay: "Ganztägig", starts: "Beginn", ends: "Ende",
    repeat: "Wiederholen", calendarLabel: "Kalender", location: "Ort", notes: "Notizen", delete: "Löschen",
    cancel: "Abbrechen", save: "Speichern", more: (count: number) => `+${count} weitere`, upcoming: "Demnächst",
    nothingUpcoming: "Keine Termine in den nächsten 7 Tagen.", close: "Kalender schließen", untitled: "Ohne Titel",
    previous: "Zurück", next: "Weiter", allDayRow: "ganztägig", series: "Änderungen gelten für die ganze Serie.",
    repeats: { none: "Nie", daily: "Täglich", weekly: "Wöchentlich", monthly: "Monatlich", yearly: "Jährlich" } as Record<Repeat, string>,
    calendars: { personal: "Privat", work: "Arbeit", family: "Familie", important: "Wichtig", other: "Sonstiges" } as Record<CalendarId, string>,
} : {
    calendar: "Calendar", today: "Today", day: "Day", week: "Week", month: "Month", newEvent: "New event",
    editEvent: "Edit event", title: "Title", allDay: "All day", starts: "Starts", ends: "Ends",
    repeat: "Repeat", calendarLabel: "Calendar", location: "Location", notes: "Notes", delete: "Delete",
    cancel: "Cancel", save: "Save", more: (count: number) => `+${count} more`, upcoming: "Upcoming",
    nothingUpcoming: "Nothing in the next 7 days.", close: "Close calendar", untitled: "Untitled",
    previous: "Previous", next: "Next", allDayRow: "all-day", series: "Changes apply to the whole series.",
    repeats: { none: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" } as Record<Repeat, string>,
    calendars: { personal: "Personal", work: "Work", family: "Family", important: "Important", other: "Other" } as Record<CalendarId, string>,
};

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const weekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });
const monthTitle = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const rangeTitle = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const upcomingDay = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });

function startOfWeek(date: Date) {
    const day = startOfDay(date);
    return addDays(day, -((day.getDay() - WEEK_START + 7) % 7));
}

/** The 42 days shown for a month, starting on the first day of the week. */
function monthGrid(date: Date) {
    const first = startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

function visibleDays(view: View, cursor: Date) {
    if (view === "day") return [startOfDay(cursor)];
    if (view === "week") return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
    return monthGrid(cursor);
}

function step(view: View, cursor: Date, direction: number) {
    if (view === "day") return addDays(cursor, direction);
    if (view === "week") return addDays(cursor, direction * 7);
    return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

const sameDay = (a: Date, b: Date) => dateKey(a) === dateKey(b);
const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);
const addMinutes = (value: string, minutes: number) => toLocal(new Date(parseLocal(value).getTime() + minutes * 60_000));
/** Shown in the all-day row: all-day events and anything a day or longer. */
const spansDays = (occurrence: Occurrence) => occurrence.event.allDay || occurrence.end.getTime() - occurrence.start.getTime() >= DAY;

function timeRange(occurrence: Occurrence) {
    return `${timeFormat.format(occurrence.start)} – ${timeFormat.format(occurrence.end)}`;
}

function blankEvent(start: Date, end: Date, allDay = false): CalendarEvent {
    return { id: newEventId(), title: "", start: toLocal(start), end: toLocal(end), allDay, calendar: "personal", repeat: "none" };
}

/** Side-by-side columns for overlapping appointments in one day. */
function layoutDay(items: { occurrence: Occurrence; top: number; bottom: number }[]) {
    const placed: { occurrence: Occurrence; top: number; bottom: number; column: number; columns: number }[] = [];
    let cluster: typeof placed = [];
    let clusterEnd = -1;
    const closeCluster = () => {
        const columns = Math.max(1, ...cluster.map((item) => item.column + 1));
        for (const item of cluster) item.columns = columns;
        cluster = [];
    };
    for (const item of [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom)) {
        if (item.top >= clusterEnd) closeCluster();
        const taken = new Set(cluster.filter((other) => other.bottom > item.top).map((other) => other.column));
        let column = 0;
        while (taken.has(column)) column += 1;
        const entry = { ...item, column, columns: 1 };
        cluster.push(entry);
        placed.push(entry);
        clusterEnd = Math.max(clusterEnd, item.bottom);
    }
    closeCluster();
    return placed;
}

type Drag =
    | { kind: "create"; day: number; anchor: number; current: number }
    | { kind: "move"; occurrence: Occurrence; offset: number; startAt: number; at: number }
    | { kind: "resize"; occurrence: Occurrence; offset: number; startAt: number; endAt: number; at: number };

export default function CalendarPanel({ onClose }: { onClose: () => void }) {
    const events = useSyncExternalStore(subscribe, getEvents);
    const [view, setView] = useState<View>(() => {
        try {
            const saved = localStorage.getItem(VIEW_KEY);
            if (saved === "day" || saved === "week" || saved === "month") return saved;
        } catch {
            // Fall back to the week.
        }
        return "week";
    });
    const [cursor, setCursor] = useState(() => startOfDay(new Date()));
    const [draft, setDraft] = useState<CalendarEvent | null>(null);
    const [now, setNow] = useState(() => new Date());
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const changeView = (next: View) => {
        setView(next);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {
            // Only a convenience.
        }
    };

    // Keys typed here must not reach the scene (Space pauses speech, WASD walks outside).
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const keydown = (event: KeyboardEvent) => {
            event.stopPropagation();
            const typing = (event.target as HTMLElement).matches("input, textarea, select");
            if (event.key === "Escape") {
                if (draft) setDraft(null);
                else onClose();
            } else if (!draft && !typing) {
                if (event.key === "ArrowLeft") setCursor((value) => step(view, value, -1));
                if (event.key === "ArrowRight") setCursor((value) => step(view, value, 1));
                if (event.key === "t" || event.key === "T") setCursor(startOfDay(new Date()));
            }
        };
        panel.addEventListener("keydown", keydown);
        return () => panel.removeEventListener("keydown", keydown);
    }, [draft, view, onClose]);

    useEffect(() => {
        panelRef.current?.focus();
    }, []);

    const days = visibleDays(view, cursor);
    const rangeStart = days[0];
    const rangeEnd = addDays(days[days.length - 1], 1);
    const shown = useMemo(() => occurrences(rangeStart, rangeEnd, events), [events, rangeStart.getTime(), rangeEnd.getTime()]);

    const title = view === "month"
        ? monthTitle.format(cursor)
        : view === "day" ? dayTitle.format(cursor) : rangeTitle.formatRange(days[0], days[6]);

    const openNew = (start?: Date, end?: Date, allDay = false) => {
        const from = start ?? (() => {
            const base = startOfDay(cursor);
            const hour = sameDay(base, new Date()) ? Math.min(23, new Date().getHours() + 1) : 9;
            return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour);
        })();
        setDraft(blankEvent(from, end ?? new Date(from.getTime() + 3_600_000), allDay));
    };

    return (
        <div className="calendarPanel" ref={panelRef} tabIndex={-1} role="dialog" aria-label={TEXT.calendar}>
            <header className="calHeader">
                <button type="button" className="calPrimary" onClick={() => openNew()}>
                    <Plus size={16} aria-hidden="true" /> <span>{TEXT.newEvent}</span>
                </button>
                <button type="button" className="calButton" onClick={() => setCursor(startOfDay(new Date()))}>{TEXT.today}</button>
                <div className="calStep">
                    <button type="button" className="calIconButton" onClick={() => setCursor(step(view, cursor, -1))} aria-label={TEXT.previous}>
                        <ChevronLeft size={18} />
                    </button>
                    <button type="button" className="calIconButton" onClick={() => setCursor(step(view, cursor, 1))} aria-label={TEXT.next}>
                        <ChevronRight size={18} />
                    </button>
                </div>
                <h2 className="calTitle">{title}</h2>
                <div className="calViews" role="tablist">
                    {(["day", "week", "month"] as View[]).map((option) => (
                        <button key={option} type="button" role="tab" aria-selected={view === option} onClick={() => changeView(option)}>
                            {TEXT[option]}
                        </button>
                    ))}
                </div>
                <button type="button" className="calIconButton" onClick={onClose} aria-label={TEXT.close}>
                    <X size={18} />
                </button>
            </header>

            <div className="calBody">
                <aside className="calSidebar">
                    <MiniMonth cursor={cursor} view={view} events={events} onPick={setCursor} />
                    <Upcoming events={events} now={now} onOpen={(occurrence) => {
                        setCursor(startOfDay(occurrence.start));
                        setDraft(occurrence.event);
                    }} />
                    <ul className="calLegend">
                        {CALENDARS.map((calendar) => (
                            <li key={calendar.id}><span style={{ background: calendar.color }} />{TEXT.calendars[calendar.id]}</li>
                        ))}
                    </ul>
                </aside>

                {view === "month" ? (
                    <MonthView
                        days={days}
                        cursor={cursor}
                        now={now}
                        shown={shown}
                        onOpenDay={(day) => {
                            setCursor(day);
                            changeView("day");
                        }}
                        onCreate={(day) => openNew(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9), undefined)}
                        onOpen={(occurrence) => setDraft(occurrence.event)}
                    />
                ) : (
                    <TimeGrid
                        key={view}
                        days={days}
                        now={now}
                        shown={shown}
                        onOpenDay={(day) => {
                            setCursor(day);
                            changeView("day");
                        }}
                        onCreate={openNew}
                        onOpen={(occurrence) => setDraft(occurrence.event)}
                    />
                )}
            </div>

            {draft && (
                <EventEditor
                    key={draft.id}
                    initial={draft}
                    isNew={!events.some((event) => event.id === draft.id)}
                    onCancel={() => setDraft(null)}
                    onSave={(event) => {
                        saveEvent(event);
                        setDraft(null);
                    }}
                    onDelete={() => {
                        deleteEvent(draft.id);
                        setDraft(null);
                    }}
                />
            )}
        </div>
    );
}

function MiniMonth({ cursor, view, events, onPick }: { cursor: Date; view: View; events: CalendarEvent[]; onPick: (day: Date) => void }) {
    const [month, setMonth] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    useEffect(() => setMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), [cursor.getFullYear(), cursor.getMonth()]);
    const days = monthGrid(month);
    const busy = useMemo(
        () => new Set(occurrences(days[0], addDays(days[41], 1), events).flatMap((occurrence) => {
            const keys: string[] = [];
            for (let day = startOfDay(occurrence.start); day < occurrence.end && keys.length < 62; day = addDays(day, 1)) keys.push(dateKey(day));
            return keys;
        })),
        [events, month.getTime()],
    );
    const selected = new Set(visibleDays(view === "month" ? "day" : view, cursor).map(dateKey));
    const today = dateKey(new Date());
    return (
        <div className="calMini">
            <div className="calMiniHeader">
                <strong>{monthTitle.format(month)}</strong>
                <button type="button" className="calIconButton" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={TEXT.previous}>
                    <ChevronLeft size={15} />
                </button>
                <button type="button" className="calIconButton" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={TEXT.next}>
                    <ChevronRight size={15} />
                </button>
            </div>
            <div className="calMiniGrid">
                {days.slice(0, 7).map((day) => <span key={`h${day.getDay()}`} className="calMiniWeekday">{weekdayShort.format(day).slice(0, 2)}</span>)}
                {days.map((day) => (
                    <button
                        key={dateKey(day)}
                        type="button"
                        className="calMiniDay"
                        data-outside={day.getMonth() !== month.getMonth()}
                        data-today={dateKey(day) === today}
                        data-selected={selected.has(dateKey(day))}
                        onClick={() => onPick(day)}
                    >
                        {day.getDate()}
                        {busy.has(dateKey(day)) && <i aria-hidden="true" />}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Upcoming({ events, now, onOpen }: { events: CalendarEvent[]; now: Date; onOpen: (occurrence: Occurrence) => void }) {
    const list = occurrences(now, addDays(startOfDay(now), 8), events).slice(0, 12);
    return (
        <div className="calUpcoming">
            <h3>{TEXT.upcoming}</h3>
            {list.length === 0 && <p>{TEXT.nothingUpcoming}</p>}
            {list.map((occurrence) => (
                <button key={occurrence.key} type="button" onClick={() => onOpen(occurrence)} style={{ "--event-color": CALENDAR_COLOR[occurrence.event.calendar] } as React.CSSProperties}>
                    <small>{sameDay(occurrence.start, now) ? TEXT.today : upcomingDay.format(occurrence.start)}{occurrence.event.allDay ? "" : ` · ${timeFormat.format(occurrence.start)}`}</small>
                    <span>{occurrence.event.title || TEXT.untitled}</span>
                </button>
            ))}
        </div>
    );
}

function eventStyle(occurrence: Occurrence) {
    return { "--event-color": CALENDAR_COLOR[occurrence.event.calendar] } as React.CSSProperties;
}

function MonthView({ days, cursor, now, shown, onOpenDay, onCreate, onOpen }: {
    days: Date[];
    cursor: Date;
    now: Date;
    shown: Occurrence[];
    onOpenDay: (day: Date) => void;
    onCreate: (day: Date) => void;
    onOpen: (occurrence: Occurrence) => void;
}) {
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const byDay = new Map<string, Occurrence[]>();
    for (const occurrence of shown) {
        const last = occurrence.end.getTime() === startOfDay(occurrence.end).getTime() ? addDays(occurrence.end, -1) : occurrence.end;
        for (let day = startOfDay(occurrence.start); day <= last; day = addDays(day, 1)) {
            const key = dateKey(day);
            byDay.set(key, [...(byDay.get(key) ?? []), occurrence]);
        }
    }
    const moveTo = (key: string, day: Date) => {
        const occurrence = shown.find((candidate) => candidate.key === key);
        if (!occurrence) return;
        const delta = Math.round((day.getTime() - startOfDay(occurrence.start).getTime()) / DAY);
        if (!delta) return;
        const event = occurrence.event;
        saveEvent({ ...event, start: toLocal(addDays(parseLocal(event.start), delta)), end: toLocal(addDays(parseLocal(event.end), delta)) });
    };
    return (
        <div className="calMonth">
            {days.slice(0, 7).map((day) => <div key={`h${day.getDay()}`} className="calMonthWeekday">{weekdayShort.format(day)}</div>)}
            {days.map((day) => {
                const key = dateKey(day);
                const items = byDay.get(key) ?? [];
                return (
                    <div
                        key={key}
                        className="calMonthCell"
                        data-outside={day.getMonth() !== cursor.getMonth()}
                        data-drop={dropTarget === key}
                        onClick={(event) => { if (event.target === event.currentTarget) onCreate(day); }}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDropTarget(key);
                        }}
                        onDragLeave={() => setDropTarget((value) => value === key ? null : value)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDropTarget(null);
                            moveTo(event.dataTransfer.getData("text/plain"), day);
                        }}
                    >
                        <button type="button" className="calMonthDate" data-today={sameDay(day, now)} onClick={() => onOpenDay(day)}>
                            {day.getDate()}
                        </button>
                        {items.slice(0, 3).map((occurrence) => (
                            <button
                                key={occurrence.key}
                                type="button"
                                className="calChip"
                                data-all-day={spansDays(occurrence)}
                                style={eventStyle(occurrence)}
                                draggable
                                onDragStart={(event) => event.dataTransfer.setData("text/plain", occurrence.key)}
                                onClick={() => onOpen(occurrence)}
                            >
                                {!spansDays(occurrence) && <small>{timeFormat.format(occurrence.start)}</small>}
                                <span>{occurrence.event.title || TEXT.untitled}</span>
                            </button>
                        ))}
                        {items.length > 3 && (
                            <button type="button" className="calMore" onClick={() => onOpenDay(day)}>{TEXT.more(items.length - 3)}</button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function TimeGrid({ days, now, shown, onOpenDay, onCreate, onOpen }: {
    days: Date[];
    now: Date;
    shown: Occurrence[];
    onOpenDay: (day: Date) => void;
    onCreate: (start: Date, end: Date, allDay?: boolean) => void;
    onOpen: (occurrence: Occurrence) => void;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const columnsRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const first = days[0];

    // Start at the working day, or just before now.
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const hour = days.some((day) => sameDay(day, new Date())) ? Math.max(0, new Date().getHours() - 1.5) : 7;
        scroller.scrollTop = Math.min(hour, 24 - scroller.clientHeight / HOUR) * HOUR;
    }, []);

    /** Minutes since the first shown day at the pointer, snapped. */
    const pointerAt = (event: { clientX: number; clientY: number }, round = Math.round) => {
        const rect = columnsRef.current!.getBoundingClientRect();
        const day = Math.min(days.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / days.length))));
        const minutes = Math.min(24 * 60, Math.max(0, round((event.clientY - rect.top) / HOUR * 60 / SNAP) * SNAP));
        return day * 24 * 60 + minutes;
    };
    const dateAt = (at: number) => new Date(first.getFullYear(), first.getMonth(), first.getDate(), 0, at);

    const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
        const occurrence = target && shown.find((candidate) => candidate.key === target.dataset.key);
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = pointerAt(event);
        if (occurrence) {
            const startAt = minutesBetween(first, occurrence.start);
            if ((event.target as HTMLElement).closest("[data-resize]")) {
                const endAt = minutesBetween(first, occurrence.end);
                setDrag({ kind: "resize", occurrence, offset: at - endAt, startAt, endAt, at: endAt });
            } else {
                setDrag({ kind: "move", occurrence, offset: at - startAt, startAt, at: startAt });
            }
        } else {
            const anchor = pointerAt(event, Math.floor);
            setDrag({ kind: "create", day: Math.floor(anchor / 1440), anchor, current: anchor });
        }
    };

    /** The drag with the pointer at `at`. */
    const advance = (current: Drag, at: number): Drag => {
        if (current.kind === "create") {
            // A new appointment stays within the day it was started on.
            const dayStart = current.day * 1440;
            return { ...current, current: Math.min(dayStart + 1440, Math.max(dayStart, at)) };
        }
        if (current.kind === "move") return { ...current, at: at - current.offset };
        return { ...current, at: Math.max(current.startAt + SNAP, at - current.offset) };
    };

    const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (drag) setDrag(advance(drag, pointerAt(event)));
    };

    const pointerUp = (pointer: ReactPointerEvent<HTMLDivElement>) => {
        if (!drag) return;
        setDrag(null);
        // From the release itself: the last move may not have rendered yet.
        const ended = advance(drag, pointerAt(pointer));
        if (ended.kind === "create") {
            const from = Math.min(ended.anchor, ended.current);
            const to = Math.max(ended.anchor, ended.current);
            // A click makes an hour from the half hour clicked.
            if (to - from < SNAP) {
                const start = Math.floor(ended.anchor / 30) * 30;
                onCreate(dateAt(start), dateAt(start + 60));
            } else {
                onCreate(dateAt(from), dateAt(to));
            }
            return;
        }
        const event = ended.occurrence.event;
        if (ended.kind === "move") {
            if (ended.at === ended.startAt) return onOpen(ended.occurrence);
            const delta = ended.at - ended.startAt;
            saveEvent({ ...event, start: addMinutes(event.start, delta), end: addMinutes(event.end, delta) });
        } else {
            if (ended.at === ended.endAt) return onOpen(ended.occurrence);
            saveEvent({ ...event, end: addMinutes(event.end, ended.at - ended.endAt) });
        }
    };

    // The dragged appointment is drawn where it would land.
    const timed = shown.filter((occurrence) => !spansDays(occurrence)).map((occurrence) => {
        if (!drag || drag.kind === "create" || drag.occurrence.key !== occurrence.key) return occurrence;
        if (drag.kind === "move") {
            const length = occurrence.end.getTime() - occurrence.start.getTime();
            return { ...occurrence, start: dateAt(drag.at), end: new Date(dateAt(drag.at).getTime() + length) };
        }
        return { ...occurrence, end: dateAt(drag.at) };
    });
    const allDay = shown.filter(spansDays);

    return (
        <div className="calGrid" style={{ "--days": days.length } as React.CSSProperties}>
            <div className="calGridHead">
                <div className="calGutter" />
                {days.map((day) => (
                    <button key={dateKey(day)} type="button" className="calGridDay" data-today={sameDay(day, now)} onClick={() => onOpenDay(day)}>
                        <span>{weekdayShort.format(day)}</span>
                        <strong>{day.getDate()}</strong>
                    </button>
                ))}
            </div>
            <div className="calAllDay">
                <div className="calGutter">{TEXT.allDayRow}</div>
                {days.map((day) => {
                    const end = addDays(day, 1);
                    const items = allDay.filter((occurrence) => occurrence.start < end && occurrence.end > day);
                    return (
                        <div
                            key={dateKey(day)}
                            className="calAllDayCell"
                            onClick={(event) => { if (event.target === event.currentTarget) onCreate(day, day, true); }}
                        >
                            {items.map((occurrence) => (
                                <button key={occurrence.key} type="button" className="calChip" data-all-day="true" style={eventStyle(occurrence)} onClick={() => onOpen(occurrence)}>
                                    <span>{occurrence.event.title || TEXT.untitled}</span>
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
            <div className="calScroll" ref={scrollRef}>
                <div className="calHours">
                    {Array.from({ length: 24 }, (_, hour) => (
                        <span key={hour} style={{ top: hour * HOUR }}>{hour ? timeFormat.format(new Date(2000, 0, 1, hour)) : ""}</span>
                    ))}
                </div>
                <div
                    className="calColumns"
                    ref={columnsRef}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={() => setDrag(null)}
                    data-dragging={drag?.kind ?? undefined}
                >
                    {days.map((day, index) => {
                        const dayEnd = addDays(day, 1);
                        const items = layoutDay(timed
                            .filter((occurrence) => occurrence.start < dayEnd && occurrence.end > day)
                            .map((occurrence) => ({
                                occurrence,
                                top: Math.max(0, minutesBetween(day, occurrence.start)),
                                bottom: Math.min(1440, minutesBetween(day, occurrence.end)),
                            })));
                        return (
                            <div key={dateKey(day)} className="calColumn">
                                {items.map(({ occurrence, top, bottom, column, columns }) => {
                                    const short = bottom - top < 45;
                                    return (
                                        <div
                                            key={occurrence.key}
                                            data-key={occurrence.key}
                                            className="calEvent"
                                            data-short={short}
                                            data-dragged={drag && drag.kind !== "create" && drag.occurrence.key === occurrence.key}
                                            style={{
                                                ...eventStyle(occurrence),
                                                top: top / 60 * HOUR,
                                                // Readable even for a quarter of an hour.
                                                height: Math.max(19, (bottom - top) / 60 * HOUR - 2),
                                                left: `calc(${column / columns * 100}% + 1px)`,
                                                width: `calc(${100 / columns}% - 3px)`,
                                            }}
                                        >
                                            <strong>{occurrence.event.title || TEXT.untitled}</strong>
                                            {short ? <small> {timeFormat.format(occurrence.start)}</small> : <small>{timeRange(occurrence)}</small>}
                                            {!short && occurrence.event.location && <small className="calEventLocation">{occurrence.event.location}</small>}
                                            <span className="calResize" data-resize="true" aria-hidden="true" />
                                        </div>
                                    );
                                })}
                                {drag?.kind === "create" && drag.day === index && drag.current !== drag.anchor && (
                                    <div
                                        className="calEvent calGhost"
                                        style={{
                                            top: (Math.min(drag.anchor, drag.current) % 1440) / 60 * HOUR,
                                            height: Math.abs(drag.current - drag.anchor) / 60 * HOUR,
                                            left: 1,
                                            width: "calc(100% - 3px)",
                                        }}
                                    >
                                        <small>{timeFormat.format(dateAt(Math.min(drag.anchor, drag.current)))} – {timeFormat.format(dateAt(Math.max(drag.anchor, drag.current)))}</small>
                                    </div>
                                )}
                                {sameDay(day, now) && (
                                    <div className="calNow" style={{ top: (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function EventEditor({ initial, isNew, onCancel, onSave, onDelete }: {
    initial: CalendarEvent;
    isNew: boolean;
    onCancel: () => void;
    onSave: (event: CalendarEvent) => void;
    onDelete: () => void;
}) {
    const [event, setEvent] = useState(initial);
    const [startDate, startTime = "09:00"] = event.start.split("T");
    const [endDate, endTime = "10:00"] = event.end.split("T");

    /** Moving the start keeps the length, like in other calendars. */
    const changeStart = (date: string, time: string) => {
        const start = `${date}T${time}`;
        const length = parseLocal(event.end).getTime() - parseLocal(event.start).getTime();
        setEvent({ ...event, start, end: toLocal(new Date(parseLocal(start).getTime() + Math.max(0, length))) });
    };

    const toggleAllDay = (allDay: boolean) => {
        if (allDay) {
            // The all-day end is the last day; a timed end at midnight belongs to the day before.
            const last = new Date(parseLocal(event.end).getTime() - 60_000);
            const end = last < parseLocal(event.start) ? event.start : toLocal(last);
            setEvent({ ...event, allDay, end: `${end.split("T")[0]}T${endTime}` });
        } else {
            const start = parseLocal(event.start);
            const end = parseLocal(event.end);
            setEvent({ ...event, allDay, end: end <= start ? toLocal(new Date(start.getTime() + 3_600_000)) : event.end });
        }
    };

    const save = () => {
        let { start, end } = event;
        if (event.allDay) {
            if (end.split("T")[0] < start.split("T")[0]) end = start;
        } else if (parseLocal(end) <= parseLocal(start)) {
            end = addMinutes(start, 60);
        }
        onSave({
            ...event,
            title: event.title.trim(),
            start,
            end,
            location: event.location?.trim() || undefined,
            notes: event.notes?.trim() || undefined,
        });
    };

    return (
        <div className="calEditorBackdrop" onPointerDown={(pointer) => { if (pointer.target === pointer.currentTarget) onCancel(); }}>
            <form
                className="calEditor"
                style={{ "--event-color": CALENDAR_COLOR[event.calendar] } as React.CSSProperties}
                onSubmit={(submit) => {
                    submit.preventDefault();
                    save();
                }}
            >
                <h3>{isNew ? TEXT.newEvent : TEXT.editEvent}</h3>
                <input
                    className="calEditorTitle"
                    autoFocus
                    placeholder={TEXT.title}
                    value={event.title}
                    onChange={(change) => setEvent({ ...event, title: change.target.value })}
                />
                <label className="calToggle">
                    <input type="checkbox" checked={event.allDay} onChange={(change) => toggleAllDay(change.target.checked)} />
                    {TEXT.allDay}
                </label>
                <div className="calEditorRow">
                    <span>{TEXT.starts}</span>
                    <input type="date" required value={startDate} onChange={(change) => change.target.value && changeStart(change.target.value, startTime)} />
                    {!event.allDay && <input type="time" required value={startTime} onChange={(change) => change.target.value && changeStart(startDate, change.target.value)} />}
                </div>
                <div className="calEditorRow">
                    <span>{TEXT.ends}</span>
                    <input type="date" required value={endDate} onChange={(change) => change.target.value && setEvent({ ...event, end: `${change.target.value}T${endTime}` })} />
                    {!event.allDay && <input type="time" required value={endTime} onChange={(change) => change.target.value && setEvent({ ...event, end: `${endDate}T${change.target.value}` })} />}
                </div>
                <div className="calEditorRow">
                    <span><RepeatIcon size={14} aria-hidden="true" /> {TEXT.repeat}</span>
                    <select value={event.repeat} onChange={(change) => setEvent({ ...event, repeat: change.target.value as Repeat })}>
                        {(Object.keys(TEXT.repeats) as Repeat[]).map((repeat) => <option key={repeat} value={repeat}>{TEXT.repeats[repeat]}</option>)}
                    </select>
                </div>
                <div className="calEditorRow">
                    <span>{TEXT.calendarLabel}</span>
                    <div className="calSwatches" role="radiogroup" aria-label={TEXT.calendarLabel}>
                        {CALENDARS.map((calendar) => (
                            <button
                                key={calendar.id}
                                type="button"
                                role="radio"
                                aria-checked={event.calendar === calendar.id}
                                title={TEXT.calendars[calendar.id]}
                                style={{ background: calendar.color }}
                                onClick={() => setEvent({ ...event, calendar: calendar.id })}
                            />
                        ))}
                        <small>{TEXT.calendars[event.calendar]}</small>
                    </div>
                </div>
                <label className="calEditorField">
                    <MapPin size={14} aria-hidden="true" />
                    <input placeholder={TEXT.location} value={event.location ?? ""} onChange={(change) => setEvent({ ...event, location: change.target.value })} />
                </label>
                <textarea placeholder={TEXT.notes} rows={3} value={event.notes ?? ""} onChange={(change) => setEvent({ ...event, notes: change.target.value })} />
                {event.repeat !== "none" && !isNew && <p className="calEditorHint">{TEXT.series}</p>}
                <div className="calEditorActions">
                    {!isNew && (
                        <button type="button" className="calDanger" onClick={onDelete}>
                            <Trash2 size={15} aria-hidden="true" /> {TEXT.delete}
                        </button>
                    )}
                    <span />
                    <button type="button" className="calButton" onClick={onCancel}>{TEXT.cancel}</button>
                    <button type="submit" className="calPrimary">{TEXT.save}</button>
                </div>
            </form>
        </div>
    );
}
