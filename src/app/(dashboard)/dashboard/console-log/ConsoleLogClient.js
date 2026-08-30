"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { startConsoleLogTransport } from "./transport";

// Severity reads from the [LEVEL] tag the line already carries, so colour is
// never the only signal. LOG and DEBUG stay neutral — they are not statuses.
const LOG_LEVEL_COLORS = {
  LOG: "text-text-main",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
  DEBUG: "text-text-muted",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-text-main";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);
  const transportRef = useRef(null);

  const handleClear = async () => {
    try {
      const response = await fetch("/api/translator/console-logs", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      transportRef.current?.invalidate();
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    transportRef.current = startConsoleLogTransport({
      onSnapshot: (nextLogs) => {
        setLogs(nextLogs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      },
      onEvent: (msg) => {
        if (msg.type === "init") {
          setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "line") {
          setLogs((prev) => {
            const next = [...prev, msg.line];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "lines") {
          setLogs((prev) => {
            const next = [...prev, ...msg.lines];
            return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
          });
        } else if (msg.type === "clear") {
          setLogs([]);
        }
      },
    });

    return () => {
      transportRef.current?.stop();
      transportRef.current = null;
    };
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div>
      <Card padding="none">
        <div className="flex items-center justify-end px-4 py-3 border-b border-border">
          <Button size="sm" variant="secondary" icon="delete" onClick={handleClear} className="focus-ring">
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          tabIndex={0}
          aria-label="Console output"
          className="focus-ring bg-surface-2 rounded-b-[var(--radius-brand-lg)] p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
