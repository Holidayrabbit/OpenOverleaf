import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { portablePathProblem } from "./platform.js";

export class WorkspaceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkspaceError";
    this.status = status;
  }
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface ResolvedPath {
  absolute: string;
  relative: string;
}

const SKIP_DIRS = new Set(["build", ".git", "node_modules"]);
const MAX_FILE_BYTES = 500_000;

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === code);
}

export function resolveInWorkspace(
  root: string,
  input: string,
  options: { allowRoot?: boolean } = {},
): ResolvedPath {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\n") || input.includes("\r")) {
    throw new WorkspaceError("Invalid path");
  }

  const trimmed = input.replaceAll("\\", "/").trim();
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    throw new WorkspaceError("Path escapes the workspace");
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.some((segment) => segment === "..")) {
    throw new WorkspaceError("Path escapes the workspace");
  }
  for (const segment of segments) {
    const problem = portablePathProblem(segment);
    if (problem) throw new WorkspaceError(problem);
  }

  const rootResolved = path.resolve(root);
  if (segments.length === 0) {
    if (!options.allowRoot) throw new WorkspaceError("Path is required");
    return { absolute: rootResolved, relative: "" };
  }

  const absolute = path.resolve(rootResolved, ...segments);
  const relativeToRoot = path.relative(rootResolved, absolute);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new WorkspaceError("Path escapes the workspace");
  }

  return { absolute, relative: relativeToRoot.split(path.sep).join("/") };
}

function assertProjectPath(resolved: ResolvedPath): void {
  if (resolved.relative === "build" || resolved.relative.startsWith("build/")) {
    throw new WorkspaceError("The build directory is reserved for the compiler");
  }
}

export async function listTree(root: string, input = "."): Promise<FileNode[]> {
  const resolved = resolveInWorkspace(root, input, { allowRoot: true });
  assertProjectPath(resolved);
  let info;
  try {
    info = await stat(resolved.absolute);
  } catch (error) {
    if (isCode(error, "ENOENT")) throw new WorkspaceError("Path not found", 404);
    throw error;
  }
  if (info.isFile()) {
    return [{ name: path.basename(resolved.absolute), path: resolved.relative, type: "file" }];
  }
  if (!info.isDirectory()) throw new WorkspaceError("Not a directory");
  return readDirectory(path.resolve(root), resolved.relative);
}

async function readDirectory(root: string, relative: string): Promise<FileNode[]> {
  const absolute = relative ? path.join(root, relative) : root;
  const entries = await readdir(absolute, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    if (!relative && entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await readDirectory(root, childRelative);
      nodes.push({ name: entry.name, path: childRelative, type: "dir", children });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: childRelative, type: "file" });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function flattenTree(nodes: FileNode[]): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === "dir") {
      lines.push(`${node.path}/`);
      if (node.children) lines.push(...flattenTree(node.children));
    } else {
      lines.push(node.path);
    }
  }
  return lines;
}

export async function readProjectFile(
  root: string,
  input: string,
): Promise<{ path: string; content: string; binary: boolean }> {
  const resolved = resolveInWorkspace(root, input);
  assertProjectPath(resolved);
  let info;
  try {
    info = await stat(resolved.absolute);
  } catch (error) {
    if (isCode(error, "ENOENT")) throw new WorkspaceError("File not found", 404);
    throw error;
  }
  if (!info.isFile()) throw new WorkspaceError("Not a file");
  if (info.size > MAX_FILE_BYTES) throw new WorkspaceError("File is too large to open", 413);

  const buffer = await readFile(resolved.absolute);
  if (buffer.subarray(0, 8000).includes(0)) {
    return { path: resolved.relative, content: "", binary: true };
  }
  return { path: resolved.relative, content: buffer.toString("utf8"), binary: false };
}

export async function writeProjectFile(
  root: string,
  input: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  if (typeof content !== "string") throw new WorkspaceError("Content must be a string");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) throw new WorkspaceError("File is too large", 413);

  const resolved = resolveInWorkspace(root, input);
  assertProjectPath(resolved);
  await mkdir(path.dirname(resolved.absolute), { recursive: true });

  let existing: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    existing = await stat(resolved.absolute);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
  if (existing?.isDirectory()) throw new WorkspaceError("Cannot overwrite a directory");

  await writeFile(resolved.absolute, content, "utf8");
  return { path: resolved.relative, bytes };
}

export async function removeProjectFile(root: string, input: string): Promise<void> {
  const resolved = resolveInWorkspace(root, input);
  assertProjectPath(resolved);
  if (!resolved.relative) throw new WorkspaceError("Cannot delete the workspace root");

  let info;
  try {
    info = await stat(resolved.absolute);
  } catch (error) {
    if (isCode(error, "ENOENT")) throw new WorkspaceError("File not found", 404);
    throw error;
  }
  if (!info.isFile()) throw new WorkspaceError("Only files can be deleted from the editor");
  await rm(resolved.absolute);
}
