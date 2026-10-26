export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#f6f1e8" />
      <path
        d="M16.1 12.1c-2.7-2.2-6.6-.8-7.4 2.8-.9 4.4 2.2 10.2 7.4 10.6 5.2-.4 8.4-6.2 7.4-10.6-.8-3.6-4.7-5-7.4-2.8z"
        fill="#c44536"
      />
      <path
        d="M16.1 12.4c.4-1.7 1.6-2.9 3.1-3.3"
        fill="none"
        stroke="#6b4630"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <ellipse cx="20.6" cy="8.3" rx="2.7" ry="1.35" transform="rotate(-28 20.6 8.3)" fill="#3f7a45" />
    </svg>
  );
}

export function Header({
  filePath,
  workspaceLabel,
  texLabel,
  texTone,
  compiling,
  pdfReady,
  onCompile,
}: {
  filePath: string | null;
  workspaceLabel: string;
  texLabel: string;
  texTone: "ok" | "warn" | "neutral";
  compiling: boolean;
  pdfReady: boolean;
  onCompile: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <Mark />
        <div className="brand-text">
          <strong>OpenOverleaf</strong>
          <span className="brand-sub">{workspaceLabel}</span>
        </div>
      </div>
      <div className="header-file" title={filePath ?? undefined}>
        {filePath ?? "No file open"}
      </div>
      <div className="header-actions">
        <span className={texTone === "neutral" ? "pill" : `pill ${texTone}`}>{texLabel}</span>
        <a
          className={pdfReady ? "ghost toolbar-btn" : "ghost toolbar-btn disabled"}
          href={pdfReady ? "/api/pdf?download=1" : undefined}
          download={pdfReady ? "main.pdf" : undefined}
          aria-disabled={!pdfReady}
          onClick={(event) => {
            if (!pdfReady) event.preventDefault();
          }}
        >
          Download PDF
        </a>
        <button
          type="button"
          className="primary recompile"
          data-testid="compile"
          onClick={onCompile}
          disabled={compiling}
          title="Recompile main.tex (Ctrl+Enter)"
        >
          {compiling && <span className="spinner" aria-hidden="true" />}
          {compiling ? "Recompiling…" : "Recompile"}
        </button>
      </div>
    </header>
  );
}
