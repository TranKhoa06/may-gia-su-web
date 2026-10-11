import { strFromU8, unzipSync } from "fflate";
import type { SourceImage, SourceUnit } from "./types";
import { fitCanvasImage, rasterImage, MAX_VISUAL_DATA_CHARACTERS, MAX_VISUAL_DIMENSION, MAX_VISUALS_PER_DOCUMENT, MAX_VISUALS_PER_SLIDE } from "./material-visuals";

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
    const imageAllowance = Math.min(150_000, Math.floor(MAX_VISUAL_DATA_CHARACTERS / pdf.numPages));
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
        // Render the complete page: circuit diagrams and plots can be PDF vectors,
        // and a scanned page may contain no extractable text at all.
        const nativeViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, MAX_VISUAL_DIMENSION / Math.max(nativeViewport.width, nativeViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        try {
          await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
          const image = fitCanvasImage(canvas, imageAllowance, `page-${index}`, `Toàn bộ trang ${index} (bao gồm hình, sơ đồ và công thức)`);
          units.push({ index, label: `Trang ${index}`, text: text || "Trang này là ảnh quét hoặc hình, không có chữ có thể trích xuất. Hãy đọc và giải thích nội dung trong hình của trang.", images: [image] });
        } finally { canvas.width = 0; canvas.height = 0; }
      } finally {
        page.cleanup();
      }
    }
    if (!units.length) fail("PDF không chứa trang đọc được. Hãy kiểm tra hoặc xuất lại tài liệu.");
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

function rasterMime(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" } as Record<string, string>)[extension] : undefined;
}

type SlideImage = { path: string; label: string; mimeType: string };
type ParsedSlide = { document: XMLDocument; path: string; images: SlideImage[]; notices: string[]; relationships: Map<string, { path: string; type: string }> };

function slideImageReferences(document: XMLDocument, rels: Map<string, { path: string; type: string }>, index: number): { images: SlideImage[]; notices: string[] } {
  const images: SlideImage[] = [];
  const notices = new Set<string>();
  for (const blip of elements(document, "blip")) {
    if (!DRAWING_NAMESPACES.has(blip.namespaceURI ?? "")) continue;
    const embed = Array.from(blip.attributes).find(attribute => attribute.localName === "embed")?.value;
    const linked = Array.from(blip.attributes).some(attribute => attribute.localName === "link");
    const relation = embed ? rels.get(embed) : undefined;
    if (linked || !relation?.type.endsWith("/image")) {
      notices.add("Có hình liên kết bên ngoài chưa đọc được. Hãy chèn hình trực tiếp vào PPTX hoặc xuất slide thành PDF.");
      continue;
    }
    const mimeType = rasterMime(relation.path);
    if (!mimeType) {
      notices.add("Có hình vector (SVG/EMF/WMF) chưa đọc được. Hãy xuất bài trình chiếu thành PDF để gia sư xem hình chính xác.");
      continue;
    }
    let picture: Element | null = blip;
    while (picture && picture.localName !== "pic") picture = picture.parentElement;
    const properties = picture?.getElementsByTagNameNS("*", "cNvPr")[0];
    const description = cleanText([properties?.getAttribute("title"), properties?.getAttribute("descr")].filter(Boolean).join(" — "));
    const name = properties?.getAttribute("name") ?? "";
    const label = `Hình ${images.length + 1}, slide ${index}${description || name ? `: ${(description || name).slice(0, 600)}` : ""}`;
    images.push({ path: relation.path, label, mimeType });
  }
  if (elements(document, "chart").length || elements(document, "relIds").length || elements(document, "cxnSp").length) {
    notices.add("Slide có biểu đồ/SmartArt hoặc sơ đồ bằng hình vẽ PowerPoint; nội dung chữ được đọc nhưng hình chưa được dựng đầy đủ. Xuất thành PDF để gia sư phân tích chính xác sơ đồ.");
  }
  // A shape without text can contain an illustrative circuit/geometry even when
  // the slide does not have an embedded raster picture or a connector.
  if (elements(document, "sp").some(shape => !shape.getElementsByTagNameNS("*", "t").length && shape.getElementsByTagNameNS("*", "prstGeom").length)) {
    notices.add("Một số hình vẽ PowerPoint chưa được dựng đầy đủ; nếu chúng chứa kiến thức, hãy tải thêm bản PDF của slide.");
  }
  return { images, notices: [...notices] };
}

