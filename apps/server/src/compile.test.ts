import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commandAvailable, compileProject } from "./compile.js";
import { repoRoot } from "./config.js";

test("compiles the sample project", { timeout: 120_000 }, async (t) => {
  const available = (await commandAvailable("pdflatex")) || (await commandAvailable("latexmk"));
  if (!available) {
    t.skip("pdflatex and latexmk are not installed");
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "texagent-compile-"));
  try {
    await cp(path.join(repoRoot, "workspace", "demo"), dir, { recursive: true });
    const result = await compileProject(dir);
    assert.equal(result.ok, true, result.log || result.hint);
    assert.equal(result.pdf, "build/main.pdf");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
