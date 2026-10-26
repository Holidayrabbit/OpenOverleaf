import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { launchSpec, resolveCommand, texInstallHint } from "./platform.js";
import { runProcess, toolEnv } from "./process.js";
import { relevantLog } from "./text.js";

export const TEX_HINT = texInstallHint();

export interface CompileResult {
  ok: boolean;
  reason: string;
  log: string;
  hint?: string;
  pdf?: string;
}

export function pdfPath(root: string): string {
  return path.join(root, "build", "main.pdf");
}

export async function commandAvailable(command: string): Promise<boolean> {
  return (await resolveCommand(command)) !== null;
}

async function readLog(root: string, fallback: string): Promise<string> {
  try {
    const file = await readFile(path.join(root, "build", "main.log"), "utf8");
    if (file.trim()) return file;
  } catch {
    // The console transcript is enough when LaTeX did not write a log.
  }
  return fallback;
}

export async function compileProject(root: string): Promise<CompileResult> {
  try {
    await access(path.join(root, "main.tex"));
  } catch {
    return {
      ok: false,
      reason: "missing-entry",
      log: "",
      hint: "Add main.tex to the project root. OpenOverleaf compiles that file.",
    };
  }

  const [latexmk, pdflatex] = await Promise.all([resolveCommand("latexmk"), resolveCommand("pdflatex")]);
  if (!latexmk && !pdflatex) {
    return { ok: false, reason: "tex-missing", log: "", hint: TEX_HINT };
  }

  await mkdir(path.join(root, "build"), { recursive: true });
  const env = toolEnv();

  let code = 1;
  let output = "";
  let timedOut = false;

  const runTool = async (executable: string, args: string[], timeoutMs: number) => {
    const spec = launchSpec(executable, args);
    return runProcess({
      command: spec.command,
      args: spec.args,
      verbatim: spec.verbatim,
      cwd: root,
      timeoutMs,
      maxOutput: 400_000,
      env,
    });
  };

  if (latexmk) {
    const run = await runTool(latexmk, [
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-synctex=0",
      "-outdir=build",
      "main.tex",
    ], 90_000);
    code = run.code;
    output = run.output;
    timedOut = run.timedOut;
    if (run.spawnError === "ENOENT") {
      return {
        ok: false,
        reason: "tex-missing",
        log: output,
        hint: `${TEX_HINT} Found a path but could not start it: ${latexmk}`,
      };
    }
  } else if (pdflatex) {
    for (let pass = 0; pass < 2; pass += 1) {
      const run = await runTool(pdflatex, [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-synctex=0",
        "-output-directory=build",
        "main.tex",
      ], 60_000);
      code = run.code;
      output += run.output;
      timedOut = run.timedOut;
      if (run.spawnError === "ENOENT") {
        return {
          ok: false,
          reason: "tex-missing",
          log: output,
          hint: `${TEX_HINT} Found a path but could not start it: ${pdflatex}`,
        };
      }
      if (code !== 0 || timedOut) break;
    }
  }

  const log = relevantLog(await readLog(root, output));
  if (timedOut) {
    return {
      ok: false,
      reason: "timeout",
      log,
      hint: "Compilation exceeded the time limit and was stopped.",
    };
  }

  let pdfExists = false;
  try {
    await access(pdfPath(root));
    pdfExists = true;
  } catch {
    pdfExists = false;
  }

  if (code === 0 && pdfExists) {
    return { ok: true, reason: "ok", log, pdf: "build/main.pdf" };
  }

  return {
    ok: false,
    reason: "compile-error",
    log,
    hint: "The build failed. The log below is the place to look.",
  };
}

export function formatCompileResult(result: CompileResult): string {
  const header = [
    `ok: ${result.ok}`,
    `reason: ${result.reason}`,
    result.hint ? `hint: ${result.hint}` : "",
    result.pdf ? `pdf: ${result.pdf}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return result.log ? `${header}\n---\n${result.log}` : header;
}
