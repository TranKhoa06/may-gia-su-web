import { strFromU8, unzipSync } from "fflate";
import type { SourceUnit } from "./types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 30 * 1024 * 1024;
const MAX_UNITS = 200;
const MAX_CHARACTERS = 500_000;
const DRAWING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
]);

class MaterialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialParseError";
  }
}

function fail(message: string): never {
  throw new MaterialParseError(message);
}

function cleanText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[\t\u00a0 ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function checkTextBudget(total: number): void {
  if (total > MAX_CHARACTERS) {
    fail("Học liệu có hơn 500.000 ký tự. Hãy chia tài liệu thành các chương nhỏ rồi tải lại.");
  }
}

async function parsePdf(bytes: Uint8Array): Promise<SourceUnit[]> {
  // Serve the matching worker unchanged, without Vite's window-based HMR code.
  // Import PDF.js lazily so PPTX parsing does not load the PDF renderer.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf-worker/pdf.worker-${pdfjs.version}.min.mjs`;
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
  });
  let pdf: Awaited<typeof task.promise> | undefined;
  try {
    pdf = await task.promise;
    if (pdf.numPages > MAX_UNITS) {
      fail("PDF có hơn 200 trang. Hãy chia tài liệu thành các phần nhỏ rồi tải lại.");
    }
    const units: SourceUnit[] = [];
    let characters = 0;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      try {
        const content = await page.getTextContent();
        let raw = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          raw += item.str + (item.hasEOL ? "\n" : " ");
          // Bound intermediate strings as well as the final normalized text.
          checkTextBudget(characters + raw.length);
        }
        const text = cleanText(raw);
        characters += text.length;
        checkTextBudget(characters);
        if (text) units.push({ index, label: `Trang ${index}`, text });
      } finally {
        page.cleanup();
      }
    }
    if (!units.length) {
      fail("PDF không có văn bản đọc được, có thể là bản quét hoặc chỉ chứa ảnh. Chưa thể tạo bài giảng từ tệp này; hãy dùng PDF có thể chọn chữ hoặc nhận dạng chữ (OCR) trước.");
    }
    return units;
  } finally {
    // This also stops the worker when a password, malformed page, or limit fails.
    await task.destroy();
  }
}

function parseXml(bytes: Uint8Array, name: string): XMLDocument {
  if (typeof DOMParser === "undefined") {
    fail("Hãy mở ứng dụng trong trình duyệt để đọc học liệu PPTX.");
  }
  const text = strFromU8(bytes);
  // Office XML has no legitimate external entities or document type definitions.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("PPTX chứa XML không được hỗ trợ. Hãy lưu lại tệp bằng PowerPoint rồi thử lại.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length || document.getElementsByTagNameNS("*", "parsererror").length) {
    fail(`Không đọc được cấu trúc ${name} trong PPTX. Hãy kiểm tra hoặc lưu lại tệp.`);
  }
  return document;
}

function elements(document: XMLDocument, localName: string): Element[] {
  return Array.from(document.getElementsByTagNameNS("*", localName));
}

function resolvePart(base: string, target: string): string | undefined {
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.includes("\\")) return undefined;
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function relationships(document: XMLDocument, base: string): Map<string, { path: string; type: string }> {
  const result = new Map<string, { path: string; type: string }>();
  for (const relationship of elements(document, "Relationship")) {
    if (relationship.getAttribute("TargetMode") === "External") continue;
    const id = relationship.getAttribute("Id");
    const path = resolvePart(base, relationship.getAttribute("Target") ?? "");
    if (id && path) result.set(id, { path, type: relationship.getAttribute("Type") ?? "" });
  }
  return result;
}

function drawingText(document: XMLDocument): string {
  const paragraphs: string[] = [];
  for (const paragraph of elements(document, "p")) {
    if (!DRAWING_NAMESPACES.has(paragraph.namespaceURI ?? "")) continue;
    // Avoid treating generated slide numbers and date/footer placeholders as notes.
    let shape: Element | null = paragraph.parentElement;
    while (shape && shape.localName !== "sp") shape = shape.parentElement;
    const placeholder = shape?.getElementsByTagNameNS("*", "ph")[0];
    if (["sldNum", "dt", "hdr", "ftr"].includes(placeholder?.getAttribute("type") ?? "")) continue;
    let text = "";
    for (const node of Array.from(paragraph.getElementsByTagName("*"))) {
      if (!DRAWING_NAMESPACES.has(node.namespaceURI ?? "")) continue;
      if (node.localName === "t") text += node.textContent ?? "";
      else if (node.localName === "br") text += "\n";
    }
    if (text.trim()) paragraphs.push(text);
  }
  return cleanText(paragraphs.join("\n"));
}