async function parsePptx(bytes: Uint8Array): Promise<SourceUnit[]> {
  const relevant = (name: string) => /^ppt\/(?:slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|presentation\.xml|_rels\/presentation\.xml\.rels)$/.test(name);
  const names = new Set<string>();
  let declaredSize = 0;
  let entries = 0;
  let slideCount = 0;
  // Inspect the entire central directory before decompression. Only XML and the
  // bounded raster pictures actually referenced by a slide are expanded later.
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
  let retainedImages = 0;
  const slides: ParsedSlide[] = orderedPaths.map((path, position) => {
    const document = parseXml(parts[path], path);
    const relPath = path.replace("slides/", "slides/_rels/") + ".rels";
    const rels = parts[relPath] ? relationships(parseXml(parts[relPath], relPath), path) : new Map<string, { path: string; type: string }>();
    const visual = slideImageReferences(document, rels, position + 1);
    const allowed = Math.max(0, Math.min(MAX_VISUALS_PER_SLIDE, MAX_VISUALS_PER_DOCUMENT - retainedImages));
    const selected = visual.images.slice(0, allowed);
    retainedImages += selected.length;
    if (selected.length < visual.images.length) visual.notices.push(`Slide có ${visual.images.length} hình nhưng chỉ lưu ${selected.length} hình trong giới hạn dung lượng. Hãy chia nhỏ tài liệu hoặc tải bản PDF để đọc đủ hình.`);
    return { document, path, images: selected, notices: visual.notices, relationships: rels };
  });
  const imagePaths = new Set(slides.flatMap(slide => slide.images.map(image => image.path)));
  const imageParts = unzipSync(bytes, { filter(entry) { return imagePaths.has(entry.name) && entry.originalSize <= 6 * 1024 * 1024; } });
  const imageAllowance = Math.min(150_000, Math.floor(MAX_VISUAL_DATA_CHARACTERS / Math.max(1, retainedImages)));
  const units: SourceUnit[] = [];
  let characters = 0;
  for (let position = 0; position < slides.length; position += 1) {
    const slide = slides[position];
    const path = slide.path;
    const slideText = drawingText(slide.document);
    const sourceNumber = path.match(/slide(\d+)\.xml$/)?.[1];
    const slideRelPath = path.replace("slides/", "slides/_rels/") + ".rels";
    let notesPath = `ppt/notesSlides/notesSlide${sourceNumber}.xml`;
    if (parts[slideRelPath]) {
      // Relationship targets, rather than note filenames, determine which notes
      // belong to a slide after a user has reordered or deleted slides.
      notesPath = Array.from(slide.relationships.values()).find((relationship) => relationship.type.endsWith("/notesSlide"))?.path ?? "";
    }
    const noteText = parts[notesPath] ? drawingText(parseXml(parts[notesPath], notesPath)) : "";
    const text = cleanText([slideText, noteText ? `Ghi chú thuyết trình:\n${noteText}` : ""].filter(Boolean).join("\n\n"));
    const images: SourceImage[] = [];
    for (let imageIndex = 0; imageIndex < slide.images.length; imageIndex += 1) {
      const image = slide.images[imageIndex];
      const data = imageParts[image.path];
      if (!data) { slide.notices.push(`Không đọc được ${image.label}: hình thiếu hoặc vượt 6 MB. Hãy nén hình hoặc xuất thành PDF.`); continue; }
      try {
        images.push(await rasterImage(data, image.mimeType, imageAllowance, `slide-${position + 1}-image-${imageIndex + 1}`, image.label));
      } catch {
        slide.notices.push(`Không đọc được ${image.label}. Hãy kiểm tra hình hoặc tải bản PDF để gia sư xem đầy đủ.`);
      }
    }
    characters += text.length;
    checkTextBudget(characters);
    if (text || images.length || slide.notices.length) units.push({ index: position + 1, label: `Slide ${position + 1}`, text: text || (images.length ? "Slide chỉ có hình. Hãy đọc và giải thích nội dung trong những hình của slide." : "Slide chứa hình chưa đọc được. Không suy đoán kiến thức từ hình chưa được tải vào gia sư; cần bản PDF của slide."), ...(images.length ? { images } : {}), ...(slide.notices.length ? { visualNotice: [...new Set(slide.notices)].join(" ").slice(0, 4000) } : {}) });
  }
  if (!units.length) {
    fail("PPTX không có chữ hoặc hình đọc được. Nếu chỉ chứa hình vector/SmartArt, hãy xuất tài liệu thành PDF rồi tải lên.");
  }
  return units;
}

/** Extract bounded text and visuals entirely in the user's browser. */
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
    return await parsePptx(bytes);
  } catch (error) {
    if (error instanceof MaterialParseError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") fail("PDF được bảo vệ bằng mật khẩu. Hãy xuất một bản PDF không khóa rồi tải lại.");
    if (name === "InvalidPDFException" || name === "MissingPDFException") fail("PDF bị lỗi hoặc không đầy đủ. Hãy mở kiểm tra và xuất lại tệp.");
    fail(`Không đọc được học liệu ${extension.toUpperCase()}. Tệp có thể bị lỗi, được mã hóa hoặc có cấu trúc không được hỗ trợ. Hãy lưu lại tệp rồi thử lại.`);
  }
}
