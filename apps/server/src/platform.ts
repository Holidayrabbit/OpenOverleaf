import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { shellEnv } from "./process.js";

export interface ShellLaunch {
  file: string;
  args: string[];
}

export interface CommandLaunch {
  command: string;
  args: string[];
  verbatim: boolean;
}

const COMMAND_NAME = /^[A-Za-z0-9._+-]+$/;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function texInstallHint(platform: NodeJS.Platform = process.platform): string {
  const lead =
    "TeX is not on PATH. Install a distribution that provides pdflatex or latexmk, open a new terminal so PATH updates, then restart OpenOverleaf.";
  if (platform === "win32") {
    return `${lead} Windows: install MiKTeX (https://miktex.org) or TeX Live, and let the installer add the bin directory to PATH.`;
  }
  if (platform === "darwin") {
    return `${lead} macOS: brew install --cask mactex-no-gui, or install BasicTeX, and make sure /Library/TeX/texbin is on PATH.`;
  }
  return `${lead} Linux: sudo apt install texlive-latex-base latexmk, or install TeX Live and add its bin directory to PATH.`;
}

export function ptyInstallHint(platform: NodeJS.Platform = process.platform): string {
  const lead = "The editor, preview, and agent keep working.";
  if (platform === "win32") {
    return `node-pty did not load. Windows x64 and arm64 usually get a prebuild; if install compiled from source, install the Visual Studio Build Tools "Desktop development with C++" workload and Python 3, then run pnpm install again. The integrated terminal needs Windows 10 version 1903 (build 18309) or newer. ${lead}`;
  }
  if (platform === "darwin") {
    return `node-pty did not load. macOS usually gets a prebuild; if install compiled from source, run xcode-select --install and then pnpm install again. ${lead}`;
  }
  return `node-pty did not load. This package has no Linux prebuild, so pnpm install must compile it. Install python3, make, and g++ (Debian/Ubuntu: sudo apt install python3 make g++), then run pnpm install again. ${lead}`;
}

export function windowsBuild(platform: NodeJS.Platform = process.platform, release = os.release()): number | null {
  if (platform !== "win32") return null;
  const build = Number(release.split(".")[2]);
  return Number.isInteger(build) ? build : null;
}

/** Prefer OPENOVERLEAF_SHELL. TEXAGENT_SHELL remains so older .env files still work. */
export function configuredShell(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env.OPENOVERLEAF_SHELL?.trim() || env.TEXAGENT_SHELL?.trim();
  return named || undefined;
}

export function shellNotes(): string {
  const custom = configuredShell();
  if (custom) {
    return `run_terminal and the integrated terminal use OPENOVERLEAF_SHELL (${custom}). Write commands for that shell. run_terminal times out after 15 seconds.`;
  }
  if (process.platform === "win32") {
    return "run_terminal uses Windows PowerShell (powershell.exe -NoProfile -NonInteractive), then pwsh.exe, then cmd.exe. Windows PowerShell 5.1 does not support &&. The integrated terminal is interactive PowerShell and loads the user profile. run_terminal times out after 15 seconds.";
  }
  return "run_terminal uses bash --noprofile --norc -c when /bin/bash exists, otherwise sh -c. The integrated terminal uses SHELL, then bash, zsh, or sh. run_terminal times out after 15 seconds.";
}

/** Names Windows rejects, including `nul.tex`. Checked on every OS so a project stays movable. */
export function portablePathProblem(segment: string): string | null {
  if (/[<>:"|?*]/.test(segment) || /[\u0000-\u001f]/.test(segment)) {
    return `"${segment}" contains a character Windows cannot use in a file name`;
  }
  if (segment.endsWith(" ") || segment.endsWith(".")) {
    return `"${segment}" ends with a space or dot, which Windows strips`;
  }
  const device = segment.split(".")[0] ?? segment;
  if (RESERVED_DEVICE.test(device)) {
    return `"${segment}" is a reserved device name on Windows`;
  }
  return null;
}

export function quoteCmdArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^%]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function powershellEncodedArgs(command: string): string[] {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "$ErrorActionPreference = 'Stop'",
    command,
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
}

function isRejectedShell(file: string): boolean {
  return /(?:^|[\\/])(nologin|false)(?:\.exe)?$/i.test(file);
}

function isAbsoluteShell(file: string): boolean {
  return file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(file);
}

function interactiveArgs(file: string): string[] {
  const lower = file.toLowerCase();
  if (lower.endsWith("powershell.exe") || lower.endsWith("pwsh.exe") || lower.endsWith("powershell") || lower.endsWith("pwsh")) {
    return ["-NoLogo"];
  }
  if (lower.endsWith("cmd.exe") || lower.endsWith("\\cmd") || lower.endsWith("/cmd") || lower === "cmd") {
    return ["/d"];
  }
  return [];
}

