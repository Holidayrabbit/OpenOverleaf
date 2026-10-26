import assert from "node:assert/strict";
import test from "node:test";
import {
  interactiveShells,
  launchSpec,
  portablePathProblem,
  powershellEncodedArgs,
  quoteCmdArg,
  resolveCommand,
  scriptCommands,
  texInstallHint,
  windowsBuild,
} from "./platform.js";

test("shell selection follows the operating system", () => {
  const windows = interactiveShells({ platform: "win32", env: {}, exists: () => false });
  assert.deepEqual(
    windows.map((shell) => shell.file),
    ["powershell.exe", "pwsh.exe", "cmd.exe"],
  );
  assert.deepEqual(windows[0]?.args, ["-NoLogo"]);
  assert.deepEqual(windows[2]?.args, ["/d"]);

  const mac = interactiveShells({
    platform: "darwin",
    env: { SHELL: "/bin/zsh" },
    exists: (file) => file === "/bin/zsh" || file === "/bin/bash" || file === "/bin/sh",
  });
  assert.equal(mac[0]?.file, "/bin/zsh");
  assert.equal(mac[0]?.args.length, 0);
  assert.ok(mac.some((shell) => shell.file === "/bin/bash"));

  const locked = interactiveShells({
    platform: "linux",
    env: { SHELL: "/usr/sbin/nologin" },
    exists: (file) => file === "/bin/sh",
  });
  assert.deepEqual(locked, [{ file: "/bin/sh", args: [] }]);

  const custom = interactiveShells({
    platform: "win32",
    env: { OPENOVERLEAF_SHELL: "C:/Program Files/Git/bin/bash.exe" },
    exists: () => true,
  });
  assert.equal(custom[0]?.file, "C:/Program Files/Git/bin/bash.exe");
  assert.equal(custom[1]?.file, "powershell.exe");
});

test("agent commands use PowerShell on Windows and bash on Unix", () => {
  const windows = scriptCommands("Get-ChildItem", { platform: "win32", env: {}, exists: () => false });
  assert.equal(windows[0]?.command, "powershell.exe");
  assert.equal(windows[0]?.args[3], "-EncodedCommand");
  assert.equal(windows[2]?.command, "cmd.exe");

  const decoded = Buffer.from(powershellEncodedArgs("pwd").at(-1) ?? "", "base64").toString("utf16le");
  assert.match(decoded, /ErrorActionPreference = 'Stop'/);
  assert.match(decoded, /pwd/);

  const unix = scriptCommands("pwd", {
    platform: "linux",
    env: {},
    exists: (file) => file === "/bin/bash",
  });
  assert.deepEqual(unix, [{ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", "pwd"], verbatim: false }]);
});

test("Windows batch files are launched through cmd.exe without a second round of quoting", () => {
  const spec = launchSpec("C:\\Program Files\\MiKTeX\\latexmk.cmd", ["-pdf", "main.tex"], "win32", {
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  });
  assert.equal(spec.command, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(spec.verbatim, true);
  assert.deepEqual(spec.args.slice(0, 2), ["/d", "/s"]);
  assert.equal(spec.args[3], `""C:\\Program Files\\MiKTeX\\latexmk.cmd" -pdf main.tex"`);

  const exe = launchSpec("C:\\tex\\pdflatex.exe", ["main.tex"], "win32");
  assert.equal(exe.command, "C:\\tex\\pdflatex.exe");
  assert.deepEqual(exe.args, ["main.tex"]);
  assert.equal(exe.verbatim, false);

  assert.equal(quoteCmdArg("plain"), "plain");
  assert.equal(quoteCmdArg("my file.tex"), '"my file.tex"');
});

test("portable names reject Windows device names", () => {
  assert.equal(portablePathProblem("intro.tex"), null);
  assert.match(portablePathProblem("nul.tex") ?? "", /reserved/);
  assert.match(portablePathProblem("COM1") ?? "", /reserved/);
  assert.match(portablePathProblem("notes.") ?? "", /dot/);
});

test("TeX hints name the installer for each OS", () => {
  assert.match(texInstallHint("win32"), /MiKTeX/);
  assert.match(texInstallHint("darwin"), /MacTeX|mactex/i);
  assert.match(texInstallHint("linux"), /texlive/);
  assert.equal(windowsBuild("win32", "10.0.19045"), 19045);
  assert.equal(windowsBuild("linux", "6.12.0"), null);
});

test("run_terminal uses the local shell", async () => {
  const { executeTool } = await import("./agent/tools.js");
  const result = await executeTool("run_terminal", { command: "pwd" });
  assert.equal(result.ok, true, result.result);
  assert.match(result.result, /exit: 0/);
  assert.match(result.result, /workspace/);
});

test("resolveCommand finds pdflatex and ignores missing names", async () => {
  const pdflatex = await resolveCommand("pdflatex");
  if (pdflatex) assert.match(pdflatex, /pdflatex$/);
  assert.equal(await resolveCommand("definitely-missing-texagent-bin"), null);
  assert.equal(await resolveCommand("../pdflatex"), null);
});
