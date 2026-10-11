import { z } from "zod";
import { getNotebookUrl } from "./notebook";

export const idSchema = z.string().uuid();
export const settingsSchema = z.object({
  subject: z.string().trim().min(1, "Nhập tên môn học.").max(120),
  level: z.string().trim().max(120),
  goal: z.string().trim().max(1200),
  notebookUrl: z.string().trim().max(600).refine((value) => !value || Boolean(getNotebookUrl(value)), "Dán đường link NotebookLM của Google (notebooklm.google.com, notebooklm.google hoặc notebook.google.com).").transform(value => value ? getNotebookUrl(value)! : ""),
});
export const unitsSchema = z.array(z.object({
  index: z.number().int().min(1).max(200),
  label: z.string().max(40), text: z.string().max(100000),
  images: z.array(z.object({
    id: z.string().min(1).max(160), label: z.string().min(1).max(500),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    dataUrl: z.string().max(150000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(3000), height: z.number().int().min(1).max(3000),
  }).superRefine((image, ctx) => {
    if (!image.dataUrl.startsWith(`data:${image.mimeType};base64,`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Định dạng hình chưa hợp lệ." });
  })).max(6).optional(),
  visualNotice: z.string().max(4000).optional(),
})).min(1).max(200).superRefine((units, ctx) => {
  if (units.reduce((sum, unit) => sum + unit.text.length, 0) > 500000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Học liệu quá dài. Hãy chia thành từng chương." });
  if (!units.some(unit => unit.text.trim().length >= 20 || unit.images?.length)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Chưa đọc được nội dung hoặc hình ảnh trong học liệu." });
  if (units.reduce((sum, unit) => sum + (unit.images || []).reduce((size, image) => size + image.dataUrl.length, 0), 0) > 10 * 1024 * 1024) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Hình trong học liệu quá lớn. Hãy chia học liệu theo chương." });
  if (new Set(units.map(unit => unit.index)).size !== units.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Số trang hoặc slide bị trùng." });
});
export const sourceRefSchema = z.object({ materialId: idSchema, index: z.number().int().positive(), label: z.string().max(80) });
export const illustrationSchema = z.object({
  title: z.string().min(1).max(180), description: z.string().min(1).max(3000),
  nodes: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(120) })).min(2).max(10),
  edges: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: z.string().max(160) })).max(16),
}).superRefine((diagram, ctx) => {
  const ids = new Set(diagram.nodes.map(node => node.id));
  if (ids.size !== diagram.nodes.length || diagram.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Sơ đồ có mối liên hệ chưa hợp lệ." });
});
export const lessonContentSchema = z.object({
  title: z.string().min(1).max(180), summary: z.string().max(1000), durationMinutes: z.number().int().min(1).max(90),
  segments: z.array(z.object({ title: z.string().min(1).max(180), explanation: z.string().min(20).max(7000), sourceRefs: z.array(sourceRefSchema).min(1).max(5), illustration: illustrationSchema.nullable().optional() })).min(1).max(8),
  quiz: z.array(z.object({ question: z.string().min(1).max(1000), options: z.array(z.string().min(1).max(400)).length(4), correctIndex: z.number().int().min(0).max(3), explanation: z.string().max(1600) })).min(1).max(5),
});
