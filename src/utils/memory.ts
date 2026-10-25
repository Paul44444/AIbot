// Long-term memory of the group, kept in this browser: a timestamped journal of
// what was said, a log of every conversation, and notes a model condenses from
// the journal (who the user is, open threads, recent conversations). The notes
// go into every character's instructions, so they can pick up where they left off.

const MEMORY_KEY = "companionMemory";
/** A pause this long starts a new conversation. */
const NEW_CONVERSATION_AFTER = 30 * 60_000;
/** Journal lines collected before they are condensed into the notes. */
const CONDENSE_AFTER = 16;
/** Conversations kept in the log (start and end times; useful for routines later). */
const MAX_CONVERSATIONS = 1000;

type JournalLine = { at: number; speaker: string; text: string };
type Conversation = { start: number; end: number; lines: number };
type MemoryState = {
    /** What the characters know, written and rewritten by a model. */
    notes: string;
    /** Lines not yet condensed into the notes. */
    journal: JournalLine[];
    conversations: Conversation[];
};

const empty = (): MemoryState => ({ notes: "", journal: [], conversations: [] });

function load(): MemoryState {
    try {
        const raw = localStorage.getItem(MEMORY_KEY);
        return raw ? { ...empty(), ...JSON.parse(raw) as Partial<MemoryState> } : empty();
    } catch {
        return empty();
    }
}

function save(state: MemoryState) {
    try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(state));
    } catch {
        // Storage full or unavailable: the memory then lasts for this visit only.
    }
}

/** "Sat 25 Oct 2026, 20:14" in the user's time zone. */
export function formatMoment(at: number) {
    return new Intl.DateTimeFormat("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(at);
}

function ago(ms: number) {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 90) return `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
}

let state = load();
let condensing: Promise<void> | null = null;
/** When the current conversation started (set by the first line of it). */
let conversationStart: number | null = null;

/** Writes a line to the journal, and condenses the journal once enough has piled up. */
export function remember(speaker: string, text: string) {
    const at = Date.now();
    const last = state.conversations.at(-1);
    if (last && at - last.end < NEW_CONVERSATION_AFTER) {
        last.end = at;
        last.lines += 1;
    } else {
        state.conversations = [...state.conversations, { start: at, end: at, lines: 1 }].slice(-MAX_CONVERSATIONS);
    }
    conversationStart ??= state.conversations.at(-1)!.start;
    state.journal.push({ at, speaker, text });
    save(state);
    if (state.journal.length >= CONDENSE_AFTER) void condense();
}

/**
 * Folds the journal into the notes with a model. Also run on start-up, so what
 * was said shortly before the page closed is not lost.
 */
export function condense() {
    if (condensing || !state.journal.length) return condensing ?? Promise.resolve();
    const lines = state.journal.slice();
    condensing = (async () => {
        try {
            const response = await fetch("/api/brain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    task: "remember",
                    notes: state.notes,
                    now: formatMoment(Date.now()),
                    journal: lines.map((line) => `[${formatMoment(line.at)}] ${line.speaker}: ${line.text}`).join("\n"),
                }),
            });
            if (!response.ok) throw new Error(`Memory ${response.status}`);
            const { notes } = await response.json() as { notes?: string };
            if (!notes?.trim()) return;
            // Lines said while condensing stay in the journal for next time.
            state = { ...state, notes: notes.trim(), journal: state.journal.filter((line) => !lines.includes(line)) };
            save(state);
        } catch (error) {
            console.error("Could not update the memory:", error);
        } finally {
            condensing = null;
        }
    })();
    return condensing;
}

/** Everything a character should know about the past, for their instructions. */
export function memoryContext() {
    const now = Date.now();
    const parts = [`Right now it is ${formatMoment(now)} for the user.`];
    const last = state.conversations.at(-1);
    if (!conversationStart) {
        if (!last) parts.push("This is the first time you meet the user.");
        else if (now - last.end < NEW_CONVERSATION_AFTER) parts.push(`You were talking ${ago(now - last.end)}; the user just came back.`);
        else parts.push(`You last talked ${ago(now - last.end)} (${formatMoment(last.end)}). This is the start of a new conversation.`);
    }
    if (state.notes) parts.push(`What you remember from earlier conversations (shared by the group):\n${state.notes}`);
    // Said recently but not yet in the notes, e.g. in the minutes before the page was closed.
    const recent = state.journal.filter((line) => !conversationStart || line.at < conversationStart).slice(-12);
    if (recent.length) {
        parts.push(`The last things said before this conversation:\n${recent.map((line) => `[${formatMoment(line.at)}] ${line.speaker}: ${line.text}`).join("\n")}`);
    }
    return `[Memory]\n${parts.join("\n\n")}

Use this like a friend who remembers, not like a database: weave it in when it fits, never recite it, and never mention
notes or memory. In your first reply of a new conversation, if an open thread belongs to you (something you recommended,
or a plan or worry the user told you about), greet the user and ask about it right away, like a friend would
("Hey! So, did you watch The Thing?"). Only one thread at a time; the rest can come up later.`;
}

/** Forgets everything the group remembers about the user. */
export function forgetEverything() {
    state = empty();
    conversationStart = null;
    try {
        localStorage.removeItem(MEMORY_KEY);
    } catch {
        // Nothing stored then.
    }
}
