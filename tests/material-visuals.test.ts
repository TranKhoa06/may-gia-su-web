import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCanvasImage, MAX_VISUAL_DATA_CHARACTERS, MAX_VISUALS_PER_DOCUMENT } from "../src/lib/material-visuals";
import { chatJsonSchema, lessonJsonSchema, illustrationJsonSchema } from "../src/lib/lesson-schema";

const prefix = "data:image/jpeg;base64,";

test("page images reduce JPEG quality until the complete data URL fits its allowance", () => {
  const qualities: number[] = [];
  const canvas = { width: 850, height: 1100, toDataURL(mime: string, quality: number) {
    assert.equal(mime, "image/jpeg"); qualities.push(quality);
    return prefix + "A".repeat(quality >= 0.68 ? 80_000 : 30_000);
  } } as unknown as HTMLCanvasElement;
  const result = fitCanvasImage(canvas, 50_000, "page-1", "Trang ảnh quét");
  assert.deepEqual(qualities, [0.84, 0.68, 0.5]);
  assert.ok(result.dataUrl.length <= 50_000);
  assert.equal(result.mimeType, "image/jpeg"); assert.equal(result.width, 850); assert.equal(result.height, 1100);
  assert.equal(result.label, "Trang ảnh quét");
});

test("oversized pictures are resized when changing JPEG quality is insufficient", t => {
  const originalDocument = globalThis.document;
  t.after(() => { globalThis.document = originalDocument; });
  const created: HTMLCanvasElement[] = [];
  globalThis.document = { createElement(tag: string) {
    assert.equal(tag, "canvas");
    const fake = { width: 0, height: 0,
      getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
      toDataURL() { return prefix + "A".repeat(Math.ceil(fake.width * fake.height * 0.2)); },
    };
    const canvas = fake as unknown as HTMLCanvasElement;
    created.push(canvas); return canvas;
  } } as unknown as Document;
  const original = { width: 1100, height: 1100, toDataURL: () => prefix + "A".repeat(250_000) } as unknown as HTMLCanvasElement;
  const result = fitCanvasImage(original, 60_000, "image-1", "Mạch điện");
  assert.ok(result.width < original.width); assert.ok(result.dataUrl.length <= 60_000);
  assert.ok(created.length >= 2); assert.ok(created.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(original.width, 1100);
});

test("200 page allowances guarantee total visual storage remains bounded", () => {
  const allowance = Math.min(150_000, Math.floor(MAX_VISUAL_DATA_CHARACTERS / MAX_VISUALS_PER_DOCUMENT));
  assert.ok(allowance >= 4_096);
  assert.ok(allowance * MAX_VISUALS_PER_DOCUMENT <= 10 * 1024 * 1024);
  assert.throws(() => fitCanvasImage({} as HTMLCanvasElement, 1_000, "x", "x"), /Không đủ dung lượng/);
});

test("lesson and chat illustrations only allow bounded text nodes and edges, with nullable compatibility", () => {
  assert.equal(lessonJsonSchema.properties.segments.items.properties.illustration, illustrationJsonSchema);
  assert.equal(chatJsonSchema.properties.illustration, illustrationJsonSchema);
  assert.ok(chatJsonSchema.required.includes("illustration"));
  const diagram = illustrationJsonSchema.anyOf[0];
  assert.equal(diagram.additionalProperties, false);
  assert.deepEqual(Object.keys(diagram.properties ?? {}), ["title", "description", "nodes", "edges"]);
  assert.equal(diagram.properties?.nodes.maxItems, 10); assert.equal(diagram.properties?.edges.maxItems, 16);
  assert.equal(illustrationJsonSchema.anyOf[1].type, "null");
});
