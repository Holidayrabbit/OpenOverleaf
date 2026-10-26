import { shellNotes } from "../platform.js";
import { getConfig } from "../config.js";
import { completeChat } from "./openai.js";
import { executeTool, toolSchemas } from "./tools.js";
import type { AgentEvent, ChatMessage, PublicMessage, ToolCall } from "./types.js";

const MAX_ROUNDS = 8;

export const MISSING_KEY_MESSAGE =
  "The agent needs an OpenAI-compatible API key. Set OPENAI_API_KEY in the repo root .env (see .env.example), then restart the server. Optional: OPENAI_BASE_URL and OPENAI_MODEL. The editor, preview, and terminal work without a key.";

const SYSTEM_PROMPT = `You are the editing assistant inside OpenOverleaf, a local LaTeX studio.
The user is working on a project stored on disk. Paths are relative to the project root. The compile entrypoint is main.tex.

Use the tools to inspect and change the project. Do not invent file contents; read a file before rewriting it. Prefer the smallest edit that does the job, and write the complete file when you use write_file.

After LaTeX edits, call compile_latex and fix real errors before saying the document builds. Quote the relevant log line when a build fails.

run_terminal is for short, non-interactive commands. It times out and truncates output. Do not use it for editors, pagers, or servers.

Do not claim a file changed or a build succeeded unless a tool result says so.
Answer in the same language the user writes in. Be concise.`;

function publicMessages(messages: ChatMessage[]): PublicMessage[] {
  return messages.filter((message): message is PublicMessage => message.role !== "system");
}

function parseArgs(raw: string): { args: Record<string, unknown>; error: string | null } {
  if (!raw.trim()) return { args: {}, error: null };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { args: {}, error: "Error: tool arguments were not a JSON object" };
    }
    return { args: value as Record<string, unknown>, error: null };
  } catch {
    return { args: {}, error: "Error: tool arguments were not valid JSON" };
  }
}

export async function runAgent(options: {
  messages: PublicMessage[];
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
}): Promise<void> {
  const { emit, signal } = options;
  if (!getConfig().openaiKey) {
    emit({ type: "text", delta: MISSING_KEY_MESSAGE });
    emit({
      type: "done",
      messages: [...options.messages, { role: "assistant", content: MISSING_KEY_MESSAGE }],
    });
    return;
  }

  const history: ChatMessage[] = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${shellNotes()}` }, ...options.messages];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (signal.aborted) return;
    const turn = await completeChat({
      messages: history,
      tools: toolSchemas,
      signal,
      onText: (delta) => emit({ type: "text", delta }),
    });

    if (turn.toolCalls.length === 0) {
      history.push({ role: "assistant", content: turn.content });
      emit({ type: "done", messages: publicMessages(history) });
      return;
    }

    const calls: ToolCall[] = turn.toolCalls.map((call, index) => ({
      id: call.id || `call_${round}_${index}`,
      type: "function",
      function: { name: call.name, arguments: call.arguments || "{}" },
    }));
    history.push({ role: "assistant", content: turn.content || null, tool_calls: calls });
    console.log(`agent round ${round + 1} tools=${calls.map((call) => call.function.name).join(",")}`);

    for (const call of calls) {
      if (signal.aborted) return;
      const parsed = parseArgs(call.function.arguments);
      emit({ type: "tool_start", id: call.id, name: call.function.name, args: parsed.args });
      const outcome = parsed.error
        ? { ok: false, result: parsed.error }
        : await executeTool(call.function.name, parsed.args);
      emit({
        type: "tool_end",
        id: call.id,
        name: call.function.name,
        ok: outcome.ok,
        result: outcome.result,
      });
      history.push({ role: "tool", tool_call_id: call.id, content: outcome.result });
    }
  }

  const note = "Stopped after 8 tool rounds. Say how you want to continue.";
  emit({ type: "text", delta: note });
  history.push({ role: "assistant", content: note });
  emit({ type: "done", messages: publicMessages(history) });
}
