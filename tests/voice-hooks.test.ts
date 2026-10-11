import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";

// Run the real hook source against deterministic browser/provider interfaces.
// This checks state and cleanup without opening a microphone or spending API credit.
function hookHarness(globals: Record<string, unknown>, apiFetch: (path: string, init?: RequestInit) => Promise<Response>) {
  const slots: any[] = [];
  let cursor = 0;
  const pending: (() => void)[] = [];
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      return [slots[index].value, (next: unknown) => { slots[index].value = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index].value) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect: () => unknown, deps?: unknown[]) {
      const index = cursor++;
      if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps, cleanup: null };
      pending.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const cache = new Map<string, any>();
  function load(name: string): any {
    if (name === "react") return react;
    if (name === "./client-api") return { apiFetch };
    if (name === "@google/genai") return globals.googleGenAI;
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    cache.set(name, module.exports);
    const source = readFileSync(new URL(`../src/lib/${name.replace(/^\.\//, "")}.ts`, import.meta.url), "utf8");
    const compiled = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(compiled, { ...globals, module, exports: module.exports, require: load, console, setTimeout, clearTimeout, AbortController, TextEncoder, crypto, URL, Blob, ArrayBuffer, Uint8Array, Float32Array, DataView, Math, btoa, atob });
    return module.exports;
  }
  return {
    load,
    render(name: string, exportName: string, options: unknown) {
      cursor = 0;
      const result = load(name)[exportName](options);
      while (pending.length) pending.shift()!();
      return result;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

const image = { dataUrl: "data:image/png;base64,AQIDBA==", label: "Trang 1" };
const lesson = {
  id: "voice-test-lesson", title: "Transistor", segments: [
    { title: "Cấu trúc", explanation: "Một transistor gồm các cực.", sourceRefs: [], illustration: { description: "Cực G điều khiển dòng giữa D và S." } },
    { title: "Hoạt động", explanation: "Điện trường điều khiển dòng hạt tải.", sourceRefs: [], illustration: { description: "Mũi tên chỉ dòng điện." } },
  ],
};

test("OpenAI voice starts with images, refreshes the selected part, handles cancellation and releases microphone", async t => {
  const calls: { path: string; body: any }[] = [];
  const events: any[] = [];
  const messages: any[] = [];
  const errors: string[] = [];
  let trackStopped = 0;
  let audioRemoved = 0;
  const track = { enabled: true, onended: null, stop() { trackStopped++; } };
  const microphone = { getAudioTracks: () => [track], getTracks: () => [track] };
  let peer: any;
  class Peer {
    sctp = { maxMessageSize: 262144 };
    connectionState = "new";
    channel = { readyState: "connecting", onopen: null as any, onmessage: null as any, onclose: null as any, onerror: null as any, send: (value: string) => events.push(JSON.parse(value)), close() { this.readyState = "closed"; } };
    constructor() { peer = this; }
    createDataChannel() { return this.channel; }
    addTrack() {}
    getReceivers() { return []; }
    createOffer() { return Promise.resolve({ sdp: "test-offer" }); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription(value: any) { assert.equal(value.sdp, "test-answer"); this.channel.readyState = "open"; return Promise.resolve(); }
    close() { this.connectionState = "closed"; }
  }
  const apiFetch = async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    if (path === "/api/voice/session") return Response.json({ value: "ephemeral-test-only", model: "gpt-realtime", provider: "openai", visualContext: [image] });
    if (path === "/api/voice/context") return Response.json({ instructions: "Nguồn phần Hoạt động", visualContext: [{ ...image, label: "Trang 2" }] });
    return Response.json({});
  };
  const harness = hookHarness({
    googleGenAI: {}, RTCPeerConnection: Peer,
    navigator: { mediaDevices: { getUserMedia: async () => microphone } },
    document: { createElement: () => ({ srcObject: null, autoplay: false, setAttribute() {}, play: async () => {}, pause() {}, remove() { audioRemoved++; } }) },
    fetch: async (url: string, init: RequestInit) => { assert.equal(url, "https://api.openai.com/v1/realtime/calls"); assert.equal((init.headers as any).Authorization, "Bearer ephemeral-test-only"); return new Response("test-answer"); },
  }, apiFetch);
  t.after(() => harness.unmount());
  const options = { provider: "openai", lesson, segmentIndex: 0, onMessage: (message: any) => messages.push(message), onError: (message: string) => errors.push(message) };
  let voice = harness.render("./use-voice-tutor", "useVoiceTutor", options);
  await voice.start();
  await peer.channel.onopen();
  voice = harness.render("./use-voice-tutor", "useVoiceTutor", options);
  assert.equal(voice.connected, true);
  assert.equal(voice.connecting, false);
  assert.equal(events[0].item.content[1].type, "input_image");
  assert.match(events[1].item.content[0].text, /Cực G/);
  assert.equal(events[2].type, "response.create");
  voice.toggleMute(); assert.equal(track.enabled, false);
  voice.toggleMute(); assert.equal(track.enabled, true);
  options.segmentIndex = 1;
  voice = harness.render("./use-voice-tutor", "useVoiceTutor", options);
  await voice.ask("Vì sao dòng điện thay đổi?");
  assert.equal(calls.filter(call => call.path === "/api/voice/context").length, 1);
  assert.match(events.find(event => event.item?.content?.[0]?.text?.includes("Cập nhật"))?.item.content[0].text, /Hoạt động/);
  assert.ok(events.some(event => event.type === "response.cancel"));
  peer.channel.onmessage({ data: JSON.stringify({ type: "response.done", response: { status: "cancelled" } }) });
  assert.equal(events.at(-1).type, "response.create");
  peer.channel.onmessage({ data: JSON.stringify({ type: "response.output_audio_transcript.done", item_id: "answer1", transcript: "Điện trường làm thay đổi kênh dẫn." }) });
  peer.channel.onmessage({ data: JSON.stringify({ type: "response.output_audio_transcript.done", item_id: "answer1", transcript: "Điện trường làm thay đổi kênh dẫn." }) });
  assert.equal(messages.filter(message => message.role === "assistant").length, 1);
  assert.equal(calls.filter(call => call.path === "/api/voice/transcript").length, 2);
  options.provider = "gemini";
  voice = harness.render("./use-voice-tutor", "useVoiceTutor", options);
  assert.equal(voice.connected, false);
  assert.equal(trackStopped, 1); assert.equal(audioRemoved, 1); assert.equal(peer.connectionState, "closed");
  assert.deepEqual(errors, []);
});

test("voice preserves actionable configuration errors and releases resources when setup fails", async t => {
  let stopped = 0;
  let closed = 0;
  const errors: string[] = [];
  const track = { onended: null, stop() { stopped++; } };
  class Peer {
    createDataChannel() { return { readyState: "connecting", close() {} }; }
    addTrack() {}
    getReceivers() { return []; }
    close() { closed++; }
  }
  const message = "Hãy nhập khóa API trong Cài đặt để bật gia sư. Thêm link NotebookLM chưa bật AI cho web.";
  const harness = hookHarness({
    googleGenAI: {}, RTCPeerConnection: Peer,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    document: { createElement: () => ({ srcObject: null, setAttribute() {}, play: async () => {}, pause() {}, remove() {} }) },
  }, async () => Response.json({ error: message }, { status: 503 }));
  t.after(() => harness.unmount());
  const options = { provider: "openai", lesson, segmentIndex: 0, onMessage() {}, onError: (message: string) => errors.push(message) };
  const voice = harness.render("./use-voice-tutor", "useVoiceTutor", options);
  await voice.start();
  assert.deepEqual(errors, [message]);
  assert.equal(stopped, 1); assert.equal(closed, 1);
  assert.equal(harness.render("./use-voice-tutor", "useVoiceTutor", options).connecting, false);
});

test("Gemini voice sends image context before speech, interrupts playback, refreshes sources and closes resources", async t => {
  const calls: { path: string; body: any }[] = [];
  const turns: any[] = [];
  const messages: any[] = [];
  const errors: string[] = [];
  const contexts: any[] = [];
  let callback: any;
  let liveClosed = 0;
  let trackStopped = 0;
  let outputStopped = 0;
  const track = { enabled: true, onended: null, stop() { trackStopped++; } };
  const microphone = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Context {
    currentTime = 0; state = "running"; destination = {}; audioWorklet = { addModule: async () => {} };
    constructor() { contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(_: number, length: number, sampleRate: number) { return { duration: length / sampleRate, copyToChannel() {} }; }
    createBufferSource() { return { buffer: null, onended: null, connect() {}, disconnect() {}, start() {}, stop() { outputStopped++; } }; }
  }
  class Worklet { port = { onmessage: null, close() {}, postMessage() {} }; connect() {} disconnect() {} }
  const live = { sendClientContent: (turn: any) => turns.push(turn), sendRealtimeInput: (value: any) => turns.push({ realtime: value }), close() { liveClosed++; } };
  class GoogleGenAI {
    live = { connect: async (input: any) => { assert.equal(input.model, "gemini-3.8-live"); callback = input.callbacks; return live; } };
  }
  const apiFetch = async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    if (path === "/api/voice/session") return Response.json({ value: "ephemeral-test-only", model: "gemini-3.8-live", provider: "gemini", visualContext: [image] });
    if (path === "/api/voice/context") return Response.json({ instructions: "Nguồn phần Hoạt động", visualContext: [{ ...image, label: "Trang 2" }] });
    return Response.json({});
  };
  const harness = hookHarness({ googleGenAI: { GoogleGenAI, Modality: { AUDIO: "AUDIO" } }, navigator: { mediaDevices: { getUserMedia: async () => microphone } }, AudioContext: Context, AudioWorkletNode: Worklet }, apiFetch);
  t.after(() => harness.unmount());
  const options = { lesson, segmentIndex: 0, onMessage: (message: any) => messages.push(message), onError: (message: string) => errors.push(message) };
  let voice = harness.render("./use-gemini-voice-tutor", "useGeminiVoiceTutor", options);
  await voice.start();
  voice = harness.render("./use-gemini-voice-tutor", "useGeminiVoiceTutor", options);
  assert.equal(voice.connected, true);
  assert.equal(turns[0].turns[0].parts[1].inlineData.mimeType, "image/png");
  assert.match(turns[0].turns[0].parts.at(-1).text, /Cực G/);
  callback.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAAAAA==" } }] }, outputTranscription: { text: "Cực G điều khiển kênh." } } });
  voice = harness.render("./use-gemini-voice-tutor", "useGeminiVoiceTutor", options);
  assert.equal(voice.speaking, true);
  callback.onmessage({ serverContent: { interrupted: true } });
  assert.equal(outputStopped, 1);
  assert.equal(messages.filter(message => message.role === "assistant").length, 1);
  voice.toggleMute(); assert.equal(track.enabled, false); assert.equal(turns.at(-1).realtime.audioStreamEnd, true);
  voice.toggleMute(); assert.equal(track.enabled, true);
  options.segmentIndex = 1;
  voice = harness.render("./use-gemini-voice-tutor", "useGeminiVoiceTutor", options);
  await voice.teach();
  assert.equal(calls.filter(call => call.path === "/api/voice/context").length, 1);
  assert.equal(turns.at(-2).turnComplete, false);
  assert.match(turns.at(-2).turns[0].parts[0].text, /Hoạt động/);
  assert.equal(turns.at(-1).turnComplete, true);
  await voice.ask("Giảng lại dễ hiểu hơn.");
  assert.equal(calls.filter(call => call.path === "/api/voice/context").length, 1);
  assert.equal(messages.filter(message => message.role === "user").length, 1);
  voice.stop();
  assert.equal(trackStopped, 1); assert.equal(liveClosed, 1); assert.ok(contexts.every(context => context.state === "closed"));
  assert.deepEqual(errors, []);
});
