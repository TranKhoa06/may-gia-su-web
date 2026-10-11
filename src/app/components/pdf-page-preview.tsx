import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

type Props = { url: string; pageIndex: number; name: string };

/** Render locally stored PDFs consistently, including browsers without a PDF plugin. */
export function PdfPagePreview({ url, pageIndex, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(500);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    const measure = () => setWidth(Math.max(180, Math.min(1200, container.clientWidth)));
    measure(); const observer = new ResizeObserver(measure); observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true; let task: PDFDocumentLoadingTask | undefined;
    setDocument(null); setLoading(true); setError("");
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist"); if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf-worker/pdf.worker-${pdfjs.version}.min.mjs`;
        task = pdfjs.getDocument({ url, useSystemFonts: true, disableFontFace: true });
        const result = await task.promise; if (active) setDocument(result);
      } catch { if (active) setError("Chưa hiển thị được bản PDF. Bạn có thể tải bản gốc để xem."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; if (task) void task.destroy().catch(() => {}); };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let active = true; let renderTask: RenderTask | undefined;
    const canvas = canvasRef.current;
    setRendering(true); setError("");
    void (async () => {
      const page = await document.getPage(Math.min(Math.max(1, pageIndex), document.numPages));
      try {
        if (!active) return;
        const native = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / native.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        renderTask = page.render({ canvas, viewport, ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }), background: "rgb(255,255,255)" });
        await renderTask.promise;
      } finally { page.cleanup(); }
    })().catch(() => { if (active) setError("Chưa đọc được trang PDF này. Hãy tải bản gốc hoặc chuyển sang Nội dung."); }).finally(() => { if (active) setRendering(false); });
    return () => { active = false; renderTask?.cancel(); };
  }, [document, pageIndex, width]);

  return <div className="pdf-page-preview" ref={containerRef} aria-busy={loading || rendering}>
    {(loading || rendering) && <div className="pdf-preview-status" role="status"><LoaderCircle className="spin" size={20} /><p>Đang dựng trang PDF…</p></div>}
    {error && <div className="pdf-preview-status" role="alert"><p>{error}</p><a className="text-button" href={url} download={name}><ArrowDownToLine size={15} />Tải PDF gốc</a></div>}
    <canvas ref={canvasRef} className={loading || rendering || error ? "pdf-canvas pending" : "pdf-canvas"} role="img" aria-label={`Bản gốc ${name}, trang ${pageIndex}`} />
  </div>;
}
