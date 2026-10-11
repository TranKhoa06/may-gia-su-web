import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonDiagram, SourceImages } from "../src/app/components/lesson-visuals";
import type { LessonIllustration, SourceImage } from "../src/lib/types";

test("lesson diagram renders node relationships and escapes untrusted labels", () => {
  const illustration: LessonIllustration = {
    title: "Điện tử và lỗ trống", description: "Điện tử chuyển động tạo dòng điện.",
    nodes: [{ id: "a", label: "<script>alert(1)</script>" }, { id: "b", label: "Dòng điện" }],
    edges: [{ from: "a", to: "b", label: "tạo ra" }],
  };
  const html = renderToStaticMarkup(createElement(LessonDiagram, { illustration }));
  assert.match(html, /<svg/);
  assert.match(html, /marker-end=/);
  assert.match(html, /Điện tử chuyển động tạo dòng điện/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("source figure blocks SVG and script URLs while rendering safe raster images and notices", () => {
  const common = { id: "one", label: "Hình nguồn", mimeType: "image/png" as const, width: 20, height: 20 };
  const images: SourceImage[] = [
    { ...common, dataUrl: "data:image/png;base64,aGVsbG8=" },
    { ...common, id: "two", dataUrl: "data:image/svg+xml;base64,aGVsbG8=" },
    { ...common, id: "three", dataUrl: "javascript:alert(1)" },
  ];
  const html = renderToStaticMarkup(createElement(SourceImages, { images, label: "Slide 1", notice: "Cần xem bản gốc để đọc biểu đồ." }));
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.match(html, /data:image\/png;base64,aGVsbG8=/);
  assert.doesNotMatch(html, /javascript:|image\/svg/);
  assert.match(html, /Cần xem bản gốc/);
});

test("lesson diagram renders all ten schema nodes and sixteen full relationships", () => {
  const illustration: LessonIllustration = {
    title: "Chuỗi kiến thức", description: "Các bước liên hệ với nhau.",
    nodes: Array.from({ length: 10 }, (_, index) => ({ id: `node-${index}`, label: `Kiến thức đầy đủ số ${index}` })),
    edges: Array.from({ length: 16 }, (_, index) => ({ from: `node-${index % 10}`, to: `node-${(index + 1) % 10}`, label: `Quan hệ đầy đủ rất dài cần đọc chi tiết số ${index}` })),
  };
  const html = renderToStaticMarkup(createElement(LessonDiagram, { illustration }));
  assert.equal((html.match(/<rect /g) || []).length, 10);
  assert.equal((html.match(/marker-end=/g) || []).length, 16);
  assert.equal((html.match(/<li>/g) || []).length, 16);
  assert.match(html, /Các quan hệ trong sơ đồ/);
  assert.match(html, /Kiến thức đầy đủ số 9/);
  assert.match(html, /Quan hệ đầy đủ rất dài cần đọc chi tiết số 15/);
});
