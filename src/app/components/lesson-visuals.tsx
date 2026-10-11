import { useEffect, useId, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircle } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import type { LessonIllustration, SourceImage, SourceRef, SourceUnit } from "@/lib/types";

// Raster-only data URLs; never allow arbitrary SVG/HTML content from an AI or file.
function rasterUrl(image: SourceImage) {
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl) ? image.dataUrl : null;
}

export function SourceImages({ images, label, notice }: { images?: SourceImage[]; label?: string; notice?: string }) {
  const [zoomed, setZoomed] = useState<SourceImage | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!zoomed) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(null);
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); previous?.focus(); };
  }, [zoomed]);
  return <>{!!images?.length && <div className="source-images">{images.map(image => {
    const url = rasterUrl(image); if (!url) return null;
    return <figure key={image.id}><button type="button" onClick={() => setZoomed(image)} aria-label={`Mở hình ${image.label}`}><img src={url} alt={image.label} loading="lazy" width={image.width} height={image.height} /></button><figcaption>{label && <strong>{label} · </strong>}{image.label}<span>Nhấn hình để xem lớn hơn</span></figcaption></figure>;
  })}</div>}{notice && <p className="source-visual-notice">{notice}</p>}{zoomed && <div className="image-lightbox" onClick={() => setZoomed(null)}><section role="dialog" aria-modal="true" aria-label={zoomed.label} onClick={event => event.stopPropagation()}><button ref={closeRef} type="button" className="button secondary small" onClick={() => setZoomed(null)}>Đóng hình</button><img src={rasterUrl(zoomed) || undefined} alt={zoomed.label} /><p>{zoomed.label}</p></section></div>}</>;
}

export function LinkedSourceImages({ references }: { references: SourceRef[] }) {
  const signature = references.map(ref => `${ref.materialId}:${ref.index}`).join("|");
  const [units, setUnits] = useState<SourceUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUnits([]); setFailed(false);
    if (!signature) { setLoading(false); return; }
    setLoading(true);
    const refs = signature.split("|").map(value => { const divider = value.lastIndexOf(":"); return { id: value.slice(0, divider), index: Number(value.slice(divider + 1)) }; });
    Promise.all([...new Set(refs.map(ref => ref.id))].map(async id => {
      const response = await apiFetch(`/api/materials/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("source_missing");
      const result = await response.json() as { units: SourceUnit[] };
      return result.units.filter(unit => refs.some(ref => ref.id === id && ref.index === unit.index));
    })).then(results => { if (active) setUnits(results.flat()); }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signature]);
  if (loading) return <p className="visual-loading"><LoaderCircle size={14} className="spin" />Đang mở hình trong học liệu…</p>;
  if (failed) return <p className="source-visual-notice">Chưa mở được hình nguồn. Nhấn trích dẫn để đọc học liệu gốc.</p>;
  if (!units.some(unit => unit.images?.length || unit.visualNotice)) return null;
  return <section className="lesson-source-images" aria-label="Hình từ học liệu của phần này"><h3><ImageIcon size={16} />Hình trong học liệu</h3>{units.map((unit, index) => <SourceImages key={`${unit.index}-${index}`} images={unit.images} label={unit.label} notice={unit.visualNotice} />)}</section>;
}

function wrapLabel(label: string, max = 25) {
  const words = label.slice(0, 200).split(/\s+/).flatMap(word => word.length > max ? word.match(new RegExp(`.{1,${max}}`, "g")) || [] : [word]); const lines: string[] = []; let line = "";
  for (const word of words) { if (line && (line.length + word.length + 1) > max) { lines.push(line); line = word; } else line += `${line ? " " : ""}${word}`; }
  if (line) lines.push(line); const shown = lines.slice(0, 4); if (lines.length > 4) shown[3] = `${shown[3].slice(0, max - 1)}…`; return shown;
}

export function LessonDiagram({ illustration }: { illustration?: LessonIllustration | null }) {
  const rawId = useId(); const markerId = `arrow-${rawId.replace(/[^A-Za-z0-9]/g, "")}`;
  if (!illustration?.nodes?.length) return null;
  const nodes = illustration.nodes.slice(0, 10); const edges = illustration.edges.slice(0, 16); const width = 680; const boxWidth = 240; const boxHeight = 112; const rowGap = 96;
  const rows = Math.ceil(nodes.length / 2); const height = 44 + rows * boxHeight + (rows - 1) * rowGap;
  const positions = new Map(nodes.map((node, index) => [node.id, { x: index % 2 ? 380 : 60, y: 22 + Math.floor(index / 2) * (boxHeight + rowGap) }]));
  return <figure className="lesson-diagram"><figcaption><strong>{illustration.title}</strong><span>Sơ đồ minh họa do AI tạo</span></figcaption>
    <div className="diagram-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={illustration.title}>
      <title>{illustration.title}</title><desc>{illustration.description}</desc><defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#4c8273" /></marker></defs>
      {edges.map((edge, index) => {
        const from = positions.get(edge.from); const to = positions.get(edge.to); if (!from || !to || edge.from === edge.to) return null;
        const sameRow = from.y === to.y; const forward = from.x < to.x;
        const x1 = sameRow ? from.x + (forward ? boxWidth : 0) : from.x + boxWidth / 2;
        const y1 = sameRow ? from.y + boxHeight / 2 : from.y + (from.y < to.y ? boxHeight : 0);
        const x2 = sameRow ? to.x + (forward ? 0 : boxWidth) : to.x + boxWidth / 2;
        const y2 = sameRow ? to.y + boxHeight / 2 : to.y + (from.y < to.y ? 0 : boxHeight);
        return <g key={index}><path d={`M${x1},${y1} L${x2},${y2}`} stroke="#4c8273" strokeWidth="2" fill="none" markerEnd={`url(#${markerId})`} />{edge.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle" fontSize="13" fill="#436854" paintOrder="stroke" stroke="#fffef9" strokeWidth="5" strokeLinejoin="round">{edge.label.length > 22 ? `${edge.label.slice(0, 21)}…` : edge.label}</text>}</g>;
      })}
      {nodes.map(node => { const position = positions.get(node.id)!; const lines = wrapLabel(node.label);
        return <g key={node.id}><title>{node.label}</title><rect x={position.x} y={position.y} width={boxWidth} height={boxHeight} rx="14" fill="#eef4e4" stroke="#b5cbb0" /><text x={position.x + boxWidth / 2} y={position.y + boxHeight / 2 - (lines.length - 1) * 10} textAnchor="middle" fontSize="15" fill="#2f5646">{lines.map((line, index) => <tspan key={index} x={position.x + boxWidth / 2} dy={index ? 20 : 0}>{line}</tspan>)}</text></g>;
      })}
    </svg></div><p>{illustration.description}</p>{!!edges.length && <ul className="diagram-relations" aria-label="Các quan hệ trong sơ đồ">{edges.map((edge, index) => {
      const from = nodes.find(node => node.id === edge.from); const to = nodes.find(node => node.id === edge.to);
      if (!from || !to) return null;
      return <li key={index}><strong>{from.label}</strong><span aria-label="đến"> → </span><strong>{to.label}</strong>{edge.label && <>: {edge.label}</>}</li>;
    })}</ul>}
  </figure>;
}
