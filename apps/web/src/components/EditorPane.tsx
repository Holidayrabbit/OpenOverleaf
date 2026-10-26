import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { OpenFile, SaveState } from "../types.ts";

function saveLabel(state: SaveState): string {
  if (state === "saving") return "Saving…";
  if (state === "dirty") return "Unsaved";
  if (state === "error") return "Save failed";
  return "Saved";
}

function EditorSurface({
  initialContent,
  autoFocus,
  onChange,
  onSave,
}: {
  initialContent: string;
  autoFocus: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const focusRef = useRef(autoFocus);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  focusRef.current = autoFocus;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialContent,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          EditorState.tabSize.of(2),
          StreamLanguage.define(stex),
          syntaxHighlighting(defaultHighlightStyle),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": { height: "100%", backgroundColor: "#fffdf8", color: "#1d1a16", fontSize: "14px" },
              ".cm-scroller": {
                fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                lineHeight: "1.65",
              },
              ".cm-gutters": {
                backgroundColor: "#f7f4ee",
                color: "#8a8175",
                borderRight: "1px solid #e4ddd2",
              },
              ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#f3efe6" },
              ".cm-content": { padding: "12px 0 40px" },
              "&.cm-focused .cm-cursor": { borderLeftColor: "#1d1a16" },
            },
            { dark: false },
          ),
        ],
      }),
    });
    if (focusRef.current) view.focus();
    const onResize = () => view.requestMeasure();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      view.destroy();
    };
    // The parent remounts this surface with a new key when the file or revision changes.
    // Live keystrokes must not rebuild the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="cm-host" />;
}

export function EditorColumn({
  open,
  editorSeed,
  saveState,
  booting,
  fileLoading,
  binaryPath,
  fileError,
  autoFocus,
  onChange,
  onSave,
}: {
  open: OpenFile | null;
  editorSeed: string;
  saveState: SaveState;
  booting: boolean;
  fileLoading: boolean;
  binaryPath: string | null;
  fileError: string | null;
  autoFocus: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const saveClass = saveState === "dirty" ? "save dirty" : saveState === "error" ? "save bad" : "save";
  return (
    <section className="pane editor-pane" data-testid="editor">
      <div className="pane-header tabbar">
        <span className="tab" title={open?.path}>
          {open?.path ?? (binaryPath ? binaryPath : "No file")}
        </span>
        <span className={saveClass} title="Autosaves. Ctrl+S or Cmd+S saves now.">
          {open ? saveLabel(saveState) : ""}
        </span>
      </div>
      {fileError && (
        <div className="banner" role="alert">
          {fileError}
        </div>
      )}
      <div className="editor-host">
        {booting || fileLoading ? (
          <div className="empty">
            <h2>{booting ? "Loading project…" : "Opening…"}</h2>
          </div>
        ) : binaryPath ? (
          <div className="empty">
            <h2>Binary file</h2>
            <p>{binaryPath} is not UTF-8 text. The editor left it unopened.</p>
          </div>
        ) : open ? (
          <EditorSurface
            key={`${open.path}:${open.revision}`}
            initialContent={editorSeed}
            autoFocus={autoFocus}
            onChange={onChange}
            onSave={onSave}
          />
        ) : (
          <div className="empty">
            <h2>No file open</h2>
            <p>Choose a file from the project tree, or add one.</p>
          </div>
        )}
      </div>
    </section>
  );
}
