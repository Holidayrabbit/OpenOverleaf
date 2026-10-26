import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { commandAvailable } from "./compile.js";
import { getConfig, repoRoot, workspaceDir } from "./config.js";
import { apiErrorHandler, registerApi } from "./routes.js";
import { attachTerminal } from "./terminal.js";

const DEV_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenOverleaf server</title>
<body style="margin:0;background:#101114;color:#ece8e1;font-family:Georgia,serif">
  <main style="max-width:36rem;margin:12vh auto;padding:0 1.5rem">
    <p style="letter-spacing:.14em;text-transform:uppercase;font-family:sans-serif;font-size:.75rem;color:#2f6b45">OpenOverleaf</p>
    <h1 style="font-weight:500">API is running.</h1>
    <p>In development, open the studio at <a style="color:#e0a15a" href="http://127.0.0.1:43123">http://127.0.0.1:43123</a>.</p>
  </main>
</body>
</html>`;

async function main(): Promise<void> {
  const config = getConfig();
  const root = workspaceDir();
  await mkdir(root, { recursive: true });

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
    next();
  });

  registerApi(app);
  app.use(apiErrorHandler);

  const dist = path.join(repoRoot, "apps/web/dist");
  const hasDist = existsSync(path.join(dist, "index.html"));
  if (hasDist) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
      res.sendFile(path.join(dist, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("html").send(DEV_PAGE);
    });
  }

  const server = createServer(app);
  const terminal = attachTerminal(server);
  const terminalLine = terminal.ready;
  const [pdflatex, latexmk] = await Promise.all([
    commandAvailable("pdflatex"),
    commandAvailable("latexmk"),
  ]);

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use.`);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    void (async () => {
      const shownHost = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
      const terminalStatus = await terminalLine;
      console.log("");
      console.log("OpenOverleaf");
      console.log(`  api        http://${shownHost}:${config.port}`);
      console.log(hasDist ? `  web        http://${shownHost}:${config.port}` : "  web (dev)  http://127.0.0.1:43123");
      console.log(`  workspace  ${root}`);
      console.log(`  agent      ${config.openaiKey ? config.openaiModel : "off (set OPENAI_API_KEY)"}`);
      console.log(`  tex        ${pdflatex || latexmk ? "ready" : "not installed"}`);
      console.log(`  terminal   ${terminalStatus}`);
      console.log("");
    })();
  });

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  if (process.platform === "win32") signals.push("SIGBREAK");
  for (const signal of signals) {
    process.on(signal, () => {
      terminal.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
