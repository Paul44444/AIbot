const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'word-lookup-test-'));
writeFileSync(join(output, 'wordLookup.js'), ts.transpileModule(readFileSync('src/utils/wordLookup.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText);
const modulePath = join(output, 'wordLookup.js');
const originalFetch = global.fetch;
const storage = new Map();
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
function fresh() { delete require.cache[modulePath]; return require(modulePath); }
function dictionaryFetch(url) { return new Response(readFileSync(join('public', url)), { status: 200 }); }
after(() => { global.fetch = originalFetch; delete global.localStorage; rmSync(output, { recursive: true, force: true }); });

test('prefetched simplified and traditional words need no AI, across sentences', async () => {
    const lookup = fresh(); const requests = [];
    global.fetch = async url => { requests.push(url); assert.ok(url.startsWith('/dictionaries/')); return dictionaryFetch(url); };
    await lookup.prefetchWordDictionary(['你好', '学习', '學習'], new AbortController().signal);
    const count = requests.length;
    assert.match(lookup.getCachedWordInfo('你好', '你好朋友').translation, /hello/);
    assert.match((await lookup.lookupWordInfo('学习', '我学习中文')).translation, /study|learn/);
    assert.match((await lookup.lookupWordInfo('學習', '學習中文')).translation, /study|learn/);
    assert.equal(requests.length, count);
});

test('concurrent hover/focus lookups share a dictionary download', async () => {
    const lookup = fresh(); let count = 0;
    global.fetch = async url => { count++; await new Promise(r => setTimeout(r, 15)); return dictionaryFetch(url); };
    const [a, b] = await Promise.all([lookup.lookupWordInfo('地图', '地图在哪里'), lookup.lookupWordInfo('地图', '看地图')]);
    assert.equal(count, 1); assert.equal(a.translation, b.translation); assert.match(a.pronunciation, /di4 tu2/);
    assert.equal(a.translation, 'map');
});

test('fallback requests deduplicate but keep case and sentence context separate', async () => {
    const lookup = fresh(); let count = 0;
    global.fetch = async () => { count++; await new Promise(r => setTimeout(r, 10)); return Response.json({ word:'Gift', translation:'poison', pronunciation:'gift' }); };
    await Promise.all([lookup.lookupWordInfo('Gift', 'Das ist Gift.'), lookup.lookupWordInfo('Gift', 'Das ist Gift.')]);
    assert.equal(count, 1);
    assert.equal(lookup.getCachedWordInfo('gift', 'A gift.'), null);
    assert.equal(lookup.getCachedWordInfo('Gift', 'A different context.'), null);
    assert.equal(lookup.getCachedWordInfo('Gift', 'Das ist Gift.').translation, 'poison');
    await new Promise(r => setTimeout(r, 130));
    assert.equal(fresh().getCachedWordInfo('Gift', 'Das ist Gift.').translation, 'poison');
});

test('failed dictionary requests fall back; failed AI requests can retry', async () => {
    const lookup = fresh(); let calls = 0;
    global.fetch = async url => {
        if (url.startsWith('/dictionaries/')) throw new Error('offline dictionary');
        calls++; return calls === 1 ? new Response('', {status:503}) : Response.json({word:'朋友',translation:'friend',pronunciation:'peng2 you5'});
    };
    await assert.rejects(lookup.lookupWordInfo('朋友', '朋友来了'));
    assert.equal((await lookup.lookupWordInfo('朋友', '朋友来了')).translation, 'friend');
    assert.equal(calls, 2);
});

test('Japanese sentences do not reuse Chinese dictionary meanings', async () => {
    const lookup = fresh(); const urls = [];
    global.fetch = async url => { urls.push(url); return Response.json({word:'手紙',translation:'letter',pronunciation:'tegami'}); };
    assert.equal((await lookup.lookupWordInfo('手紙', '手紙を書きます')).translation, 'letter');
    assert.deepEqual(urls, ['/api/word-info']);
});
