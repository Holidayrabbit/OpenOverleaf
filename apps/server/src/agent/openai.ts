import { getConfig } from "../config.js";
import type { ChatMessage, ToolCallDraft } from "./types.js";

export interface Completion {
  content: string;
  toolCalls: ToolCallDraft[];
}

interface ToolAccumulator {
  id: string;
  name: string;
  arguments: string;
}

function formatProviderError(status: number, body: string): string {
  let detail = body.slice(0, 500);
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof json.error === "string") detail = json.error;
    else if (json.error?.message) detail = json.error.message;
  } catch {
    // The body was plain text.
  }
  if (status === 401 || status === 403) {
    return `The model endpoint rejected the API key (${status}). ${detail}`;
  }
  return `The model request failed (${status}). ${detail}`;
}

function absorbToolDelta(calls: Map<number, ToolAccumulator>, delta: unknown): void {
  if (!Array.isArray(delta)) return;
  for (const entry of delta) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: unknown };
    };
    const index = typeof record.index === "number" ? record.index : calls.size;
    const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
    if (typeof record.id === "string") current.id += record.id;
    if (typeof record.function?.name === "string") current.name += record.function.name;
    const rawArgs = record.function?.arguments;
    if (typeof rawArgs === "string") current.arguments += rawArgs;
    else if (rawArgs && typeof rawArgs === "object") current.arguments = JSON.stringify(rawArgs);
    calls.set(index, current);
  }
}

function finalizeCalls(calls: Map<number, ToolAccumulator>): ToolCallDraft[] {
  return [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call], index) => ({
      id: call.id || `call_${index}_${call.name || "tool"}`,
      name: call.name,
      arguments: call.arguments,
    }))
    .filter((call) => call.name.length > 0);
}

function normalizeToolCalls(value: unknown): ToolCallDraft[] {
  if (!Array.isArray(value)) return [];
  const drafts: ToolCallDraft[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      id?: string;
      function?: { name?: string; arguments?: unknown };
    };
    const name = record.function?.name;
    if (!name) continue;
    const rawArgs = record.function?.arguments;
    let args = "";
    if (typeof rawArgs === "string") args = rawArgs;
    else if (rawArgs && typeof rawArgs === "object") args = JSON.stringify(rawArgs);
    drafts.push({ id: record.id || `call_${index}_${name}`, name, arguments: args });
  }
  return drafts;
}

function readCompletion(payload: unknown, onText: (delta: string) => void): Completion {
  if (!payload || typeof payload !== "object") {
    throw new Error("The model returned an unreadable response");
  }
  const record = payload as { error?: { message?: string } | string; choices?: unknown };
  if (record.error) {
    const message = typeof record.error === "string" ? record.error : record.error.message;
    throw new Error(message || "The model returned an error");
  }
  const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
  if (!choice || typeof choice !== "object") throw new Error("The model returned no choices");
  const message = (choice as { message?: unknown; delta?: unknown }).message;
  const source = message && typeof message === "object" ? message : (choice as { delta?: unknown }).delta;
  if (!source || typeof source !== "object") throw new Error("The model returned an empty message");
  const contentValue = (source as { content?: unknown }).content;
  const content = typeof contentValue === "string" ? contentValue : "";
  if (content) onText(content);
  return { content, toolCalls: normalizeToolCalls((source as { tool_calls?: unknown }).tool_calls) };
}

async function readSse(
  response: Response,
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<Completion> {
  if (!response.body) throw new Error("The model returned an empty body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let full = "";
  let content = "";
  let sawData = false;
  const calls = new Map<number, ToolAccumulator>();

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    sawData = true;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json && typeof json === "object" && "error" in json && (json as { error?: unknown }).error) {
      const error = (json as { error?: { message?: string } | string }).error;
      const message = typeof error === "string" ? error : error?.message;
      throw new Error(message || "The model stream returned an error");
    }
    const choices = (json as { choices?: unknown }).choices;
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    const delta = choice && typeof choice === "object" ? (choice as { delta?: unknown }).delta : undefined;
    if (!delta || typeof delta !== "object") return;
    const text = (delta as { content?: unknown }).content;
    if (typeof text === "string" && text) {
      content += text;
      onText(text);
    }
    absorbToolDelta(calls, (delta as { tool_calls?: unknown }).tool_calls);
  };

  for (;;) {
    if (signal.aborted) {
      await reader.cancel();
      throw new DOMException("Aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
    full += chunk;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = done ? "" : (lines.pop() ?? "");
    for (const line of lines) consumeLine(line);
    if (done) break;
  }

  if (!sawData && full.trim().startsWith("{")) {
    return readCompletion(JSON.parse(full) as unknown, onText);
  }
  return { content, toolCalls: finalizeCalls(calls) };
}

export async function completeChat(options: {
  messages: ChatMessage[];
  tools: unknown[];
  signal: AbortSignal;
  onText: (delta: string) => void;
}): Promise<Completion> {
  const config = getConfig();
  if (!/^https?:\/\//.test(config.openaiBase)) {
    throw new Error("OPENAI_BASE_URL must start with http:// or https://");
  }

  const response = await fetch(`${config.openaiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: options.messages,
      tools: options.tools,
      stream: true,
      temperature: 0.2,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(formatProviderError(response.status, await response.text()));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return readCompletion((await response.json()) as unknown, options.onText);
  }
  return readSse(response, options.onText, options.signal);
}
