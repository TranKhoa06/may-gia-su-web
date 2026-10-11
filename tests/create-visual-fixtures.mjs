import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath } from "node:url";

// Deliberately synthetic diagrams: no private user documents or credentials.
const width = 240, height = 160;
const pixels = Buffer.alloc(width * height * 3, 255);
function rectangle(x, y, w, h, rgb) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const offset = (yy * width + xx) * 3;
    for (let component = 0; component < 3; component++) pixels[offset + component] = rgb[component];
  }
}
rectangle(102, 42, 4, 78, [33, 86, 92]); rectangle(116, 42, 4, 78, [33, 86, 92]);
rectangle(118, 40, 52, 4, [33, 86, 92]); rectangle(166, 12, 4, 32, [33, 86, 92]);
rectangle(118, 118, 52, 4, [33, 86, 92]); rectangle(166, 120, 4, 28, [33, 86, 92]);
rectangle(32, 78, 72, 4, [33, 86, 92]); rectangle(143, 71, 42, 22, [244, 170, 55]);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const payload = Buffer.concat([Buffer.from(name), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, checksum]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
const rows = Buffer.alloc(height * (1 + width * 3));
for (let y = 0; y < height; y++) pixels.copy(rows, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);

const image = deflateSync(pixels);
const content = Buffer.from("q 480 0 0 320 60 240 cm /Circuit Do Q\n");
const objects = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Circuit 4 0 R >> >> /Contents 5 0 R >>"),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")]),
  Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]),
];
const pdfParts = [Buffer.from("%PDF-1.4\n")], offsets = [0]; let total = pdfParts[0].length;
objects.forEach((object, index) => { offsets.push(total); const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); pdfParts.push(part); total += part.length; });
pdfParts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${total}\n%%EOF\n`));

const p = "http://schemas.openxmlformats.org/presentationml/2006/main", a = "http://schemas.openxmlformats.org/drawingml/2006/main", r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const picture = (i) => `<p:pic><p:nvPicPr><p:cNvPr id="${i + 2}" name="Circuit ${i}" descr="Sơ đồ transistor MOSFET, hình ${i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/></p:blipFill><p:spPr/></p:pic>`;
const wrap = contents => `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${contents}</p:spTree></p:cSld></p:sld>`;
const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="${r}/image" Target="../media/circuit.png"/></Relationships>`;
const pptx = zipSync({
  "ppt/presentation.xml": strToU8(`<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="257" r:id="second"/><p:sldId id="256" r:id="first"/></p:sldIdLst></p:presentation>`),
  "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="${r}/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="${r}/slide" Target="slides/slide2.xml"/></Relationships>`),
  "ppt/slides/slide1.xml": strToU8(wrap(`<p:sp><p:txBody><a:p><a:r><a:t>Gate điều khiển dòng Drain tới Source của MOSFET.</a:t></a:r></a:p></p:txBody></p:sp>${Array.from({ length: 7 }, (_, i) => picture(i + 1)).join("")}<p:cxnSp/>`)),
  "ppt/slides/slide2.xml": strToU8(wrap(picture(1))),
  "ppt/slides/_rels/slide1.xml.rels": strToU8(rels), "ppt/slides/_rels/slide2.xml.rels": strToU8(rels),
  "ppt/media/circuit.png": png,
});
const folder = fileURLToPath(new URL("./fixtures/", import.meta.url));
await mkdir(folder, { recursive: true });
await writeFile(folder + "/scan-circuit.pdf", Buffer.concat(pdfParts));
await writeFile(folder + "/visual-slides.pptx", pptx);
console.log("Created synthetic scan-circuit.pdf and visual-slides.pptx fixtures.");
