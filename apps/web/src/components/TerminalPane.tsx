import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({
  cwdLabel,
  collapsed,
  onToggle,
}: {
  cwdLabel: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const [connected, setConnected] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 2000,
      theme: {
        background: "#101114",
        foreground: "#e6e2d8",
        cursor: "#e0a15a",
        cursorAccent: "#101114",
        selectionBackground: "#3a3328",
        black: "#1a1c21",
        red: "#e38b7b",
        green: "#8fce9a",
        yellow: "#e0a15a",
        blue: "#8eb4d4",
        magenta: "#d3a4c9",
        cyan: "#8fd0c6",
        white: "#e6e2d8",
        brightBlack: "#6b707a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(body);

    let stopped = false;
    let fatal = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let announced = false;

    const send = (payload: unknown) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const fitAndResize = () => {
      if (!body.isConnected || body.clientWidth < 40 || body.clientHeight < 30) return;
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    fitRef.current = fitAndResize;

    term.onData((data) => send({ type: "input", data }));

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
      socket.onopen = () => {
        announced = false;
        setFault(null);
        setConnected(true);
        fitAndResize();
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as { type?: string; data?: string; available?: boolean; message?: string };
          if (message.type === "status" && message.available === false) {
            fatal = true;
            setConnected(false);
            if (message.message) setFault(message.message);
            return;
          }
          if (message.type === "output" && typeof message.data === "string") term.write(message.data);
        } catch {
          term.write(event.data);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (stopped || fatal) return;
        if (!announced) {
          term.write("\r\n\x1b[33m[disconnected — reconnecting]\x1b[0m\r\n");
          announced = true;
        }
        retry = window.setTimeout(connect, 1000);
      };
    };

    connect();
    const observer = new ResizeObserver(() => fitAndResize());
    observer.observe(body);
    void document.fonts.ready.then(() => fitAndResize());

    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
      observer.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!collapsed) fitRef.current();
  }, [collapsed]);

  return (
    <section className="pane terminal-pane" data-testid="terminal">
      <div className="pane-header">
        <span className={connected ? "dot on" : "dot off"} aria-label={connected ? "Terminal connected" : "Terminal disconnected"} />
        <strong>Terminal</strong>
        <span className="muted">{cwdLabel}</span>
        <button type="button" className="ghost slim" onClick={onToggle}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>
      {fault && !collapsed && <p className="terminal-note">{fault}</p>}
      <div className="terminal-body" ref={bodyRef} hidden={collapsed} />
    </section>
  );
}
