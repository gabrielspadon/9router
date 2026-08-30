"use client";

import { useState, useEffect } from "react";
import { Card, Toggle } from "@/shared/components";

export default function MemoryClient() {
  const [memoryToolPruningEnabled, setMemoryToolPruningEnabled] = useState(true);
  const [memoryMaxToolTurnsKeepFull, setMemoryMaxToolTurnsKeepFull] = useState(2);
  const [memoryMaxHistoricalToolChars, setMemoryMaxHistoricalToolChars] = useState(800);
  const [memoryMediaPruningEnabled, setMemoryMediaPruningEnabled] = useState(true);
  const [memoryCompactionEnabled, setMemoryCompactionEnabled] = useState(false);
  const [memoryCompactionThresholdTokens, setMemoryCompactionThresholdTokens] = useState(32000);
  const [memoryRecentTurnsToKeep, setMemoryRecentTurnsToKeep] = useState(8);
  const [memoryHandoffEnabled, setMemoryHandoffEnabled] = useState(false);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating memory setting:", error);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setMemoryToolPruningEnabled(data.memoryToolPruningEnabled !== false);
          if (typeof data.memoryMaxToolTurnsKeepFull === "number") setMemoryMaxToolTurnsKeepFull(data.memoryMaxToolTurnsKeepFull);
          if (typeof data.memoryMaxHistoricalToolChars === "number") setMemoryMaxHistoricalToolChars(data.memoryMaxHistoricalToolChars);
          setMemoryMediaPruningEnabled(data.memoryMediaPruningEnabled !== false);
          setMemoryCompactionEnabled(!!data.memoryCompactionEnabled);
          if (typeof data.memoryCompactionThresholdTokens === "number") setMemoryCompactionThresholdTokens(data.memoryCompactionThresholdTokens);
          if (typeof data.memoryRecentTurnsToKeep === "number") setMemoryRecentTurnsToKeep(data.memoryRecentTurnsToKeep);
          setMemoryHandoffEnabled(!!data.memoryHandoffEnabled);
        }
      } catch (err) {
        console.error("Failed to load memory settings:", err);
      }
    };
    loadSettings();
  }, []);

  const handleMemoryToolPruning = (value) => {
    setMemoryToolPruningEnabled(value);
    patchSetting({ memoryToolPruningEnabled: value });
  };

  const handleMemoryMediaPruning = (value) => {
    setMemoryMediaPruningEnabled(value);
    patchSetting({ memoryMediaPruningEnabled: value });
  };

  const handleMemoryCompaction = (value) => {
    setMemoryCompactionEnabled(value);
    patchSetting({ memoryCompactionEnabled: value });
  };


  const handleMemoryHandoff = (value) => {
    setMemoryHandoffEnabled(value);
    patchSetting({ memoryHandoffEnabled: value });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[24px] text-text-muted" aria-hidden="true">
            psychology
          </span>
          <div>
            <h1 className="text-lg font-semibold text-text-main flex items-center gap-2">
              AI Memory & Context Management
            </h1>
            <p className="text-sm text-text-muted">
              Bounded observation lifecycle and token reduction pipeline inspired by{" "}
              <a
                href="https://github.com/akitaonrails/ai-memory"
                target="_blank"
                rel="noreferrer"
                className="focus-ring rounded-sm text-brand underline hover:no-underline"
              >
                ai-memory
              </a>
              . Keeps conversations coherent while slashing token costs by 40%–80%.
            </p>
          </div>
        </div>
      </div>

      {/* Phase 1: Tool Output Pruning */}
      <Card id="tool-pruning">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">build_circle</span>
            <h2 className="text-sm font-semibold text-text-main">Historical Tool Output Pruning</h2>
          </div>
          <Toggle checked={memoryToolPruningEnabled} onChange={handleMemoryToolPruning} />
        </div>
        <p className="text-sm text-text-muted mb-4">
          In multi-turn coding sessions (Claude Code, Cline, Roo, Codex), historical tool outputs (file reads, build logs, git diffs) dominate 70–85% of input tokens. This prunes older turns while keeping recent turns intact.
        </p>

        {memoryToolPruningEnabled && (
          <div className="bg-surface-2 p-4 rounded-[var(--radius-brand)] border border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Keep Recent Tool Turns Full
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={memoryMaxToolTurnsKeepFull}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value, 10) || 2);
                  setMemoryMaxToolTurnsKeepFull(val);
                  patchSetting({ memoryMaxToolTurnsKeepFull: val });
                }}
                className="focus-ring w-full rounded-[var(--radius-brand)] border border-border bg-surface px-3 py-1.5 font-mono text-sm text-text-main metric"
              />
              <span className="text-xs text-text-muted mt-1 block">
                The most recent <span className="metric">{memoryMaxToolTurnsKeepFull}</span> tool results will never be truncated.
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Max Historical Output Length (chars)
              </label>
              <input
                type="number"
                min="100"
                max="5000"
                step="100"
                value={memoryMaxHistoricalToolChars}
                onChange={(e) => {
                  const val = Math.max(100, parseInt(e.target.value, 10) || 800);
                  setMemoryMaxHistoricalToolChars(val);
                  patchSetting({ memoryMaxHistoricalToolChars: val });
                }}
                className="focus-ring w-full rounded-[var(--radius-brand)] border border-border bg-surface px-3 py-1.5 font-mono text-sm text-text-main metric"
              />
              <span className="text-xs text-text-muted mt-1 block">
                Older tool turns beyond recent window are bounded to <span className="metric">{memoryMaxHistoricalToolChars}</span> chars.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Phase 1: Media Pruning */}
      <Card id="media-pruning">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">image</span>
            <h2 className="text-sm font-semibold text-text-main">Historical Media & Attachment Pruning</h2>
          </div>
          <Toggle checked={memoryMediaPruningEnabled} onChange={handleMemoryMediaPruning} />
        </div>
        <p className="text-sm text-text-muted">
          Replaces heavy Base64 image and audio payloads in older answered turns with lightweight references (`[Historical media omitted by 9router]`), preserving full media exclusively in the current active user turn.
        </p>
      </Card>

      {/* Phase 2: Sliding Window Compaction */}
      <Card id="compaction">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">compress</span>
            <h2 className="text-sm font-semibold text-text-main">Sliding Window Context Compaction</h2>
          </div>
          <Toggle checked={memoryCompactionEnabled} onChange={handleMemoryCompaction} />
        </div>
        <p className="text-sm text-text-muted mb-4">
          When a conversation spans dozens of turns, older messages (turns 1 to N-K) are consolidated into a structured summary block, preventing context limit exhaustion.
        </p>

        {memoryCompactionEnabled && (
          <div className="bg-surface-2 p-4 rounded-[var(--radius-brand)] border border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Compaction Token Threshold
              </label>
              <input
                type="number"
                min="4000"
                max="128000"
                step="4000"
                value={memoryCompactionThresholdTokens}
                onChange={(e) => {
                  const val = Math.max(4000, parseInt(e.target.value, 10) || 32000);
                  setMemoryCompactionThresholdTokens(val);
                  patchSetting({ memoryCompactionThresholdTokens: val });
                }}
                className="focus-ring w-full rounded-[var(--radius-brand)] border border-border bg-surface px-3 py-1.5 font-mono text-sm text-text-main metric"
              />
              <span className="text-xs text-text-muted mt-1 block">
                Trigger compaction only when estimated history exceeds <span className="metric">{memoryCompactionThresholdTokens.toLocaleString()}</span> tokens.
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Recent Turns to Keep Intact
              </label>
              <input
                type="number"
                min="2"
                max="30"
                value={memoryRecentTurnsToKeep}
                onChange={(e) => {
                  const val = Math.max(2, parseInt(e.target.value, 10) || 8);
                  setMemoryRecentTurnsToKeep(val);
                  patchSetting({ memoryRecentTurnsToKeep: val });
                }}
                className="focus-ring w-full rounded-[var(--radius-brand)] border border-border bg-surface px-3 py-1.5 font-mono text-sm text-text-main metric"
              />
              <span className="text-xs text-text-muted mt-1 block">
                The latest <span className="metric">{memoryRecentTurnsToKeep}</span> conversation turns will remain uncompacted.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Phase 3: Prompt Cache Anchoring */}
      {/* Phase 4: Cross-Session Handoff Store */}
      <Card id="handoff">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">sync_alt</span>
            <h2 className="text-sm font-semibold text-text-main">Cross-Session Handoff Continuity</h2>
          </div>
          <Toggle checked={memoryHandoffEnabled} onChange={handleMemoryHandoff} />
        </div>
        <p className="text-sm text-text-muted">
          Maintains a bounded project handoff store across CLI agent switches (e.g. Claude Code → Codex → Cline) in the same directory, automatically injecting the previous session handoff summary into the new session.
        </p>
      </Card>
    </div>
  );
}
