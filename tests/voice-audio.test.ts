import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { base64ToBytes, bytesToBase64, pcm16ToFloat32, PCM_WORKLET_SOURCE } from "../src/lib/gemini-audio";
import { fitOpenAiVoiceVisual, geminiVisualParts, normalizeVoiceVisuals, openAiVisualEvent } from "../src/lib/voice-context";

test("PCM encoding preserves signs, little endian order, view offsets and base64 round trips", () => {
  const bytes = new Uint8Array([99, 0, 128, 255, 127, 0, 0, 99]);
  assert.deepEqual([...pcm16ToFloat32(bytes.subarray(1, 7))], [-1, 32767 / 32768, 0]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.throws(() => pcm16ToFloat32(new Uint8Array(3)), /byte length/);
});

test("microphone worklet keeps real time across 44.1/48 kHz render blocks and emits silent local output", () => {
  for (const sampleRate of [16000, 44100, 48000]) {
    let Processor: any;
    class AudioWorkletProcessor {
      port = { postMessage: (buffer: ArrayBuffer) => packets.push(new Uint8Array(buffer)), onmessage: null as any };
    }
    const packets: Uint8Array[] = [];
    vm.runInNewContext(PCM_WORKLET_SOURCE, { sampleRate, AudioWorkletProcessor, Uint8Array, DataView, Math, registerProcessor: (_: string, value: any) => { Processor = value; } });
    const worklet = new Processor();
    let processed = 0;
    while (processed < sampleRate) {
      const size = Math.min(128, sampleRate - processed);
      const output = new Float32Array(size).fill(1);
      // Two channels average to 0.5; the microphone must never loop to speakers.
      assert.equal(worklet.process([[new Float32Array(size).fill(1), new Float32Array(size)]], [[output]]), true);
      assert.ok(output.every(sample => sample === 0));
      processed += size;
    }
    const count = packets.reduce((sum, packet) => sum + packet.byteLength / 2, 0) + worklet.cursor;
    assert.equal(count, 16000, `${sampleRate} Hz input must produce one second at 16 kHz`);
    assert.equal(packets.length, 15);
    assert.ok(pcm16ToFloat32(packets[0]).every(sample => Math.abs(sample - 0.5) < 0.0001));
    worklet.port.onmessage({ data: { reset: true } });
    assert.equal(worklet.cursor, 0);
    assert.equal(worklet.weight, 0);
  }
});

test("voice context transmits source image bytes without third-party URLs and labels both providers", () => {
  const image = { dataUrl: "data:image/png;base64,AQIDBA==", label: "Trang 3 · hình transistor" };
  const visuals = normalizeVoiceVisuals([image, { dataUrl: "https://example.com/image.png", label: "remote" }, { dataUrl: "data:text/html;base64,AQIDBA==", label: "html" }, { dataUrl: "data:image/jpeg;base64," + "A".repeat(150001), label: "large" }]);
  assert.deepEqual(visuals, [image]);
  const event = openAiVisualEvent(image) as any;
  assert.equal(event.type, "conversation.item.create");
  assert.equal(event.item.content[1].type, "input_image");
  assert.equal(event.item.content[1].image_url, image.dataUrl);
  assert.match(event.item.content[0].text, /Trang 3/);
  const parts = geminiVisualParts(visuals);
  assert.equal(parts[1].inlineData?.mimeType, "image/png");
  assert.deepEqual([...base64ToBytes(parts[1].inlineData!.data!)], [1, 2, 3, 4]);
});

test("OpenAI voice images adapt to the negotiated message limit and release decoded image resources", async t => {
  const target = globalThis as any;
  const originalBitmap = target.createImageBitmap;
  const originalDocument = target.document;
  let closed = 0;
  let renders = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage() { renders++; } }),
    toDataURL() { return "data:image/jpeg;base64," + "A".repeat(this.width * 100); },
  };
  target.createImageBitmap = async () => ({ width: 1000, height: 600, close() { closed++; } });
  target.document = { createElement: () => canvas };
  t.after(() => {
    if (originalBitmap === undefined) delete target.createImageBitmap; else target.createImageBitmap = originalBitmap;
    if (originalDocument === undefined) delete target.document; else target.document = originalDocument;
  });
  const visual = { dataUrl: "data:image/png;base64," + "A".repeat(120000), label: "Hình transistor" };
  const fitted = await fitOpenAiVoiceVisual(visual, 64000);
  assert.ok(fitted);
  assert.match(fitted.dataUrl, /^data:image\/jpeg/);
  assert.ok(new TextEncoder().encode(JSON.stringify(openAiVisualEvent(fitted))).length <= 64000);
  assert.ok(renders >= 2);
  assert.equal(closed, 1);
  assert.equal(await fitOpenAiVoiceVisual(visual, 100), null);
  assert.equal(closed, 2);
});
