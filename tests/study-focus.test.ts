import assert from "node:assert/strict";
import { test } from "node:test";
import { focusContextDescription, getSegmentKeyPoints, parseStudyFocus, studyFocusTool } from "../src/lib/study-focus";
import { lessonJsonSchema } from "../src/lib/lesson-schema";
import { lessonContentSchema } from "../src/lib/validation";
import type { Lesson } from "../src/lib/types";

const materialId = "4a174b24-149f-4c5a-a42d-2ff029c97532";
const foreignMaterialId = "cc6d6b75-a511-4b8a-ae32-c584608d78eb";
const lesson: Lesson = {
  id: "27f112ad-74c8-4646-a07c-4581f290ff0c", title: "MOSFET", summary: "Điện áp cổng điều khiển dòng điện.",
  durationMinutes: 15, materialIds: [materialId, foreignMaterialId], createdAt: "2026-10-12T00:00:00Z",
  segments: [
    { title: "Cấu tạo", explanation: "MOSFET có ba cực cổng, nguồn và máng. Điện áp cổng điều khiển kênh dẫn.", keyPoints: ["Ba cực cổng, nguồn và máng", "Điện áp cổng điều khiển kênh dẫn"], sourceRefs: [{ materialId, index: 3, label: "Slide 3" }] },
    { title: "Vùng hoạt động", explanation: "Vùng bão hòa được xác định từ điều kiện điện áp. Cần đối chiếu thông số trong tài liệu.", sourceRefs: [{ materialId: foreignMaterialId, index: 4, label: "Slide 4" }] },
  ],
  quiz: [{ question: "Cực nào điều khiển kênh?", options: ["Cổng", "Nguồn", "Máng", "Vỏ"], correctIndex: 0, explanation: "Điện áp cổng điều khiển kênh." }],
};
const args = (overrides: Record<string, unknown> = {}) => ({ pointIndex: 1, materialId, index: 3, cue: "Chú ý điện áp ở cực cổng.", ...overrides });

test("study focus accepts only existing current-part key points and canonical source labels", () => {
  const focus = parseStudyFocus(args(), lesson, 0);
  assert.deepEqual(focus, { pointIndex: 1, cue: "Chú ý điện áp ở cực cổng.", sourceRef: { materialId, index: 3, label: "Slide 3" } });
  assert.notEqual(focus?.sourceRef, lesson.segments[0].sourceRefs[0]);
  assert.deepEqual(parseStudyFocus(args({ materialId: null, index: null, pointIndex: null, cue: "  Nhìn vào ba cực của transistor.  " }), lesson, 0), { pointIndex: null, cue: "Nhìn vào ba cực của transistor." });
});

test("study focus rejects out-of-range points, foreign sources, partial source pairs and invalid parts", () => {
  for (const pointIndex of [-1, 2, 0.5, NaN, Infinity, "1"]) assert.equal(parseStudyFocus(args({ pointIndex }), lesson, 0), null);
  for (const changed of [{ materialId: foreignMaterialId, index: 4 }, { index: 999 }, { materialId: null }, { index: null }, { materialId: "bad-uuid" }, { index: "3" }, { index: 0 }, { index: 3.5 }]) assert.equal(parseStudyFocus(args(changed), lesson, 0), null);
  for (const part of [-1, 2, 0.5, NaN]) assert.equal(parseStudyFocus(args(), lesson, part), null);
});

test("study focus rejects unknown, inherited, missing and accessor arguments without evaluating getters", () => {
  assert.equal(parseStudyFocus({ ...args(), completed: true }, lesson, 0), null);
  assert.equal(parseStudyFocus({ pointIndex: 1, cue: "Chú ý" }, lesson, 0), null);
  assert.equal(parseStudyFocus(Object.create(args()), lesson, 0), null);
  assert.equal(parseStudyFocus(JSON.parse('{"pointIndex":1,"materialId":null,"index":null,"cue":"Chú ý","__proto__":{"completed":true}}'), lesson, 0), null);
  let read = false;
  const unsafe = { ...args() };
  Object.defineProperty(unsafe, "cue", { enumerable: true, get() { read = true; return "Không đọc getter"; } });
  assert.equal(parseStudyFocus(unsafe, lesson, 0), null);
  assert.equal(read, false);
  assert.equal(parseStudyFocus({ ...args(), [Symbol("secret")]: true }, lesson, 0), null);
  for (const invalid of [null, [], "{}", 42]) assert.equal(parseStudyFocus(invalid, lesson, 0), null);
});

