export type WordInfo = {
    word: string;
    translation: string;
    pronunciation: string;
    source?: "dictionary" | "ai";
};

type DictionaryEntry = [pronunciation: string, definitions: string[]];
type DictionaryShard = Record<string, DictionaryEntry[]>;
type CachedWord = { info: WordInfo; expires: number };

export const DICTIONARY_BASE = "/dictionaries/cedict-c0247e44fb33";
const CACHE_KEY = "word-helper-en-v2";
const CACHE_LIMIT = 500;
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cache = new Map<string, CachedWord>();
const pending = new Map<string, Promise<WordInfo>>();
const shards = new Map<string, DictionaryShard>();
const shardRequests = new Map<string, Promise<DictionaryShard>>();
let restored = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function normalize(word: string) {
    // Preserve case: e.g. German "Gift" and English "gift" differ.
    return word.trim().normalize("NFC");
}

function shardId(word: string): string | null {
    if (!/\p{Script=Han}/u.test(word)) return null;
    return ((word.codePointAt(0) ?? 0) % 256).toString(16).padStart(2, "0");
}

function useChineseDictionary(word: string, context: string) {
    return shardId(word) !== null
        && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(context);
}

function infoIsValid(value: unknown): value is WordInfo {
    if (!value || typeof value !== "object") return false;
    const info = value as WordInfo;
    return typeof info.word === "string" && typeof info.translation === "string"
        && typeof info.pronunciation === "string";
}

function restoreCache() {
    if (restored) return;
    restored = true;
    try {
        const entries = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
        if (!Array.isArray(entries)) return;
        for (const entry of entries.slice(-CACHE_LIMIT)) {
            if (!Array.isArray(entry) || entry.length !== 2) continue;
            const [key, value] = entry;
            if (typeof key === "string" && value?.expires > Date.now() && infoIsValid(value.info)) {
                cache.set(key, value);
            }
        }
    } catch { /* Storage may be disabled or full. Memory caching still works. */ }
}

function remember(key: string, info: WordInfo) {
    cache.delete(key);
    cache.set(key, { info, expires: Date.now() + CACHE_TTL });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    if (persistTimer !== undefined) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache])); } catch { /* optional */ }
    }, 100);
}

function readCache(key: string): WordInfo | null {
    restoreCache();
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires <= Date.now()) { cache.delete(key); return null; }
    return entry.info;
}

function contextKey(word: string, context: string) {
    return JSON.stringify([word, context.trim().slice(0, 500)]);
}

function dictionaryInfo(word: string): WordInfo | null {
    const id = shardId(word);
    const entries = id ? shards.get(id)?.[word] : undefined;
    if (!entries?.length) return null;
    // Common words before proper names; retain alternate readings/meanings.
    const ordered = [...entries].sort((a, b) => Number(/^[A-Z]/.test(a[0])) - Number(/^[A-Z]/.test(b[0])));
    const definitions = [...new Set(ordered.flatMap((entry) => entry[1]))];
    return {
        word,
        pronunciation: [...new Set(ordered.map((entry) => entry[0]))].join(" / "),
        translation: definitions.slice(0, 6).join("; "),
        source: "dictionary",
    };
}

async function loadShard(id: string): Promise<DictionaryShard> {
    const loaded = shards.get(id);
    if (loaded) return loaded;
    const existing = shardRequests.get(id);
    if (existing) return existing;
    const request = (async () => {
        const response = await fetch(`${DICTIONARY_BASE}/${id}.json`);
        if (!response.ok) throw new Error(`Dictionary unavailable: ${response.status}`);
        const data = await response.json() as DictionaryShard;
        shards.set(id, data);
        return data;
    })();
    shardRequests.set(id, request);
    try { return await request; } finally { shardRequests.delete(id); }
}

export function getCachedWordInfo(word: string, context: string): WordInfo | null {
    const normalized = normalize(word);
    const dictionary = useChineseDictionary(normalized, context)
        ? dictionaryInfo(normalized) ?? readCache(`dictionary:${normalized}`)
        : null;
    return dictionary ?? readCache(contextKey(normalized, context));
}

export async function lookupWordInfo(word: string, context: string): Promise<WordInfo> {
    const normalized = normalize(word);
    const cached = getCachedWordInfo(normalized, context);
    if (cached) return cached;
    const key = contextKey(normalized, context);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
        const id = useChineseDictionary(normalized, context) ? shardId(normalized) : null;
        if (id) {
            try {
                await loadShard(id);
                const info = dictionaryInfo(normalized);
                if (info) {
                    remember(`dictionary:${normalized}`, info);
                    return info;
                }
            } catch { /* Keep the existing lookup available if the dictionary fails. */ }
        }
        const response = await fetch("/api/word-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word: normalized, context }),
        });
        if (!response.ok) throw new Error(`Word lookup failed: ${response.status}`);
        const data: unknown = await response.json();
        if (!infoIsValid(data)) throw new Error("Invalid word lookup response");
        const info: WordInfo = { ...data, source: "ai" };
        remember(key, info);
        return info;
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
}

// Only load the small dictionary sections needed by visible transcript words.
// No AI calls are made by prefetching; cancellation stops scheduling new work.
export async function prefetchWordDictionary(words: string[], signal: AbortSignal) {
    const ids = [...new Set(words.map(normalize).map(shardId).filter((id): id is string => id !== null))];
    let next = 0;
    const worker = async () => {
        while (!signal.aborted && next < ids.length) {
            const id = ids[next++];
            try { await loadShard(id); } catch { /* Retry on hover. */ }
        }
    };
    await Promise.all([worker(), worker(), worker()]);
}
