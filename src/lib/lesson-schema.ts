const string = { type: "string" };
const ref = { type: "object", properties: { materialId: string, index: { type: "integer" }, label: string }, required: ["materialId", "index", "label"], additionalProperties: false };
export const lessonJsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    title: string, summary: string, durationMinutes: { type: "integer" },
    segments: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: string, explanation: string, sourceRefs: { type: "array", items: ref } }, required: ["title", "explanation", "sourceRefs"] } },
    quiz: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: string, options: { type: "array", items: string }, correctIndex: { type: "integer" }, explanation: string }, required: ["question", "options", "correctIndex", "explanation"] } },
  }, required: ["title", "summary", "durationMinutes", "segments", "quiz"],
};
export const chatJsonSchema = { type: "object", additionalProperties: false, properties: { content: string, sourceRefs: { type: "array", items: ref } }, required: ["content", "sourceRefs"] };