test("study focus enforces the cue limit and leaves plain text for escaped UI rendering", () => {
  assert.equal(parseStudyFocus(args({ cue: " " }), lesson, 0), null);
  assert.equal(parseStudyFocus(args({ cue: "a".repeat(181) }), lesson, 0), null);
  assert.equal(parseStudyFocus(args({ cue: 123 }), lesson, 0), null);
  assert.equal(parseStudyFocus(args({ cue: "a".repeat(180) }), lesson, 0)?.cue.length, 180);
  assert.equal(parseStudyFocus(args({ cue: "<img src=x onerror=alert(1)>" }), lesson, 0)?.cue, "<img src=x onerror=alert(1)>");
});

test("repeated focus events do not mutate the lesson or move the selected part", () => {
  const before = JSON.stringify(lesson);
  assert.deepEqual(parseStudyFocus(args(), lesson, 0), parseStudyFocus(args(), lesson, 0));
  assert.equal(JSON.stringify(lesson), before);
  const duplicate = structuredClone(lesson);
  duplicate.segments[0].sourceRefs.push({ materialId, index: 3, label: "Nhãn trùng" });
  assert.equal(parseStudyFocus(args(), duplicate, 0)?.sourceRef?.label, "Slide 3");
  assert.equal(parseStudyFocus(args(), lesson, 1), null);
});

test("legacy lessons get at most five short source excerpts without added facts", () => {
  const old = { ...lesson.segments[0], keyPoints: undefined, explanation: "Câu một mô tả cực cổng.\n- Câu hai mô tả cực nguồn. Câu ba mô tả cực máng. Câu bốn mô tả kênh. Câu năm mô tả điện áp. Câu sáu mô tả dòng điện." };
  assert.deepEqual(getSegmentKeyPoints(old), ["Câu một mô tả cực cổng.", "Câu hai mô tả cực nguồn.", "Câu ba mô tả cực máng.", "Câu bốn mô tả kênh.", "Câu năm mô tả điện áp."]);
  assert.deepEqual(getSegmentKeyPoints(lesson.segments[0]), lesson.segments[0].keyPoints);
  const long = "Điện áp cổng " + "điều khiển kênh dẫn ".repeat(20);
  const excerpt = getSegmentKeyPoints({ ...old, explanation: long })[0];
  assert.ok(excerpt.length <= 180);
  assert.ok(long.startsWith(excerpt.slice(0, -1)));
  assert.ok(excerpt.endsWith("…"));
  assert.deepEqual(getSegmentKeyPoints({ ...old, explanation: "", title: "Cấu tạo" }), ["Cấu tạo"]);
});

test("new lesson schemas require bounded key points while validation accepts older saved lessons", () => {
  const generatedSegment = lessonJsonSchema.properties.segments.items;
  assert.ok(generatedSegment.required.includes("keyPoints"));
  assert.equal(generatedSegment.properties.keyPoints.minItems, 1);
  assert.equal(generatedSegment.properties.keyPoints.maxItems, 5);
  assert.ok(lessonContentSchema.safeParse(lesson).success);
  for (const keyPoints of [[], Array.from({ length: 6 }, () => "Ý"), [" "], ["a".repeat(181)]]) {
    assert.equal(lessonContentSchema.safeParse({ ...lesson, segments: [{ ...lesson.segments[0], keyPoints }] }).success, false);
  }
});

test("focus tool contract matches validated arguments and describes only the active part", () => {
  assert.equal(studyFocusTool.name, "set_study_focus");
  assert.equal(studyFocusTool.parameters.additionalProperties, false);
  assert.deepEqual(studyFocusTool.parameters.required, ["pointIndex", "materialId", "index", "cue"]);
  const context = focusContextDescription(lesson, 0);
  assert.match(context, /"pointIndex":0/);
  assert.match(context, /Slide 3/);
  assert.ok(!context.includes(foreignMaterialId));
  assert.match(focusContextDescription(lesson, 9), /Không gọi set_study_focus/);
});
