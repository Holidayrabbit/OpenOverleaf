# OpenOverleaf

Local-first LaTeX studio. Edit a project on disk, preview the PDF, talk to an agent that can change the files, and use a real terminal in the project directory.

Source: [github.com/Holidayrabbit/OpenOverleaf](https://github.com/Holidayrabbit/OpenOverleaf)

OpenOverleaf is an independent open-source project. The layout is inspired by browser LaTeX studios. It does not connect to Overleaf.com, it does not include Overleaf Community Edition or Overleaf Server Pro source, and it is not affiliated with Overleaf. See [Inspiration](#inspiration).

## Features

- Three resizable panes: project editor, agent chat, and an integrated terminal
- CodeMirror editor with autosave for the files in `workspace/demo` (or `WORKSPACE_DIR`)
- PDF preview when `latexmk` or `pdflatex` is on `PATH`
- Agent loop with local tools: `list_files`, `read_file`, `write_file`, `run_terminal`, `compile_latex`
- OpenAI-compatible HTTP API (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL` / `OPENAI_MODEL`)
- xterm.js attached to a `node-pty` shell whose cwd is the project

Collaboration, accounts, and hosted sync are intentionally out of scope.

## Requirements

- Node.js 20 or newer
- pnpm 10. From the repo: `corepack enable`, then `corepack prepare pnpm@10.33.4 --activate`. If Corepack is disabled, `npm install -g pnpm@10.33.4` works on Windows, macOS, and Linux.
- Optional: a TeX install with `pdflatex` or `latexmk` on `PATH`
- A compiler for `node-pty` only when the prebuild does not match this machine. See [Platforms](#platforms).

The sample document uses only the LaTeX kernel, so a base TeX install is enough to compile it. A fuller scheme helps when the agent adds packages such as `geometry` or `amsmath`.

## Platforms

`pnpm install`, `pnpm dev`, `pnpm build`, and `pnpm start` are the same on Windows, macOS, and Linux. The scripts do not call bash. Open the studio at [http://127.0.0.1:43123](http://127.0.0.1:43123) (use that address; `localhost` can resolve to IPv6 while the dev servers bind IPv4).

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Shell for the terminal | PowerShell (`powershell.exe`, else `pwsh.exe`, else `cmd.exe /d`) | `$SHELL`, then bash, zsh, or sh | `$SHELL`, then bash, zsh, or sh |
| Agent `run_terminal` | PowerShell `-NoProfile` (UTF-16 encoded), else `pwsh`, else `cmd.exe /d /s /c` | `bash --noprofile --norc -c`, else `sh -c` | same as macOS |
| TeX | [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive/) | `brew install --cask mactex-no-gui`, or BasicTeX. Put `/Library/TeX/texbin` on `PATH` | `sudo apt install texlive-latex-base latexmk`, or TeX Live |
| `node-pty` | Prebuild for x64 and arm64. Windows 10 version 1903 (build 18309) or newer for ConPTY; older builds use the bundled winpty fallback | Prebuild for x64 and arm64 | No prebuild. Install `python3`, `make`, and `g++` before `pnpm install` |

If a prebuild does not match your Node ABI, `pnpm install` compiles `node-pty`:

- Windows: Visual Studio Build Tools, workload "Desktop development with C++", plus Python 3
- macOS: `xcode-select --install`
- Linux (Debian/Ubuntu): `sudo apt install python3 make g++`

A failed terminal does not stop the rest of the app. The server still serves the editor, preview, and agent, and the terminal pane shows the reason instead of reconnecting forever. On Windows, a timed-out compile is stopped with `taskkill /T`, so `latexmk` and the `pdflatex` process it spawned both exit. `.cmd` and `.bat` shims (some TeX installs) are launched through `cmd.exe`.

Windows PowerShell 5.1 does not support `&&`. The agent is told that. PowerShell 7 (`pwsh`) does. Set `OPENOVERLEAF_SHELL` to force one shell for both the terminal and `run_terminal`, for example Git Bash:

```text
OPENOVERLEAF_SHELL=C:/Program Files/Git/bin/bash.exe
```

In `.env`, write Windows paths with forward slashes. Quoted backslashes are easy to get wrong.

Restart the shell that starts OpenOverleaf after installing TeX so `PATH` includes `pdflatex`. A MiKTeX user install sometimes needs a new terminal window. The server log line `tex` says `ready` or `not installed`. File names Windows cannot store (`nul.tex`, trailing dots, `:` in a name) are rejected on every OS so a project can move between machines.

The first time Node listens, Windows Defender Firewall may ask for permission. Binding `HOST=127.0.0.1` (the default) is enough for local use.

## Quick start

macOS, Linux, and Windows PowerShell:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Windows Command Prompt uses `copy .env.example .env` instead of `cp`. PowerShell’s `cp` is fine.

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`pnpm dev` starts both apps:

| Process | URL | Role |
| --- | --- | --- |
| `@openoverleaf/web` | http://127.0.0.1:43123 | Vite UI. Proxies `/api` and `/ws` to the server. |
| `@openoverleaf/server` | http://127.0.0.1:43124 | Files, compile, agent, and the PTY websocket. |

Leave `OPENAI_API_KEY` empty if you only want the editor, preview, and terminal. The agent replies with setup instructions instead of crashing.

Production, after a build:

```bash
pnpm build
pnpm start
```

`pnpm start` serves the built UI and the API from port `43124`.

## Environment

Copy `.env.example` to `.env` in the repo root. The server reads it on startup. Do not commit `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Bearer token for the chat completions API. Any non-empty string is enough for servers that ignore the key. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL. Ollama example: `http://127.0.0.1:11434/v1`. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model id. It needs to support tool calling. |
| `WORKSPACE_DIR` | `workspace/demo` | Project directory, relative to the repo root or absolute. Prefer forward slashes, including on Windows (`C:/Users/me/paper`). |
| `OPENOVERLEAF_SHELL` | OS default | Optional shell for the terminal and `run_terminal`. `TEXAGENT_SHELL` is still accepted when this is unset. See [Platforms](#platforms). |
| `PORT` | `43124` | Server port. |
| `HOST` | `127.0.0.1` | Bind address. There is no authentication. |

The interactive terminal inherits the server environment except `OPENAI_API_KEY`, which is removed. Shell commands the agent runs are also started without that key.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Web and server in watch mode. |
| `pnpm build` | Typecheck and build both packages. |
| `pnpm start` | Run the built server (API + static UI). |
| `pnpm test` | Path-safety tests, the no-key agent reply, and a sample compile when TeX is installed. |
| `pnpm typecheck` | `tsc` for the web and server packages. |

## Using the studio

The sample project is `workspace/demo`:

- `main.tex` is the compile entry
- `sections/intro.tex` and `sections/method.tex` are included from it
- Output goes to `workspace/demo/build/main.pdf`

Edits autosave after a short pause. Ctrl+S or Cmd+S saves immediately. Ctrl+Enter or Cmd+Enter compiles, unless focus is in the agent composer (Enter sends the message there).

The file tree can add a file (`sections/notes.tex`) and delete a file. The build directory is hidden and reserved for the compiler.

If TeX is missing, Compile explains how to install it. Editing, chat, and the terminal keep working.

## Agent tools

Each turn is a tool loop, at most 8 rounds. The chat shows the tool name and a short result as the model works.

| Tool | Behavior |
| --- | --- |
| `list_files` | Recursive listing from the project root or a subdirectory. |
| `read_file` | UTF-8 text, truncated for the model. |
| `write_file` | Creates or overwrites a file, including parent directories. |
| `run_terminal` | Non-interactive shell in the project directory (PowerShell on Windows, bash or sh elsewhere, or `OPENOVERLEAF_SHELL`). Killed after 15 seconds. Output is truncated. |
| `compile_latex` | Same compile path as the Compile button (`main.tex`). |

The model endpoint must accept `POST {OPENAI_BASE_URL}/chat/completions` with the OpenAI tools schema. Streaming responses are preferred; a single JSON body is also accepted.

The agent can run shell commands on this machine. Point it at a model you trust, and do not expose the server port on an untrusted network.

## Architecture

```
apps/web     Vite + React + CodeMirror + pdf.js + xterm.js
   |  HTTP /api                         WebSocket /ws/terminal
apps/server  Express + tool loop + node-pty
   |
workspace/demo
```

Paths are checked before any file is read or written so a request cannot leave the workspace directory. The server does not serve the workspace as static files. PDF bytes are exposed only through `GET /api/pdf`.

## Development

```
apps/web        React UI
apps/server     HTTP API, agent, PTY
workspace/demo  Sample project
```

Server code is TypeScript compiled with `tsc` (`module: Node16`). In development, `tsx watch` runs `apps/server/src` directly. Web dev server port is `43123`; change it in `apps/web/vite.config.ts` and the proxy target if you move the API.

## Roadmap

- Real-time collaboration (OT or CRDT) and shared cursors
- Multi-user sessions once there is an explicit identity model
- Git status, diff, and commit from the studio
- A stronger agent: project memory, diagnostics, and reviewable multi-file edits
- SyncTeX forward and inverse search

## Inspiration

OpenOverleaf borrows the shape of a browser LaTeX studio: a file tree, source beside a PDF preview, and a recompile action, one project at a time. That shape is inspiration only. This repository is not a fork, does not copy Overleaf’s code, CSS, logos, or other assets, and is not affiliated with Overleaf. If you need Overleaf’s collaboration server, use Overleaf Community Edition, which is licensed under the AGPL. OpenOverleaf is MIT.

## License

[MIT](LICENSE)

## 简体中文

OpenOverleaf 是一个本地优先的 LaTeX 工作室：在浏览器里编辑项目文件、预览 PDF、使用集成终端，并让 agent 通过本地工具改稿和编译。仓库地址：https://github.com/Holidayrabbit/OpenOverleaf

安装与启动见上面的 Quick start 和 Platforms。Windows、macOS、Linux 都用同一套 `pnpm install` 和 `pnpm dev`。未设置 `OPENAI_API_KEY` 时，编辑器、预览和终端仍然可用，agent 会提示如何配置密钥。终端原生模块加载失败时，其余功能继续运行，终端面板会显示原因。本项目使用 MIT 许可证，是独立的开源实现，界面形态参考在线 LaTeX 编辑器，不隶属于 Overleaf，也不包含 Overleaf 的代码或标识。
