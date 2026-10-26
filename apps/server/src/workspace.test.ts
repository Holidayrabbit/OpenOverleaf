import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listTree,
  readProjectFile,
  resolveInWorkspace,
  WorkspaceError,
  writeProjectFile,
} from "./workspace.js";

test("resolveInWorkspace rejects paths that leave the project", () => {
  const root = "/tmp/texagent-root";
  assert.throws(() => resolveInWorkspace(root, "../etc/passwd"), WorkspaceError);
  assert.throws(() => resolveInWorkspace(root, "/etc/passwd"), WorkspaceError);
  assert.throws(() => resolveInWorkspace(root, "sections/../../etc/passwd"), WorkspaceError);
  assert.throws(() => resolveInWorkspace(root, ""), WorkspaceError);
  assert.equal(resolveInWorkspace(root, "sections/intro.tex").relative, "sections/intro.tex");
  assert.equal(resolveInWorkspace(root, "sections\\intro.tex").relative, "sections/intro.tex");
  assert.equal(resolveInWorkspace(root, ".", { allowRoot: true }).relative, "");
  assert.throws(() => resolveInWorkspace(root, "C:/Windows/system32"), WorkspaceError);
  assert.throws(() => resolveInWorkspace(root, "sections/nul.tex"), WorkspaceError);
  assert.throws(() => resolveInWorkspace(root, "sections/notes."), WorkspaceError);
});

test("write, read, and list stay inside the workspace", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "texagent-"));
  try {
    const written = await writeProjectFile(dir, "sections/a.tex", "hello");
    assert.equal(written.path, "sections/a.tex");
    const file = await readProjectFile(dir, "sections/a.tex");
    assert.equal(file.content, "hello");
    assert.equal(file.binary, false);

    await assert.rejects(() => writeProjectFile(dir, "build/out.tex", "nope"), WorkspaceError);

    const tree = await listTree(dir);
    assert.deepEqual(
      tree.map((node) => node.name),
      ["sections"],
    );
    assert.equal(tree[0]?.children?.[0]?.name, "a.tex");

    await assert.rejects(() => readProjectFile(dir, "missing.tex"), (error: unknown) => {
      assert.ok(error instanceof WorkspaceError);
      assert.equal(error.status, 404);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
