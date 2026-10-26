import type { Server } from "node:http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { workspaceDir } from "./config.js";
import {
  interactiveShells,
  ptyEnvironment,
  ptyInstallHint,
  type ShellLaunch,
  windowsBuild,
} from "./platform.js";

interface PtyProcess {
  onData: (listener: (data: string) => void) => { dispose?: () => void };
  onExit: (listener: () => void) => { dispose?: () => void };
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ) => PtyProcess;
}

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function asPty(mod: unknown): PtyModule | null {
  if (!mod || typeof mod !== "object") return null;
  const record = mod as { spawn?: unknown; default?: { spawn?: unknown } };
  if (typeof record.spawn === "function") return record as PtyModule;
  if (record.default && typeof record.default.spawn === "function") return record.default as PtyModule;
  return null;
}

let ptyPromise: Promise<PtyModule | null> | undefined;
let ptyLoadError = "node-pty is not available";

function loadPty(): Promise<PtyModule | null> {
  ptyPromise ??= import("node-pty")
    .then((mod: unknown) => {
      const pty = asPty(mod);
      if (!pty) ptyLoadError = "node-pty loaded but did not export spawn";
      return pty;
    })
    .catch((error: unknown) => {
      ptyLoadError = error instanceof Error ? error.message : "node-pty failed to load";
      return null;
    });
  return ptyPromise;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Ignore a single frame that cannot be encoded.
  }
}

function fail(socket: WebSocket, message: string): void {
  const text = message.replaceAll("\r", "").replaceAll("\n", "\r\n");
  send(socket, { type: "output", data: `\r\n\x1b[33m[terminal unavailable]\x1b[0m\r\n${text}\r\n` });
  send(socket, { type: "status", available: false, message });
  socket.close();
}

function spawnFailure(error: unknown, shells: ShellLaunch[]): string {
  const reason = error instanceof Error ? error.message : "Could not start a shell";
  const build = windowsBuild();
  const old =
    build !== null && build < 18309
      ? " This Windows build is older than 18309 (Windows 10 version 1903), which is the minimum for the ConPTY terminal."
      : "";
  return `${reason}.${old} Tried ${shells.map((shell) => shell.file).join(", ") || "no shell"}.`;
}

function openShell(pty: PtyModule, shells: ShellLaunch[]): PtyProcess {
  let last: unknown = new Error("No shell candidates");
  for (const shell of shells) {
    try {
      return pty.spawn(shell.file, shell.args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: workspaceDir(),
        env: ptyEnvironment(),
      });
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Could not start a shell");
}

export function attachTerminal(server: Server): { close: () => void; ready: Promise<string> } {
  const wss = new WebSocketServer({ server, path: "/ws/terminal" });
  const terms = new Set<PtyProcess>();
  let logged = false;

  const ready = loadPty().then((pty) => {
    if (!pty) {
      const message = `${ptyLoadError}. ${ptyInstallHint()}`;
      console.error(`terminal unavailable: ${message}`);
      logged = true;
      return `unavailable (${ptyLoadError})`;
    }
    const shells = interactiveShells().map((shell) => shell.file).join(", ");
    return `ready (${shells})`;
  });

  wss.on("connection", (socket) => {
    void (async () => {
      const pty = await loadPty();
      if (!pty) {
        const message = `${ptyLoadError}. ${ptyInstallHint()}`;
        if (!logged) {
          console.error(`terminal unavailable: ${message}`);
          logged = true;
        }
        fail(socket, message);
        return;
      }

      const shells = interactiveShells();
      let term: PtyProcess;
      try {
        term = openShell(pty, shells);
      } catch (error) {
        fail(socket, spawnFailure(error, shells));
        return;
      }

      terms.add(term);
      const ping = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping();
      }, 30_000);

      term.onData((data) => send(socket, { type: "output", data }));
      term.onExit(() => {
        terms.delete(term);
        send(socket, { type: "output", data: "\r\n[process exited]\r\n" });
      });

      socket.on("message", (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawToString(raw));
        } catch {
          return;
        }
        const message = asRecord(parsed);
        if (!message) return;
        if (message.type === "input" && typeof message.data === "string") {
          try {
            term.write(message.data);
          } catch {
            // The shell already exited.
          }
          return;
        }
        if (message.type === "resize") {
          const cols = clamp(message.cols, 2, 500);
          const rows = clamp(message.rows, 1, 200);
          if (!cols || !rows) return;
          try {
            term.resize(cols, rows);
          } catch {
            // The shell already exited.
          }
        }
      });

      const shutdown = () => {
        clearInterval(ping);
        terms.delete(term);
        try {
          term.kill();
        } catch {
          // The shell already exited.
        }
      };
      socket.on("close", shutdown);
      socket.on("error", shutdown);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "terminal failed";
      fail(socket, message);
    });
  });

  return {
    ready,
    close() {
      for (const term of terms) {
        try {
          term.kill();
        } catch {
          // Already gone.
        }
      }
      terms.clear();
      wss.close();
    },
  };
}
