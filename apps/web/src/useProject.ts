import { useCallback, useEffect, useRef, useState } from "react";
import {
  compileDocument,
  deleteFile,
  getStatus,
  getTree,
  readFile,
  writeFile as putFile,
} from "./api.ts";
import { findFile, firstFile } from "./tree.ts";
import { samePath } from "./transcript.ts";
import type { CompileView, FileNode, OpenFile, SaveState, Status } from "./types.ts";

export function useProject() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [binaryPath, setBinaryPath] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [compileState, setCompileState] = useState<CompileView>({ status: "idle" });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [autoFocus, setAutoFocus] = useState(false);

  const latest = useRef({ path: "", content: "" });
  const lastSaved = useRef("");
  const timer = useRef<number | null>(null);
  const saveGen = useRef(0);
  const pauseSave = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const applyLoaded = useCallback((file: { path: string; content: string; binary: boolean }, focus: boolean) => {
    saveGen.current += 1;
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setFileError(null);
    if (file.binary) {
      setOpen(null);
      setBinaryPath(file.path);
      latest.current = { path: "", content: "" };
      lastSaved.current = "";
      setSaveState("saved");
      return;
    }
    setBinaryPath(null);
    lastSaved.current = file.content;
    latest.current = { path: file.path, content: file.content };
    setAutoFocus(focus);
    setOpen({ path: file.path, content: file.content, revision: Date.now() });
    setSaveState("saved");
  }, []);

  const flushSave = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = latest.current;
    if (!snapshot.path || snapshot.content === lastSaved.current) {
      if (snapshot.path) setSaveState("saved");
      return;
    }
    const gen = ++saveGen.current;
    setSaveState("saving");
    try {
      await putFile(snapshot.path, snapshot.content);
      if (gen !== saveGen.current) return;
      if (latest.current.path === snapshot.path && latest.current.content === snapshot.content) {
        lastSaved.current = snapshot.content;
        setSaveState("saved");
        setFileError(null);
      } else if (!pauseSave.current) {
        setSaveState("dirty");
        timer.current = window.setTimeout(() => {
          void flushRef.current();
        }, 250);
      }
    } catch (error) {
      if (gen !== saveGen.current) return;
      setSaveState("error");
      setFileError(error instanceof Error ? error.message : "Save failed");
    }
  }, []);
  flushRef.current = flushSave;

  const scheduleSave = useCallback(() => {
    if (pauseSave.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flushRef.current();
    }, 700);
  }, []);

  const handleChange = useCallback(
    (content: string) => {
      if (!latest.current.path) return;
      latest.current = { path: latest.current.path, content };
      setSaveState("dirty");
      scheduleSave();
    },
    [scheduleSave],
  );

  const refreshStatus = useCallback(async () => {
    const next = await getStatus();
    setStatus(next);
    return next;
  }, []);

  const refreshTree = useCallback(async () => {
    const files = await getTree();
    setTree(files);
    return files;
  }, []);

  const openPath = useCallback(
    async (filePath: string) => {
      await flushRef.current();
      setFileLoading(true);
      setFileError(null);
      try {
        applyLoaded(await readFile(filePath), true);
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "Could not open the file");
      } finally {
        setFileLoading(false);
      }
    },
    [applyLoaded],
  );

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const [nextStatus, files] = await Promise.all([getStatus(), getTree()]);
      setStatus(nextStatus);
      setTree(files);
      if (nextStatus.pdf) setPdfUrl((current) => current ?? "/api/pdf");
      const preferred = findFile(files, "main.tex") ?? firstFile(files);
      if (preferred) applyLoaded(await readFile(preferred), true);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "Could not load the project");
    } finally {
      setBooting(false);
    }
  }, [applyLoaded]);

  useEffect(() => {
    const onLeave = () => {
      const snapshot = latest.current;
      if (!snapshot.path || snapshot.content === lastSaved.current) return;
      void fetch("/api/file", {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    document.title = open ? `${open.path} — OpenOverleaf` : "OpenOverleaf";
  }, [open]);

  const compile = useCallback(async () => {
    await flushRef.current();
    setCompileState({ status: "running" });
    try {
      const result = await compileDocument();
      setCompileState(
        result.ok
          ? { status: "ok", log: result.log }
          : { status: "error", log: result.log, hint: result.hint, reason: result.reason },
      );
      if (result.ok) setPdfUrl(`/api/pdf?t=${Date.now()}`);
      await refreshStatus();
    } catch (error) {
      setCompileState({
        status: "error",
        log: "",
        hint: error instanceof Error ? error.message : "Compile failed",
        reason: "compile-error",
      });
    }
  }, [refreshStatus]);

  const createFile = useCallback(
    async (filePath: string) => {
      await flushRef.current();
      const starter = filePath.endsWith(".tex") ? `% ${filePath}\n` : "";
      await putFile(filePath, starter);
      await refreshTree();
      applyLoaded(await readFile(filePath), true);
    },
    [applyLoaded, refreshTree],
  );

  const removeFile = useCallback(
    async (filePath: string) => {
      await flushRef.current();
      await deleteFile(filePath);
      const files = await refreshTree();
      if (!samePath(latest.current.path, filePath)) return;
      const next = findFile(files, "main.tex") ?? firstFile(files);
      if (next && !samePath(next, filePath)) {
        applyLoaded(await readFile(next), true);
        return;
      }
      latest.current = { path: "", content: "" };
      lastSaved.current = "";
      setOpen(null);
      setBinaryPath(null);
    },
    [applyLoaded, refreshTree],
  );

  const beginAgent = useCallback(async () => {
    await flushRef.current();
    pauseSave.current = true;
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const endAgent = useCallback(async () => {
    pauseSave.current = false;
    try {
      await refreshTree();
    } catch {
      // The next explicit action will surface a server error.
    }
    if (latest.current.path && latest.current.content !== lastSaved.current) scheduleSave();
  }, [refreshTree, scheduleSave]);

  const applyAgentEffect = useCallback(
    async (name: string, args: Record<string, unknown>, result: string) => {
      if (name === "write_file" && typeof args.path === "string" && samePath(latest.current.path, args.path)) {
        try {
          applyLoaded(await readFile(args.path), false);
        } catch (error) {
          setFileError(error instanceof Error ? error.message : "Could not reload the file");
        }
      }
      if (name === "compile_latex") {
        const ok = result.startsWith("ok: true");
        const hintLine = result.split("\n").find((line) => line.startsWith("hint: "));
        const log = result.split("\n---\n")[1] ?? "";
        setCompileState(
          ok
            ? { status: "ok", log }
            : { status: "error", log, hint: hintLine?.slice(6), reason: "compile-error" },
        );
        if (ok) setPdfUrl(`/api/pdf?t=${Date.now()}`);
        try {
          await refreshStatus();
        } catch {
          // The compile card already shows the tool result.
        }
      }
    },
    [applyLoaded, refreshStatus],
  );

  const editorSeed = open && latest.current.path === open.path ? latest.current.content : (open?.content ?? "");

  return {
    tree,
    status,
    open,
    editorSeed,
    binaryPath,
    saveState,
    compileState,
    pdfUrl,
    booting,
    bootError,
    fileLoading,
    fileError,
    autoFocus,
    boot,
    openPath,
    handleChange,
    flushSave,
    compile,
    createFile,
    removeFile,
    beginAgent,
    endAgent,
    applyAgentEffect,
  };
}
