import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { streamAgent } from "../api.ts";
import { appendDelta, deriveTranscript, isApiMessage } from "../transcript.ts";
import type { ApiMessage, ToolTrace, TranscriptItem } from "../types.ts";
import { RichText } from "./RichText.tsx";

const STORAGE_KEY = "openoverleaf.chat.v1";

const SUGGESTIONS = [
  "Explain the structure of this project.",
  "Add a short conclusion to the notes.",
  "Compile main.tex and summarize any errors.",
];

function loadMessages(): ApiMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isApiMessage).slice(-30);
  } catch {
    return [];
  }
}

function persist(messages: ApiMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    // Private mode or a full quota should not break the chat.
  }
}

function summarize(tool: ToolTrace): string {
  const path = typeof tool.args.path === "string" ? tool.args.path : "";
  const command = typeof tool.args.command === "string" ? tool.args.command : "";
  if (tool.name === "compile_latex") return "main.tex";
  if (tool.name === "run_terminal") return command.slice(0, 180) || "command";
  return path || "project";
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export function ChatPane({
  agentLabel,
  onRunStart,
  onRunEnd,
  onTool,
}: {
  agentLabel: string;
  onRunStart: () => Promise<void>;
  onRunEnd: () => Promise<void>;
  onTool: (name: string, args: Record<string, unknown>, result: string) => void;
}) {
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>(loadMessages);
  const [items, setItems] = useState<TranscriptItem[]>(() => deriveTranscript(loadMessages()));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const apiRef = useRef(apiMessages);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const argsRef = useRef(new Map<string, Record<string, unknown>>());
  apiRef.current = apiMessages;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  async function submit(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setDraft("");
    setBusy(true);
    const next: ApiMessage[] = [...apiRef.current, { role: "user", content }];
    setApiMessages(next);
    setItems(deriveTranscript(next));
    const controller = new AbortController();
    abortRef.current = controller;
    let streamed = "";
    let finished = false;

    const remember = (messages: ApiMessage[]) => {
      setApiMessages(messages);
      persist(messages);
    };

    try {
      await onRunStart();
      await streamAgent(
        next,
        {
          onText(delta) {
            streamed += delta;
            setItems((current) => appendDelta(current, delta));
          },
          onToolStart(event) {
            argsRef.current.set(event.id, event.args);
            const tool: ToolTrace = {
              id: event.id,
              name: event.name,
              args: event.args,
              result: "",
              ok: true,
              status: "running",
            };
            setItems((current) => [...current, { id: event.id, kind: "tool", tool }]);
          },
          onToolEnd(event) {
            setItems((current) =>
              current.map((item) =>
                item.kind === "tool" && item.tool.id === event.id
                  ? { ...item, tool: { ...item.tool, result: event.result, ok: event.ok, status: "done" } }
                  : item,
              ),
            );
            onTool(event.name, argsRef.current.get(event.id) ?? {}, event.result);
          },
          onDone(messages) {
            finished = true;
            setItems(deriveTranscript(messages));
            remember(messages);
          },
          onError(message) {
            setItems((current) => [...current, { id: crypto.randomUUID(), kind: "error", content: message }]);
          },
        },
        controller.signal,
      );
      if (!finished) remember(streamed ? [...next, { role: "assistant", content: streamed }] : next);
    } catch (error) {
      const message = isAbort(error)
        ? "Stopped."
        : error instanceof Error
          ? error.message
          : "The agent request failed";
      setItems((current) => [...current, { id: crypto.randomUUID(), kind: "error", content: message }]);
      remember(streamed ? [...next, { role: "assistant", content: streamed }] : next);
    } finally {
      setBusy(false);
      abortRef.current = null;
      try {
        await onRunEnd();
      } catch {
        // The project pane reports its own load errors.
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy) void submit(draft);
    }
  }

  function clear() {
    if (busy) return;
    setItems([]);
    setApiMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <section className="pane chat-pane" data-testid="agent">
      <div className="pane-header">
        <strong>Agent</strong>
        <span className="muted">{agentLabel}</span>
        <button type="button" className="ghost slim" onClick={clear} disabled={busy || items.length === 0}>
          Clear
        </button>
      </div>
      <div
        className="transcript"
        ref={scrollerRef}
        onScroll={() => {
          const el = scrollerRef.current;
          if (!el) return;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {items.length === 0 && (
          <div className="empty chat-empty">
            <h2>Edit with the agent</h2>
            <p>It can read and write this project, run a short command, and compile main.tex.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="chip" onClick={() => void submit(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) => {
          if (item.kind === "user") {
            return (
              <div key={item.id} className="msg-user">
                {item.content}
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              <div key={item.id} className="msg-assistant">
                <RichText text={item.content} />
              </div>
            );
          }
          if (item.kind === "error") {
            return (
              <div key={item.id} className="msg-error" role="alert">
                {item.content}
              </div>
            );
          }
          const long = item.tool.result.length > 500;
          return (
            <article key={item.id} className={item.tool.status === "running" ? "tool run" : item.tool.ok ? "tool" : "tool bad"}>
              <header>
                <span>{item.tool.status === "running" ? "Running" : "Used"} {item.tool.name}</span>
                <span>{summarize(item.tool)}</span>
              </header>
              {item.tool.result &&
                (long ? (
                  <details>
                    <summary>{item.tool.result.slice(0, 180)}…</summary>
                    <pre>{item.tool.result}</pre>
                  </details>
                ) : (
                  <pre>{item.tool.result}</pre>
                ))}
            </article>
          );
        })}
        {busy && (
          <div className="thinking">
            <span className="spinner dark" aria-hidden="true" />
            Working…
          </div>
        )}
      </div>
      <div className="composer-wrap">
        <label className="sr-only" htmlFor="agent-input">
          Message the agent
        </label>
        <textarea
          id="agent-input"
          data-testid="agent-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask the agent to edit, explain, or compile…"
          rows={3}
        />
        <div className="composer-actions">
          <p className="hint">Enter to send · Shift+Enter for a newline · tools run on this machine</p>
          {busy ? (
            <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void submit(draft)} disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
