const string = { type: "string" };
const ref = { type: "object", properties: { materialId: string, index: { type: "integer" }, label: string }, required: ["materialId", "index", "label"], additionalProperties: false };
export const illustrationJsonSchema = {
  anyOf: [
    { type: "object", additionalProperties: false, properties: {
      title: string, description: string,
      nodes: { type: "array", minItems: 2, maxItems: 10, items: { type: "object", additionalProperties: false, properties: { id: string, label: string }, required: ["id", "label"] } },
      edges: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, properties: { from: string, to: string, label: string }, required: ["from", "to", "label"] } },
    }, required: ["title", "description", "nodes", "edges"] },
    { type: "null" },
  ],
};
export const lessonJsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    title: string, summary: string, durationMinutes: { type: "integer" },
    segments: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: string, explanation: string, sourceRefs: { type: "array", items: ref }, illustration: illustrationJsonSchema }, required: ["title", "explanation", "sourceRefs", "illustration"] } },
    quiz: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: string, options: { type: "array", items: string }, correctIndex: { type: "integer" }, explanation: string }, required: ["question", "options", "correctIndex", "explanation"] } },
  }, required: ["title", "summary", "durationMinutes", "segments", "quiz"],
};
export const chatJsonSchema = { type: "object", additionalProperties: false, properties: { content: string, sourceRefs: { type: "array", items: ref }, illustration: illustrationJsonSchema }, required: ["content", "sourceRefs", "illustration"] };