function parsePptx(bytes: Uint8Array): SourceUnit[] {
  const relevant = (name: string) => /^ppt\/(?:slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|presentation\.xml|_rels\/presentation\.xml\.rels)$/.test(name);
  const names = new Set<string>();
  let declaredSize = 0;
  let entries = 0;
  let slideCount = 0;
  // Inspect the entire central directory before allowing any decompression. Images,
  // embedded files, macros, and other irrelevant ZIP members are never expanded.
  unzipSync(bytes, {
    filter(entry) {
      entries += 1;
      if (entries > 5_000) fail("PPTX chứa quá nhiều thành phần. Hãy chia hoặc lưu lại tài liệu.");
      if (names.has(entry.name)) fail("PPTX có thành phần trùng tên hoặc bị lỗi. Hãy lưu lại tệp rồi thử lại.");
      names.add(entry.name);
      declaredSize += entry.originalSize;
      if (!Number.isSafeInteger(declaredSize) || declaredSize > MAX_EXPANDED_BYTES) {
        fail("PPTX quá lớn sau khi giải nén (giới hạn 30 MB). Hãy chia nhỏ hoặc nén ảnh trong tài liệu.");
      }
      if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)) slideCount += 1;
      if (slideCount > MAX_UNITS) fail("PPTX có hơn 200 slide. Hãy chia tài liệu thành các phần nhỏ rồi tải lại.");
      return false;
    },
  });
  if (!slideCount) fail("Tệp không chứa slide PPTX hợp lệ. Hãy kiểm tra định dạng hoặc lưu lại bằng PowerPoint.");
  const parts = unzipSync(bytes, { filter: (entry) => relevant(entry.name) });
  let expandedSize = 0;
  for (const part of Object.values(parts)) {
    expandedSize += part.byteLength;
    if (expandedSize > MAX_EXPANDED_BYTES) fail("PPTX vượt giới hạn giải nén 30 MB. Hãy chia nhỏ tài liệu.");
  }
  const slidePaths = Object.keys(parts).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  slidePaths.sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)?.[1]) - Number(b.match(/slide(\d+)\.xml$/)?.[1]));
  let orderedPaths = slidePaths;
  if (parts["ppt/presentation.xml"] && parts["ppt/_rels/presentation.xml.rels"]) {
    const presentation = parseXml(parts["ppt/presentation.xml"], "presentation.xml");
    const rels = relationships(parseXml(parts["ppt/_rels/presentation.xml.rels"], "presentation.xml.rels"), "ppt/presentation.xml");
    const ordered: string[] = [];
    for (const slideId of elements(presentation, "sldId")) {
      const relationId = Array.from(slideId.attributes).find((attribute) => attribute.localName === "id" && attribute.namespaceURI)?.value;
      const relationship = relationId ? rels.get(relationId) : undefined;
      if (relationship?.type.endsWith("/slide") && parts[relationship.path] && !ordered.includes(relationship.path)) ordered.push(relationship.path);
    }
    // Fall back to numerical names for nonstandard files with incomplete metadata.
    if (ordered.length === slidePaths.length) orderedPaths = ordered;
  }
  const units: SourceUnit[] = [];
  let characters = 0;
  for (let position = 0; position < orderedPaths.length; position += 1) {
    const path = orderedPaths[position];
    const slideText = drawingText(parseXml(parts[path], path));
    const sourceNumber = path.match(/slide(\d+)\.xml$/)?.[1];
    const slideRelPath = path.replace("slides/", "slides/_rels/") + ".rels";
    let notesPath = `ppt/notesSlides/notesSlide${sourceNumber}.xml`;
    if (parts[slideRelPath]) {
      const rels = relationships(parseXml(parts[slideRelPath], slideRelPath), path);
      // Relationship targets, rather than note filenames, determine which notes
      // belong to a slide after a user has reordered or deleted slides.
      notesPath = Array.from(rels.values()).find((relationship) => relationship.type.endsWith("/notesSlide"))?.path ?? "";
    }
    const noteText = parts[notesPath] ? drawingText(parseXml(parts[notesPath], notesPath)) : "";
    const text = cleanText([slideText, noteText ? `Ghi chú thuyết trình:\n${noteText}` : ""].filter(Boolean).join("\n\n"));
    characters += text.length;
    checkTextBudget(characters);
    if (text) units.push({ index: position + 1, label: `Slide ${position + 1}`, text });
  }
  if (!units.length) {
    fail("PPTX không có văn bản hoặc ghi chú đọc được, có thể chỉ chứa ảnh. Chưa thể tạo bài giảng từ tệp này; hãy thêm nội dung chữ hoặc dùng tài liệu đã nhận dạng chữ (OCR).");
  }
  return units;
}

/** Extract bounded, page/slide-addressable text entirely in the user's browser. */
export async function parseMaterial(file: File): Promise<SourceUnit[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "pptx") fail("Chỉ hỗ trợ học liệu PDF và PPTX. Hãy chọn tệp đúng định dạng.");
  if (!file.size) fail("Tệp học liệu trống. Hãy chọn một tệp PDF hoặc PPTX có nội dung.");
  if (file.size > MAX_FILE_BYTES) fail("Tệp vượt giới hạn 20 MB. Hãy chia tài liệu hoặc giảm dung lượng rồi tải lại.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) fail("Tệp vượt giới hạn 20 MB. Hãy chia nhỏ tài liệu.");
    if (extension === "pdf") {
      const header = new TextDecoder("ascii").decode(bytes.subarray(0, 1024));
      if (!header.includes("%PDF-")) fail("Tệp được chọn không phải PDF hợp lệ. Đổi đuôi tệp không chuyển đổi được định dạng.");
      return await parsePdf(bytes);
    }
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      fail("Tệp được chọn không phải PPTX hợp lệ. Hãy lưu bài trình chiếu ở định dạng .pptx.");
    }
    return parsePptx(bytes);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") fail("PDF được bảo vệ bằng mật khẩu. Hãy xuất một bản PDF không khóa rồi tải lại.");
    if (name === "InvalidPDFException" || name === "MissingPDFException") fail("PDF bị lỗi hoặc không đầy đủ. Hãy mở kiểm tra và xuất lại tệp.");
    fail(`Không đọc được học liệu ${extension.toUpperCase()}. Tệp có thể bị lỗi, được mã hóa hoặc có cấu trúc không được hỗ trợ. Hãy lưu lại tệp rồi thử lại.`);
  }
}
