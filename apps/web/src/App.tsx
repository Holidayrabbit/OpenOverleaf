import { useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { ChatPane } from "./components/ChatPane.tsx";
import { EditorColumn } from "./components/EditorPane.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { Header } from "./components/Header.tsx";
import { PreviewPane } from "./components/PreviewPane.tsx";
import { TerminalPane } from "./components/TerminalPane.tsx";
import { useProject } from "./useProject.ts";

type MobileTab = "files" | "editor" | "preview" | "agent" | "terminal";

function useNarrow(): boolean {
  const query = "(max-width: 900px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export default function App() {
  const project = useProject();
  const narrow = useNarrow();
  const [mobileTab, setMobileTab] = useState<MobileTab>("editor");
  const [termCollapsed, setTermCollapsed] = useState(false);
  const termRef = useRef<ImperativePanelHandle>(null);

  const { flushSave, compile } = project;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushSave();
      } else if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setMobileTab("preview");
        void compile();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [compile, flushSave]);

  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [mobileTab, narrow, termCollapsed]);

  const texReady = Boolean(project.status && (project.status.tex.pdflatex || project.status.tex.latexmk));
  const texLabel = !project.status ? "Checking TeX" : texReady ? "TeX ready" : "TeX missing";
  const texTone = !project.status ? "neutral" : texReady ? "ok" : "warn";
  const workspaceLabel = project.status?.workspaceLabel ?? "project";
  const agentLabel = project.status?.agent.configured ? project.status.agent.model : "no API key";

  const fileTree = (
    <FileTree
      nodes={project.tree}
      activePath={project.open?.path ?? project.binaryPath}
      booting={project.booting}
      error={project.bootError}
      onOpen={(path) => {
        void project.openPath(path);
        setMobileTab("editor");
      }}
      onCreate={async (path) => {
        await project.createFile(path);
        setMobileTab("editor");
      }}
      onDelete={project.removeFile}
      onRetry={() => void project.boot()}
    />
  );

  const editor = (
    <EditorColumn
      open={project.open}
      editorSeed={project.editorSeed}
      saveState={project.saveState}
      booting={project.booting}
      fileLoading={project.fileLoading}
      binaryPath={project.binaryPath}
      fileError={project.fileError}
      autoFocus={project.autoFocus}
      onChange={project.handleChange}
      onSave={() => void project.flushSave()}
    />
  );

  const preview = (
    <PreviewPane
      url={project.pdfUrl}
      compile={project.compileState}
      texHint={project.status?.tex.hint ?? null}
      active={!narrow || mobileTab === "preview"}
    />
  );

  const chat = (
    <ChatPane
      agentLabel={agentLabel}
      onRunStart={project.beginAgent}
      onRunEnd={project.endAgent}
      onTool={(name, args, result) => void project.applyAgentEffect(name, args, result)}
    />
  );

  const terminal = (
    <TerminalPane
      cwdLabel={workspaceLabel}
      collapsed={!narrow && termCollapsed}
      onToggle={() => {
        const panel = termRef.current;
        if (!panel) {
          setTermCollapsed((current) => !current);
          return;
        }
        if (panel.isCollapsed()) panel.expand();
        else panel.collapse();
      }}
    />
  );

  return (
    <div className="app">
      <Header
        filePath={project.open?.path ?? project.binaryPath}
        workspaceLabel={workspaceLabel}
        texLabel={texLabel}
        texTone={texTone}
        compiling={project.compileState.status === "running"}
        pdfReady={Boolean(project.pdfUrl)}
        onCompile={() => {
          setMobileTab("preview");
          void project.compile();
        }}
      />
      {project.bootError && (
        <div className="banner" role="alert">
          <span>{project.bootError}</span>
          <button type="button" className="ghost slim" onClick={() => void project.boot()}>
            Retry
          </button>
        </div>
      )}
      <div className="workspace">
        {narrow ? (
          <div className="shell mobile">
            <div className="mobile-body">
              <div className="fill" hidden={mobileTab !== "files"}>
                {fileTree}
              </div>
              <div className="fill" hidden={mobileTab !== "editor"}>
                {editor}
              </div>
              <div className="fill" hidden={mobileTab !== "preview"}>
                {preview}
              </div>
              <div className="fill" hidden={mobileTab !== "agent"}>
                {chat}
              </div>
              <div className="fill" hidden={mobileTab !== "terminal"}>
                {terminal}
              </div>
            </div>
            <nav className="mobile-nav" aria-label="Studio sections">
              {(["files", "editor", "preview", "agent", "terminal"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={mobileTab === tab ? "active" : undefined}
                  onClick={() => setMobileTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>
        ) : (
          <div className="shell">
            <PanelGroup direction="vertical" autoSaveId="openoverleaf-vertical" style={{ height: "100%" }}>
              <Panel defaultSize={74} minSize={42} className="panel">
                <PanelGroup direction="horizontal" autoSaveId="openoverleaf-main" style={{ flex: 1, minHeight: 0 }}>
                  <Panel defaultSize={16} minSize={12} maxSize={28} className="panel">
                    {fileTree}
                  </Panel>
                  <PanelResizeHandle className="handle" />
                  <Panel defaultSize={36} minSize={24} className="panel">
                    {editor}
                  </Panel>
                  <PanelResizeHandle className="handle" />
                  <Panel defaultSize={28} minSize={18} className="panel">
                    {preview}
                  </Panel>
                  <PanelResizeHandle className="handle" />
                  <Panel defaultSize={20} minSize={16} maxSize={36} className="panel">
                    {chat}
                  </Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className="handle" />
              <Panel
                ref={termRef}
                defaultSize={26}
                minSize={16}
                collapsible
                collapsedSize={6}
                className="panel"
                onCollapse={() => setTermCollapsed(true)}
                onExpand={() => setTermCollapsed(false)}
              >
                {terminal}
              </Panel>
            </PanelGroup>
          </div>
        )}
      </div>
    </div>
  );
}
