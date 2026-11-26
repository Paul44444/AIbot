// The user's appointment calendar, kept in this browser. Times are stored as
// local wall-clock strings ("2026-11-26T09:30"), so an appointment stays at
// 9:30 whatever the time zone does. The characters are told what is coming up.

const CALENDAR_KEY = "calendarEvents";

export type Repeat = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type CalendarId = "personal" | "work" | "family" | "important" | "other";

export type CalendarEvent = {
    id: string;
    title: string;
    /** "YYYY-MM-DDTHH:mm" local time; for all-day events only the date counts. */
    start: string;
    /** Exclusive end for timed events; the last day (inclusive) for all-day events. */
    end: string;
    allDay: boolean;
    calendar: CalendarId;
    repeat: Repeat;
    location?: string;
    notes?: string;
};

/** One appearance of an event in time (a repeating event has many). */
export type Occurrence = { event: CalendarEvent; start: Date; end: Date; key: string };

export const CALENDARS: { id: CalendarId; color: string }[] = [
    { id: "personal", color: "#5a97ff" },
    { id: "work", color: "#f0a030" },
    { id: "family", color: "#3ec27a" },
    { id: "important", color: "#ef5a5a" },
    { id: "other", color: "#a87bea" },
];
export const CALENDAR_COLOR = Object.fromEntries(CALENDARS.map((calendar) => [calendar.id, calendar.color])) as Record<CalendarId, string>;

export const DAY = 86_400_000;

export function parseLocal(value: string) {
    const [date, time = "00:00"] = value.split("T");
    const [year, month, day] = date.split("-").map(Number);
    const [hours, minutes] = time.split(":").map(Number);
    return new Date(year, month - 1, day, hours, minutes);
}

const pad = (value: number) => String(value).padStart(2, "0");
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const toLocal = (date: Date) => `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

function load(): CalendarEvent[] {
    try {
        const raw = localStorage.getItem(CALENDAR_KEY);
        return raw ? JSON.parse(raw) as CalendarEvent[] : [];
    } catch {
        return [];
    }
}

let events = load();
const listeners = new Set<() => void>();

function save(next: CalendarEvent[]) {
    events = next;
    try {
        localStorage.setItem(CALENDAR_KEY, JSON.stringify(events));
    } catch {
        // Storage full or unavailable: the changes then last for this visit only.
    }
    for (const listener of listeners) listener();
}

export const getEvents = () => events;

/** For useSyncExternalStore. */
export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function saveEvent(event: CalendarEvent) {
    save(events.some((candidate) => candidate.id === event.id)
        ? events.map((candidate) => candidate.id === event.id ? event : candidate)
        : [...events, event]);
}

export function deleteEvent(id: string) {
    save(events.filter((event) => event.id !== id));
}

export const newEventId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Start and (exclusive) end of an event's first appearance. */
function firstSpan(event: CalendarEvent) {
    const start = parseLocal(event.start);
    if (event.allDay) return { start: startOfDay(start), end: addDays(startOfDay(parseLocal(event.end)), 1) };
    return { start, end: parseLocal(event.end) };
}

function shift(date: Date, repeat: Repeat, times: number) {
    if (repeat === "daily") return addDays(date, times);
    if (repeat === "weekly") return addDays(date, times * 7);
    const shifted = new Date(date);
    if (repeat === "monthly") shifted.setMonth(date.getMonth() + times);
    if (repeat === "yearly") shifted.setFullYear(date.getFullYear() + times);
    return shifted;
}

/** Every appearance that overlaps [from, to), sorted by start. */
export function occurrences(from: Date, to: Date, list = events): Occurrence[] {
    const found: Occurrence[] = [];
    for (const event of list) {
        const { start, end } = firstSpan(event);
        const length = end.getTime() - start.getTime();
        if (event.repeat === "none") {
            if (start < to && end > from) found.push({ event, start, end, key: event.id });
            continue;
        }
        // Skip ahead to shortly before the range instead of walking from the first appearance.
        const period = event.repeat === "daily" ? DAY : event.repeat === "weekly" ? 7 * DAY : event.repeat === "monthly" ? 28 * DAY : 365 * DAY;
        let index = Math.max(0, Math.floor((from.getTime() - length - start.getTime()) / period) - 2);
        for (let guard = 0; guard < 500; guard++, index++) {
            const at = shift(start, event.repeat, index);
            // A monthly event on the 31st skips months without one.
            if (event.repeat === "monthly" && at.getDate() !== start.getDate()) continue;
            if (at >= to) break;
            const until = new Date(at.getTime() + length);
            if (until > from) found.push({ event, start: at, end: until, key: `${event.id}@${dateKey(at)}` });
        }
    }
    return found.sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.event.allDay) - Number(a.event.allDay));
}

function describe(occurrence: Occurrence) {
    const { event, start, end } = occurrence;
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
    const when = event.allDay
        ? `${day.format(start)}${end.getTime() - start.getTime() > DAY ? ` – ${day.format(addDays(end, -1))}` : ""}, all day`
        : `${day.format(start)}, ${time.format(start)}–${time.format(end)}`;
    return `- ${when}: ${event.title || "(untitled)"}${event.location ? ` (at ${event.location})` : ""}`;
}

/** What the characters know about the user's appointments, for their instructions. */
export function calendarContext() {
    const today = startOfDay(new Date());
    const past = occurrences(addDays(today, -2), today);
    const coming = occurrences(today, addDays(today, 14));
    const parts = [
        "[Calendar] The user keeps their appointments in the calendar on this site (the calendar button at the top). "
        + "You can see it but cannot change it yet: if they want something added or moved, tell them to do it there.",
    ];
    parts.push(coming.length ? `Coming up (today and the next two weeks):\n${coming.slice(0, 40).map(describe).join("\n")}` : "Nothing in the calendar for the next two weeks.");
    if (past.length) parts.push(`The last two days (you may ask how it went, like a friend):\n${past.slice(-10).map(describe).join("\n")}`);
    return parts.join("\n");
}
