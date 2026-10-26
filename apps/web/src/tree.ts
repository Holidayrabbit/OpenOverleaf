import type { FileNode } from "./types.ts";

export function findFile(nodes: FileNode[], target: string): string | null {
  for (const node of nodes) {
    if (node.type === "file" && node.path === target) return node.path;
    if (node.children) {
      const found = findFile(node.children, target);
      if (found) return found;
    }
  }
  return null;
}

export function firstFile(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.children) {
      const found = firstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}
