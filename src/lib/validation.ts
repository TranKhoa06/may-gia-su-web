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
})).min(1).max(200).superRefine((units, ctx) => {
  if (units.reduce((sum, unit) => sum + unit.text.length, 0) > 500000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Học liệu quá dài. Hãy chia thành từng chương." });
  if (!units.some(unit => unit.text.trim().length >= 20)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Chưa đọc được nội dung văn bản trong học liệu." });
  if (new Set(units.map(unit => unit.index)).size !== units.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Số trang hoặc slide bị trùng." });
});
export const sourceRefSchema = z.object({ materialId: idSchema, index: z.number().int().positive(), label: z.string().max(80) });
export const lessonContentSchema = z.object({
  title: z.string().min(1).max(180), summary: z.string().max(1000), durationMinutes: z.number().int().min(1).max(90),
  segments: z.array(z.object({ title: z.string().min(1).max(180), explanation: z.string().min(20).max(7000), sourceRefs: z.array(sourceRefSchema).min(1).max(5) })).min(1).max(8),
  quiz: z.array(z.object({ question: z.string().min(1).max(1000), options: z.array(z.string().min(1).max(400)).length(4), correctIndex: z.number().int().min(0).max(3), explanation: z.string().max(1600) })).min(1).max(5),
});
