import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { CompileView } from "../types.ts";

GlobalWorkerOptions.workerSrc = workerSrc;

export function PreviewPane({
  url,
  compile,
  texHint,
  active,
}: {
  url: string | null;
  compile: CompileView;
  texHint: string | null;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"preview" | "log">("preview");
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pageCount, setPageCount] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (compile.status === "error") setTab("log");
    else if (compile.status === "ok") setTab("preview");
  }, [compile]);

  useEffect(() => {
    if (!active || !url || !hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    const task = getDocument({ url, disableRange: true, disableStream: true, disableAutoFetch: true });
    let doc: Awaited<typeof task.promise> | null = null;
    let painting = false;
    let again = false;

    const paint = async () => {
      if (!doc || cancelled) return;
      if (painting) {
        again = true;
        return;
      }
      painting = true;
      const width = host.clientWidth;
      if (width < 48) {
        painting = false;
        return;
      }
      host.replaceChildren();
      try {
        for (let index = 1; index <= doc.numPages; index += 1) {
          if (cancelled) return;
          const page = await doc.getPage(index);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(Math.max((width - 28) / base.width, 0.2), 2);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          const context = canvas.getContext("2d");
          if (!context) continue;
          host.append(canvas);
          await page.render({ canvasContext: context, viewport }).promise;
        }
        if (!cancelled) setPhase("ready");
      } catch (error) {
        if (!cancelled) {
          setPhase("error");
          setRenderError(error instanceof Error ? error.message : "Could not render the PDF");
        }
      } finally {
        painting = false;
        if (again && !cancelled) {
          again = false;
          void paint();
        }
      }
    };

    setPhase("loading");
    setRenderError(null);
    void (async () => {
      try {
        doc = await task.promise;
        if (cancelled) return;
        setPageCount(doc.numPages);
        await paint();
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        setRenderError(error instanceof Error ? error.message : "Could not render the PDF");
      }
    })();

    const observer = new ResizeObserver(() => {
      void paint();
    });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      void task.destroy();
      if (doc) void doc.destroy();
    };
  }, [active, url]);

  const pagesLabel = pageCount === 1 ? "1 page" : `${pageCount} pages`;
  let statusText = "";
  let statusClass = "status-line";
  if (compile.status === "running") statusText = "Compiling…";
  else if (compile.status === "error") {
    statusText = "Failed";
    statusClass = "status-line bad";
  } else if (compile.status === "ok") {
    statusText = pageCount ? pagesLabel : "Compiled";
    statusClass = "status-line ok";
  } else if (pageCount) statusText = pagesLabel;

  return (
    <section className="pane preview-pane" data-testid="preview">
      <div className="pane-header">
        <div className="tabs" role="tablist">
          <button type="button" className={tab === "preview" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("preview")}>
            Preview
          </button>
          <button type="button" className={tab === "log" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("log")}>
            Log
          </button>
        </div>
        <span className={statusClass}>{statusText}</span>
        {url && (
          <a className="text-link" href={url} target="_blank" rel="noreferrer">
            Open
          </a>
        )}
      </div>
      {tab === "log" ? (
        <div className="log-wrap">
          {compile.status === "error" && compile.hint && <div className="hint-block">{compile.hint}</div>}
          <pre className="log-view">
            {compile.status === "idle"
              ? "The compile log will show up here."
              : compile.status === "running"
                ? "Compiling main.tex…"
                : compile.log || "The compiler returned no log."}
          </pre>
        </div>
      ) : (
        <div className="preview-scroll">
          {!url && compile.status !== "running" && (
            <div className="empty">
              <h2>No preview yet</h2>
              <p>Compile main.tex to build a PDF in this pane.</p>
              {texHint && <div className="hint-block">{texHint}</div>}
            </div>
          )}
          {compile.status === "running" && !url && (
            <div className="empty">
              <h2>Compiling…</h2>
              <p>main.tex is building into the preview.</p>
            </div>
          )}
          {url && phase === "loading" && <p className="muted pad">Rendering PDF…</p>}
          {url && phase === "error" && (
            <div className="empty">
              <h2>Preview unavailable</h2>
              <p>{renderError}</p>
              <iframe className="pdf-frame" title="PDF preview" src={url} />
            </div>
          )}
          <div ref={hostRef} className="preview-stage" hidden={!url || phase === "error"} />
        </div>
      )}
    </section>
  );
}
