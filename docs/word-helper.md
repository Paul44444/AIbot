# Transcript word lookup

Chinese words are looked up in CC-CEDICT locally in the browser, with English
meanings and numbered-tone pinyin. Both simplified and traditional headwords
are included. These are dictionary senses, not sentence-specific translations.

Source: https://www.mdbg.net/chinese/dictionary?page=cedict
Data license: https://creativecommons.org/licenses/by-sa/4.0/
Attribution and conversion details are included in the public dictionary's
NOTICE.txt and linked from dictionary results in the UI.

The data is divided into 256 sections by the first Unicode code point modulo
256. Only sections needed for transcript words are prefetched, with at most
three concurrent background requests. Content-versioned URLs can be cached
for one year. No dictionary data is bundled into the JavaScript entry file.

Dictionary misses and other languages retain the existing context-sensitive
API lookup. Context containing kana or Hangul bypasses the Chinese lookup.
Han-only words without such language cues are assumed Chinese. The app's
existing translation target remains English.

The previous 250 ms hover delay is removed. Concurrent duplicate requests share
one promise. Successful fallback results retain case and sentence context in
their keys. Up to 500 lookup results are saved in localStorage for 30 days.
Storage failures do not prevent lookup; failed requests are retryable.

Rebuild data from a downloaded CC-CEDICT gzip with:

    python3 scripts/build-cedict.py /path/to/cedict.txt.gz

When changing the dataset, update DICTIONARY_BASE in src/utils/wordLookup.ts
and the content-versioned cache path in vercel.json.

Validation:

    node --test tests/wordLookup.test.cjs
    npm run build

Browser coverage: prefetch before hover; Chinese lookup without any API request;
rapid hover changes with out-of-order API responses; repeat lookup from cache.
