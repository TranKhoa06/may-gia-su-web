import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { openBrowserStorage } from "../src/lib/browser-storage";
import { collectSources } from "../src/lib/client-api";
import { createGeminiPayload, defaultAiPreferences, generateTutorText } from "../src/lib/browser-ai";
import { illustrationSchema, unitsSchema } from "../src/lib/validation";
import type { SourceImage } from "../src/lib/types";

const image: SourceImage = { id: "circuit", label: "Mạch bán dẫn", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=", width: 20, height: 20 };
test("scan-only source images persist and enter grounded multimodal prompts", async t => {
  const storage = await openBrowserStorage(`visual-${crypto.randomUUID()}`); t.after(() => storage.close());
  const course = await storage.addCourse({ subject: "Mạch điện", level: "Đại học", goal: "Đọc mạch", notebookUrl: "" });
  const id = crypto.randomUUID();
  const units = unitsSchema.parse([{ index: 1, label: "Trang 1", text: "", images: [image] }]);
  await storage.addMaterial(course.id, { id, name: "Mạch.pdf", type: "pdf", unitCount: 1, characters: 0, createdAt: new Date().toISOString() }, units, new Blob(["%PDF-test"]));
  const sources = await collectSources(storage, [id]);
  assert.equal(sources.images.length, 1); assert.equal(sources.refs[0].index, 1);
  assert.match(sources.images[0].label, new RegExp(id));
  const input = { instructions: "Giải thích hình", messages: [{ role: "user" as const, content: sources.text, images: sources.images }], schema: { type: "object" }, schemaName: "answer", maxOutputTokens: 1000 };
  const gemini = createGeminiPayload(input);
  assert.deepEqual(gemini.contents[0].parts[2], { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } });
  await storage.setProviderKey("openai", "synthetic-test-key");
  await storage.setAiPreferences({ ...defaultAiPreferences(), provider: "openai" });
  await generateTutorText(storage, input, async (_url, init) => {
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.input[0].content[2].type, "input_image");
    assert.equal(payload.input[0].content[2].image_url, image.dataUrl);
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "{}" }] }] });
  });
});

test("visual validation rejects remote images and invalid diagram relationships", () => {
  assert.throws(() => unitsSchema.parse([{ index: 1, label: "Trang 1", text: "", images: [{ ...image, dataUrl: "https://example.com/circuit.png" }] }]));
  assert.throws(() => unitsSchema.parse([{ index: 1, label: "Trang 1", text: "", images: [{ ...image, mimeType: "image/jpeg" }] }]));
  const diagram = { title: "Dòng điện", description: "Hạt tải dịch chuyển tạo dòng điện", nodes: [{ id: "carrier", label: "Hạt tải" }, { id: "current", label: "Dòng điện" }], edges: [{ from: "carrier", to: "current", label: "Tạo ra" }] };
  assert.deepEqual(illustrationSchema.parse(diagram), diagram);
  assert.throws(() => illustrationSchema.parse({ ...diagram, edges: [{ from: "missing", to: "current", label: "Sai" }] }));
});
