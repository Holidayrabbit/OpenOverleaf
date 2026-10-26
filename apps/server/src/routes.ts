import type { Express, RequestHandler } from "express";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "./agent/loop.js";
import type { PublicMessage, ToolCall } from "./agent/types.js";
import { commandAvailable, compileProject, pdfPath, TEX_HINT } from "./compile.js";
import { getConfig, workspaceDir } from "./config.js";
import { clip } from "./text.js";
import {
  listTree,
  readProjectFile,
  removeProjectFile,
  WorkspaceError,
  writeProjectFile,
} from "./workspace.js";

function asyncHandler(fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function queryPath(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new WorkspaceError("Invalid tool calls");
  return value.map((entry) => {
    const record = asRecord(entry);
    const fn = record ? asRecord(record.function) : null;
    if (!record || typeof record.id !== "string" || !fn || typeof fn.name !== "string" || typeof fn.arguments !== "string") {
      throw new WorkspaceError("Invalid tool call");
    }
    return { id: record.id, type: "function", function: { name: fn.name, arguments: clip(fn.arguments, 100_000) } };
  });
}

export function parseMessages(input: unknown): PublicMessage[] {
  if (!Array.isArray(input)) throw new WorkspaceError("messages must be an array");
  if (input.length > 40) throw new WorkspaceError("Too many messages");
  return input.map((entry) => {
    const record = asRecord(entry);
    if (!record) throw new WorkspaceError("Invalid message");
    if (record.role === "user") {
      if (typeof record.content !== "string") throw new WorkspaceError("Invalid user message");
      return { role: "user", content: clip(record.content, 100_000) };
    }
    if (record.role === "assistant") {
      if (record.content !== null && typeof record.content !== "string") {
        throw new WorkspaceError("Invalid assistant message");
      }
      const toolCalls = parseToolCalls(record.tool_calls);
      const message: PublicMessage = {
        role: "assistant",
        content: record.content === null ? null : clip(record.content, 100_000),
      };
      if (toolCalls.length > 0 && message.role === "assistant") message.tool_calls = toolCalls;
      return message;
    }
    if (record.role === "tool") {
      if (typeof record.tool_call_id !== "string" || typeof record.content !== "string") {
        throw new WorkspaceError("Invalid tool message");
      }
      return { role: "tool", tool_call_id: record.tool_call_id, content: clip(record.content, 100_000) };
    }
    throw new WorkspaceError("Unsupported message role");
  });
}

export function registerApi(app: Express): void {
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/status", asyncHandler(async (_req, res) => {
    const root = workspaceDir();
    const [pdflatex, latexmk] = await Promise.all([
      commandAvailable("pdflatex"),
      commandAvailable("latexmk"),
    ]);
    let pdf = false;
    try {
      await stat(pdfPath(root));
      pdf = true;
    } catch {
      pdf = false;
    }
    const config = getConfig();
    res.json({
      version: "0.1.0",
      workspaceLabel: path.basename(root),
      tex: {
        pdflatex,
        latexmk,
        hint: pdflatex || latexmk ? undefined : TEX_HINT,
      },
      agent: {
        configured: Boolean(config.openaiKey),
        model: config.openaiModel,
      },
      pdf,
    });
  }));

  app.get("/api/files", asyncHandler(async (req, res) => {
    const files = await listTree(workspaceDir(), queryPath(req.query.path) ?? ".");
    res.json({ files });
  }));

  app.get("/api/file", asyncHandler(async (req, res) => {
    const filePath = queryPath(req.query.path);
    if (!filePath) throw new WorkspaceError("Path is required");
    res.json(await readProjectFile(workspaceDir(), filePath));
  }));

  app.put("/api/file", asyncHandler(async (req, res) => {
    const body = asRecord(req.body);
    if (!body || typeof body.path !== "string" || typeof body.content !== "string") {
      throw new WorkspaceError("Expected path and content strings");
    }
    res.json(await writeProjectFile(workspaceDir(), body.path, body.content));
  }));

  app.delete("/api/file", asyncHandler(async (req, res) => {
    const filePath = queryPath(req.query.path);
    if (!filePath) throw new WorkspaceError("Path is required");
    await removeProjectFile(workspaceDir(), filePath);
    res.json({ ok: true });
  }));

  app.post("/api/compile", asyncHandler(async (_req, res) => {
    res.json(await compileProject(workspaceDir()));
  }));

  app.get("/api/pdf", asyncHandler(async (req, res) => {
    const file = pdfPath(workspaceDir());
    try {
      await stat(file);
    } catch {
      res.status(404).json({ error: "No PDF yet. Compile the project first." });
      return;
    }
    const download = req.query.download === "1" || req.query.download === "true";
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="main.pdf"`);
    res.sendFile(file);
  }));

  app.post("/api/agent", asyncHandler(async (req, res) => {
    const body = asRecord(req.body);
    const messages = parseMessages(body?.messages ?? []);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abort = new AbortController();
    // `req` "close" also fires after the body is read, which would cancel a healthy turn.
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const send = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await runAgent({
        messages,
        signal: abort.signal,
        emit: (event) => {
          if (event.type === "text") send("text", { delta: event.delta });
          else if (event.type === "tool_start") send("tool_start", event);
          else if (event.type === "tool_end") send("tool_end", event);
          else if (event.type === "error") send("error", { message: event.message });
          else send("done", { messages: event.messages });
        },
      });
    } catch (error) {
      if (abort.signal.aborted) return;
      console.error(error);
      const message = error instanceof Error ? error.message : "Agent failed";
      send("error", { message });
    } finally {
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // The client already went away.
        }
      }
    }
  }));
}

export function apiErrorHandler(
  err: unknown,
  _req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): void {
  void next;
  if (res.headersSent) return;
  if (err instanceof WorkspaceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && err.message.toLowerCase().includes("json")) {
    res.status(400).json({ error: "Request body must be JSON" });
    return;
  }
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
