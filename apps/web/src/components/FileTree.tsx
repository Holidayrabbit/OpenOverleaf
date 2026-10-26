import { useState, type FormEvent } from "react";
import type { FileNode } from "../types.ts";

function extensionClass(name: string): string {
  if (name.endsWith(".tex")) return "ext tex";
  if (name.endsWith(".md")) return "ext md";
  if (name.endsWith(".bib")) return "ext bib";
  return "ext";
}

function NodeList({
  nodes,
  activePath,
  pendingDelete,
  onOpen,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  nodes: FileNode[];
  activePath: string | null;
  pendingDelete: string | null;
  onOpen: (path: string) => void;
  onAskDelete: (path: string) => void;
  onConfirmDelete: (path: string) => void;
  onCancelDelete: () => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <li key={node.path}>
            <details open>
              <summary>{node.name}</summary>
              <NodeList
                nodes={node.children ?? []}
                activePath={activePath}
                pendingDelete={pendingDelete}
                onOpen={onOpen}
                onAskDelete={onAskDelete}
                onConfirmDelete={onConfirmDelete}
                onCancelDelete={onCancelDelete}
              />
            </details>
          </li>
        ) : (
          <li key={node.path}>
            <div className={node.path === activePath ? "file-row active" : "file-row"}>
              {pendingDelete === node.path ? (
                <>
                  <span className="file-name confirm-label">{node.name}</span>
                  <button type="button" className="text-danger" onClick={() => onConfirmDelete(node.path)}>
                    Delete
                  </button>
                  <button type="button" onClick={onCancelDelete}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="file-btn"
                    aria-current={node.path === activePath ? "true" : undefined}
                    onClick={() => onOpen(node.path)}
                  >
                    <span className={extensionClass(node.name)} aria-hidden="true" />
                    <span className="file-name">{node.name}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${node.name}`}
                    onClick={() => onAskDelete(node.path)}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

export function FileTree({
  nodes,
  activePath,
  booting,
  error,
  onOpen,
  onCreate,
  onDelete,
  onRetry,
}: {
  nodes: FileNode[];
  activePath: string | null;
  booting: boolean;
  error: string | null;
  onOpen: (path: string) => void;
  onCreate: (path: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    const path = draft.trim();
    if (!path) return;
    try {
      await onCreate(path);
      setDraft("");
      setActionError(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not create the file");
    }
  }

  async function confirmDelete(path: string) {
    try {
      await onDelete(path);
      setPendingDelete(null);
      setActionError(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not delete the file");
    }
  }

  return (
    <section className="pane" data-testid="file-tree">
      <div className="pane-header">
        <strong>Files</strong>
      </div>
      <form className="create-form" onSubmit={(event) => void create(event)}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="sections/notes.tex"
          aria-label="New file path"
          spellCheck={false}
        />
        <button type="submit" className="ghost slim">
          Add
        </button>
      </form>
      {actionError && <p className="create-error">{actionError}</p>}
      <div className="tree-scroll">
        {booting && <p className="muted pad">Loading project…</p>}
        {!booting && error && (
          <div className="pad">
            <p className="create-error">{error}</p>
            <button type="button" className="ghost slim" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
        {!booting && !error && nodes.length === 0 && <p className="muted pad">This project is empty.</p>}
        {!booting && !error && nodes.length > 0 && (
          <NodeList
            nodes={nodes}
            activePath={activePath}
            pendingDelete={pendingDelete}
            onOpen={onOpen}
            onAskDelete={setPendingDelete}
            onConfirmDelete={(path) => void confirmDelete(path)}
            onCancelDelete={() => setPendingDelete(null)}
          />
        )}
      </div>
    </section>
  );
}
