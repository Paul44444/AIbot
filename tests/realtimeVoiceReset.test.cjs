const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const ts = require("typescript");

const output = mkdtempSync(join(tmpdir(), "realtime-reset-test-"));
const modulePath = join(output, "realtimeVoice.js");
writeFileSync(modulePath, ts.transpileModule(
    readFileSync("src/utils/realtimeVoice.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText);

const originalGlobals = {
    RTCPeerConnection: global.RTCPeerConnection,
    Audio: global.Audio,
    document: global.document,
    navigator: global.navigator,
    fetch: global.fetch,
};

afterEach(() => {
    global.RTCPeerConnection = originalGlobals.RTCPeerConnection;
    global.Audio = originalGlobals.Audio;
    global.document = originalGlobals.document;
    global.navigator = originalGlobals.navigator;
    global.fetch = originalGlobals.fetch;
});

test("aborting a conversation stops its microphone and ignores late events", async () => {
    const peers = [];
    const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
    let assistantText = "";

    global.document = { createElement: () => ({ pause() {}, srcObject: null }) };
    Object.defineProperty(global, "navigator", {
        configurable: true,
        value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
    });
    global.RTCPeerConnection = class {
        constructor() {
            this.connectionState = "new";
            this.senders = [];
            peers.push(this);
        }
        addTrack(addedTrack) { this.senders.push({ track: addedTrack }); }
        addTransceiver() {}
        createDataChannel() {
            this.dc = { readyState: "open", send() {} };
            return this.dc;
        }
        async createOffer() { return { sdp: "offer" }; }
        async setLocalDescription() {}
        async setRemoteDescription() { this.connectionState = "connected"; }
        close() { this.connectionState = "closed"; }
    };
    global.fetch = async () => new Response("answer");

    delete require.cache[modulePath];
    const { startRealtimeVoiceSession } = require(modulePath);
    const controller = new AbortController();
    const session = await startRealtimeVoiceSession({
        signal: controller.signal,
        onAssistantTextDelta: (delta) => { assistantText += delta; },
    });

    session.dc.onmessage({ data: JSON.stringify({ type: "response.output_text.delta", delta: "old" }) });
    assert.equal(assistantText, "old");

    controller.abort();
    assert.equal(track.stopped, true);
    assert.equal(peers[0].connectionState, "closed");

    session.dc.onmessage({ data: JSON.stringify({ type: "response.output_text.delta", delta: " late" }) });
    assert.equal(assistantText, "old");
});

test("aborting while microphone permission is pending cleans up the late stream", async () => {
    let resolvePermission;
    const permission = new Promise((resolve) => { resolvePermission = resolve; });
    const track = { stopped: false, stop() { this.stopped = true; } };

    global.document = { createElement: () => ({ pause() {}, srcObject: null }) };
    Object.defineProperty(global, "navigator", {
        configurable: true,
        value: { mediaDevices: { getUserMedia: () => permission } },
    });
    global.RTCPeerConnection = class {
        close() { this.connectionState = "closed"; }
    };

    delete require.cache[modulePath];
    const { startRealtimeVoiceSession } = require(modulePath);
    const controller = new AbortController();
    const start = startRealtimeVoiceSession({ signal: controller.signal });
    controller.abort();
    resolvePermission({ getTracks: () => [track] });

    await assert.rejects(start, { name: "AbortError" });
    assert.equal(track.stopped, true);
});

process.on("exit", () => rmSync(output, { recursive: true, force: true }));
