import { compileProject, formatCompileResult } from "../compile.js";
import { workspaceDir } from "../config.js";
import { scriptCommands } from "../platform.js";
import { runProcess } from "../process.js";
import { clip } from "../text.js";
import {
  flattenTree,
  listTree,
  readProjectFile,
  WorkspaceError,
  writeProjectFile,
} from "../workspace.js";

export const toolSchemas = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in the LaTeX project. Paths are relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Optional subdirectory relative to the project root. Omit to list the whole project.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the project root." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a UTF-8 text file. Send the complete file contents. Parent directories are created.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the project root." },
          content: { type: "string", description: "Full new contents of the file." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal",
      description:
        "Run a short non-interactive command in the project directory. PowerShell on Windows, bash or sh on macOS and Linux, unless OPENOVERLEAF_SHELL is set. Output is truncated and the command is killed after 15 seconds. Do not start editors, pagers, or servers.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compile_latex",
      description: "Compile main.tex with latexmk or pdflatex and return the log.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${key} is required`);
  }
  return value;
}

async function listFiles(args: Record<string, unknown>): Promise<string> {
  const raw = typeof args.path === "string" && args.path.trim() ? args.path : ".";
  const lines = flattenTree(await listTree(workspaceDir(), raw));
  if (lines.length === 0) return "(empty)";
  if (lines.length > 500) return `${lines.slice(0, 500).join("\n")}\n…[truncated]`;
  return lines.join("\n");
}

async function readFile(args: Record<string, unknown>): Promise<string> {
  const file = await readProjectFile(workspaceDir(), requiredString(args, "path"));
  if (file.binary) throw new WorkspaceError(`${file.path} is binary`);
  const lines = file.content.length === 0 ? 0 : file.content.split(/\r?\n/).length;
  return `${file.path} (${lines} lines)\n---\n${clip(file.content, 12_000)}`;
}

async function writeFile(args: Record<string, unknown>): Promise<string> {
  const content = args.content;
  if (typeof content !== "string") throw new WorkspaceError("content must be a string");
  const written = await writeProjectFile(workspaceDir(), requiredString(args, "path"), content);
  return `Wrote ${written.path} (${written.bytes} bytes)`;
}

async function runTerminal(args: Record<string, unknown>): Promise<string> {
  const command = requiredString(args, "command");
  if (command.length > 4000) throw new WorkspaceError("Command is too long");
  const attempts = scriptCommands(command);
  const first = attempts[0];
  if (!first) throw new WorkspaceError("No shell is available");
  let run = await runProcess({
    command: first.command,
    args: first.args,
    verbatim: first.verbatim,
    cwd: workspaceDir(),
    timeoutMs: 15_000,
    maxOutput: 64_000,
  });
  for (let index = 1; index < attempts.length && run.spawnError === "ENOENT"; index += 1) {
    const attempt = attempts[index];
    if (!attempt) break;
    run = await runProcess({
      command: attempt.command,
      args: attempt.args,
      verbatim: attempt.verbatim,
      cwd: workspaceDir(),
      timeoutMs: 15_000,
      maxOutput: 64_000,
    });
  }
  if (run.spawnError === "ENOENT") {
    const tried = attempts.map((attempt) => attempt.command).join(", ");
    throw new WorkspaceError(`Could not start a shell. Tried: ${tried}`);
  }
  const status = run.timedOut ? "timeout after 15s" : String(run.code);
  const body = clip(run.output.trim(), 12_000);
  return body ? `exit: ${status}\n---\n${body}` : `exit: ${status}`;
}

async function compile(): Promise<string> {
  return formatCompileResult(await compileProject(workspaceDir()));
}

async function dispatch(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "list_files":
      return listFiles(args);
    case "read_file":
      return readFile(args);
    case "write_file":
      return writeFile(args);
    case "run_terminal":
      return runTerminal(args);
    case "compile_latex":
      return compile();
    default:
      throw new WorkspaceError(`Unknown tool ${name}`);
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result: string }> {
  try {
    const result = await dispatch(name, args);
    const failedCompile = name === "compile_latex" && result.startsWith("ok: false");
    return { ok: !failedCompile, result: clip(result, 12_000) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    return { ok: false, result: clip(`Error: ${message}`, 12_000) };
  }
}