export function interactiveShells(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (file: string) => boolean;
}): ShellLaunch[] {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const exists = options?.exists ?? existsSync;
  const shells: ShellLaunch[] = [];
  const push = (file: string | undefined, args?: string[]) => {
    if (!file) return;
    const trimmed = file.trim();
    if (!trimmed || isRejectedShell(trimmed)) return;
    if (isAbsoluteShell(trimmed) && !exists(trimmed)) return;
    if (shells.some((shell) => shell.file === trimmed)) return;
    shells.push({ file: trimmed, args: args ?? interactiveArgs(trimmed) });
  };

  push(configuredShell(env));
  if (platform === "win32") {
    push("powershell.exe");
    push("pwsh.exe");
    push("cmd.exe");
    return shells;
  }

  push(env.SHELL, []);
  for (const file of ["/bin/bash", "/bin/zsh", "/bin/sh"]) {
    if (exists(file)) push(file, []);
  }
  if (shells.length === 0) push("sh", []);
  return shells;
}

export function scriptCommands(
  command: string,
  options?: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    exists?: (file: string) => boolean;
  },
): CommandLaunch[] {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const exists = options?.exists ?? existsSync;
  const launches: CommandLaunch[] = [];
  const push = (launch: CommandLaunch) => {
    const key = `${launch.command}\n${launch.args.join("\n")}`;
    if (launches.some((item) => `${item.command}\n${item.args.join("\n")}` === key)) return;
    launches.push(launch);
  };

  const custom = configuredShell(env);
  if (custom && !isRejectedShell(custom) && (!isAbsoluteShell(custom) || exists(custom))) {
    push(scriptLaunch(custom, command));
  }
  if (platform === "win32") {
    push({ command: "powershell.exe", args: powershellEncodedArgs(command), verbatim: false });
    push({ command: "pwsh.exe", args: powershellEncodedArgs(command), verbatim: false });
    push({ command: "cmd.exe", args: ["/d", "/s", "/c", command], verbatim: false });
    return launches;
  }
  if (exists("/bin/bash")) push({ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", command], verbatim: false });
  if (exists("/bin/sh")) push({ command: "/bin/sh", args: ["-c", command], verbatim: false });
  if (launches.length === 0) push({ command: "sh", args: ["-c", command], verbatim: false });
  return launches;
}

function scriptLaunch(file: string, command: string): CommandLaunch {
  const lower = file.toLowerCase();
  if (lower.endsWith("powershell.exe") || lower.endsWith("pwsh.exe") || lower.endsWith("powershell") || lower.endsWith("pwsh")) {
    return { command: file, args: powershellEncodedArgs(command), verbatim: false };
  }
  if (lower.endsWith("cmd.exe") || lower.endsWith("\\cmd") || lower.endsWith("/cmd") || lower === "cmd") {
    return { command: file, args: ["/d", "/s", "/c", command], verbatim: false };
  }
  if (lower.endsWith("bash") || lower.endsWith("bash.exe")) {
    return { command: file, args: ["--noprofile", "--norc", "-c", command], verbatim: false };
  }
  return { command: file, args: ["-c", command], verbatim: false };
}

/**
 * Run a Windows batch shim through cmd.exe. `verbatim` means the caller must not
 * let Node quote the arguments again: the `/s /c` switch strips one pair of quotes.
 */
export function launchSpec(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): CommandLaunch {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    const inner = [executable, ...args].map(quoteCmdArg).join(" ");
    return {
      command: env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${inner}"`],
      verbatim: true,
    };
  }
  return { command: executable, args, verbatim: false };
}

export function ptyEnvironment(): Record<string, string> {
  const env = shellEnv();
  if (process.platform === "win32") {
    delete env.TERM;
    if (!env.SystemRoot && !env.SYSTEMROOT) env.SystemRoot = env.windir || "C:\\Windows";
  }
  return env;
}

function firstAbsolute(output: string, windows: boolean): string | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith("info:")) continue;
    if (windows) {
      if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) return trimmed;
      continue;
    }
    if (trimmed.startsWith("/")) return trimmed;
  }
  return null;
}

function capture(command: string, args: string[]): Promise<{ code: number; output: string } | null> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: { code: number; output: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The lookup already exited.
      }
      finish(null);
    }, 4000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish({ code: code ?? 1, output }));
  });
}

/** Resolve `latexmk` / `pdflatex` to an absolute path, including Windows PATHEXT (.exe, .cmd, .bat). */
export async function resolveCommand(name: string): Promise<string | null> {
  if (!COMMAND_NAME.test(name)) return null;
  if (process.platform === "win32") {
    const found = await capture("where.exe", [name]);
    return found && found.code === 0 ? firstAbsolute(found.output, true) : null;
  }
  const which = await capture("which", [name]);
  if (which && which.code === 0) {
    const resolved = firstAbsolute(which.output, false);
    if (resolved) return resolved;
  }
  const viaShell = await capture("/bin/sh", ["-c", `command -v ${name}`]);
  if (viaShell && viaShell.code === 0) return firstAbsolute(viaShell.output, false);
  return null;
}
