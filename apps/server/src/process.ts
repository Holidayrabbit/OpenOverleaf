import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface ProcessResult {
  code: number;
  output: string;
  timedOut: boolean;
  /** Set when the executable could not be started. `ENOENT` means try another shell. */
  spawnError?: string;
}

export function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: "dumb", NO_COLOR: "1" };
  delete env.OPENAI_API_KEY;
  return env;
}

export function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || key === "OPENAI_API_KEY") continue;
    env[key] = value;
  }
  env.TERM = "xterm-256color";
  return env;
}

function stop(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const args = ["/PID", String(child.pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    try {
      const killed = spawnSync("taskkill.exe", args, { windowsHide: true, stdio: "ignore" });
      if (killed.status === 0) return;
    } catch {
      // taskkill is missing; fall through to child.kill.
    }
  } else {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already be gone.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}

export function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutput?: number;
  env?: NodeJS.ProcessEnv;
  /** Windows-only. Set when args are already quoted for cmd.exe /s /c. */
  verbatim?: boolean;
}): Promise<ProcessResult> {
  const maxOutput = options.maxOutput ?? 200_000;
  const env = options.env ?? toolEnv();

  return new Promise((resolve) => {
    let output = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    let safety: NodeJS.Timeout | undefined;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      windowsVerbatimArguments: options.verbatim === true,
    });

    const finish = (code: number, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(safety);
      if (killTimer) clearTimeout(killTimer);
      if (truncated) output += "\n…[output truncated]";
      resolve({ code, output, timedOut, spawnError });
    };

    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > maxOutput) {
        output = output.slice(-maxOutput);
        truncated = true;
        stop(child, "SIGKILL");
      }
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error: NodeJS.ErrnoException) => {
      output += error.message;
      finish(1, error.code);
    });
    child.on("close", (code) => finish(code ?? 1));

    timer = setTimeout(() => {
      timedOut = true;
      stop(child, "SIGTERM");
      killTimer = setTimeout(() => stop(child, "SIGKILL"), 1500);
    }, options.timeoutMs);

    safety = setTimeout(() => {
      timedOut = true;
      stop(child, "SIGKILL");
      finish(1);
    }, options.timeoutMs + 4000);
  });
}
