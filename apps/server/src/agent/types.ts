export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type PublicMessage = Exclude<ChatMessage, { role: "system" }>;

export interface ToolCallDraft {
  id: string;
  name: string;
  arguments: string;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; result: string }
  | { type: "error"; message: string }
  | { type: "done"; messages: PublicMessage[] };
