export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface Status {
  version: string;
  workspaceLabel: string;
  tex: { pdflatex: boolean; latexmk: boolean; hint?: string };
  agent: { configured: boolean; model: string };
  pdf: boolean;
}

export interface CompileResult {
  ok: boolean;
  reason: string;
  log: string;
  hint?: string;
  pdf?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ApiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type SaveState = "saved" | "saving" | "dirty" | "error";

export type CompileView =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; log: string }
  | { status: "error"; log: string; hint?: string; reason: string };

export interface OpenFile {
  path: string;
  content: string;
  revision: number;
}

export interface ToolTrace {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
  status: "running" | "done";
}

export type TranscriptItem =
  | { id: string; kind: "user"; content: string }
  | { id: string; kind: "assistant"; content: string }
  | { id: string; kind: "tool"; tool: ToolTrace }
  | { id: string; kind: "error"; content: string };
