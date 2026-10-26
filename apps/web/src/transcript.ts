import type { ApiMessage, TranscriptItem, ToolTrace } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isApiMessage(value: unknown): value is ApiMessage {
  const record = asRecord(value);
  if (!record) return false;
  if (record.role === "user") return typeof record.content === "string";
  if (record.role === "tool") return typeof record.tool_call_id === "string" && typeof record.content === "string";
  if (record.role === "assistant") return record.content === null || typeof record.content === "string";
  return false;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return asRecord(value) ?? {};
  } catch {
    return {};
  }
}

export function deriveTranscript(messages: ApiMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, ToolTrace>();
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ id: `user-${items.length}`, kind: "user", content: message.content });
    } else if (message.role === "assistant") {
      if (message.content) items.push({ id: `assistant-${items.length}`, kind: "assistant", content: message.content });
      for (const call of message.tool_calls ?? []) {
        const tool: ToolTrace = {
          id: call.id,
          name: call.function.name,
          args: parseArgs(call.function.arguments),
          result: "",
          ok: true,
          status: "done",
        };
        tools.set(call.id, tool);
        items.push({ id: call.id, kind: "tool", tool });
      }
    } else {
      const tool = tools.get(message.tool_call_id);
      if (tool) {
        tool.result = message.content;
        tool.ok = !message.content.startsWith("Error:") && !message.content.startsWith("ok: false");
      }
    }
  }
  return items;
}

export function appendDelta(items: TranscriptItem[], delta: string): TranscriptItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "assistant") {
    return [...items.slice(0, -1), { ...last, content: last.content + delta }];
  }
  return [...items, { id: crypto.randomUUID(), kind: "assistant", content: delta }];
}

export function samePath(a: string, b: string): boolean {
  const clean = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return clean(a) === clean(b);
}
