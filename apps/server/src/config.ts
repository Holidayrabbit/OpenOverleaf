import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root whether this file is running from src/ or dist/. */
export const repoRoot = path.resolve(here, "../../..");

const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

export interface AppConfig {
  port: number;
  host: string;
  workspace: string;
  openaiKey: string;
  openaiBase: string;
  openaiModel: string;
}

function readPort(): number {
  const raw = process.env.PORT;
  if (!raw) return 43124;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

/** Read on each call so tests and a restarted process see the current environment. */
export function getConfig(): AppConfig {
  const configured = process.env.WORKSPACE_DIR || "workspace/demo";
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    port: readPort(),
    host: process.env.HOST || "127.0.0.1",
    workspace: path.resolve(repoRoot, configured),
    openaiKey: process.env.OPENAI_API_KEY?.trim() || "",
    openaiBase: base,
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  };
}

export function workspaceDir(): string {
  return getConfig().workspace;
}
