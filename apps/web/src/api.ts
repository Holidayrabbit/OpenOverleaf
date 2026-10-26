import type { ApiMessage, CompileResult, FileNode, Status } from "./types.ts";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("Cannot reach the OpenOverleaf server. Run pnpm dev from the repo root.");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(message);
  }
  return data as T;
}

export function getStatus(): Promise<Status> {
  return request<Status>("/api/status");
}

export async function getTree(): Promise<FileNode[]> {
  const data = await request<{ files: FileNode[] }>("/api/files");
  return data.files;
}

export function readFile(path: string): Promise<{ path: string; content: string; binary: boolean }> {
  return request(`/api/file?path=${encodeURIComponent(path)}`);
}

export function writeFile(path: string, content: string): Promise<{ path: string; bytes: number }> {
  return request("/api/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export function deleteFile(path: string): Promise<{ ok: boolean }> {
  return request(`/api/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export function compileDocument(): Promise<CompileResult> {
  return request("/api/compile", { method: "POST" });
}

interface SseEvent {
  event: string;
  data: string;
}

function drainSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of part.split(/\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

export interface AgentHandlers {
  onText: (delta: string) => void;
  onToolStart: (event: { id: string; name: string; args: Record<string, unknown> }) => void;
  onToolEnd: (event: { id: string; name: string; ok: boolean; result: string }) => void;
  onDone: (messages: ApiMessage[]) => void;
  onError: (message: string) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function streamAgent(
  messages: ApiMessage[],
  handlers: AgentHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = `Agent request failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (text) message = text.slice(0, 300);
    }
    throw new ApiError(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (event: SseEvent) => {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    const record = asRecord(payload);
    if (!record) return;
    if (event.event === "text" && typeof record.delta === "string") handlers.onText(record.delta);
    else if (event.event === "tool_start" && typeof record.id === "string" && typeof record.name === "string") {
      const args = asRecord(record.args) ?? {};
      handlers.onToolStart({ id: record.id, name: record.name, args });
    } else if (event.event === "tool_end" && typeof record.id === "string" && typeof record.name === "string") {
      handlers.onToolEnd({
        id: record.id,
        name: record.name,
        ok: record.ok !== false,
        result: typeof record.result === "string" ? record.result : "",
      });
    } else if (event.event === "error" && typeof record.message === "string") handlers.onError(record.message);
    else if (event.event === "done" && Array.isArray(record.messages)) {
      handlers.onDone(record.messages as ApiMessage[]);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    if (done) buffer += "\n\n";
    const drained = drainSse(buffer);
    buffer = drained.rest;
    for (const event of drained.events) dispatch(event);
    if (done) break;
  }
}
