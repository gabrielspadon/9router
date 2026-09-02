"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import Toggle from "@/shared/components/Toggle";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Tooltip from "../endpoint/components/Tooltip";
import {
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";

const TOKEN_SAVER_STATS_REFRESH_MS = 30_000;
const TOKEN_SAVER_STATS_TIMEOUT_MS = 10_000;

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  // "" = not configured; HEADROOM_TIMEOUT_MS and the built-in default then apply.
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState("");
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
    // /api/headroom/* is local-only, so a dashboard opened on a LAN address gets
    // 401 here. That is not "no extras installed", and reporting it as such sent
    // people looking for an install problem that did not exist (#2965).
    restricted: false,
  });
  const [pendingExtras, setPendingExtras] = useState([]);
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [removingExtra, setRemovingExtra] = useState(null);
  const [installLog, setInstallLog] = useState("");
  const [extrasConfirm, setExtrasConfirm] = useState(null);
  const [codeAware, setCodeAware] = useState(false);
  const [kompress, setKompress] = useState(true);
  const [restartingProxy, setRestartingProxy] = useState(false);
  const logPollRef = useRef(null);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [toolDisclosureEnabled, setToolDisclosureEnabled] = useState(false);
  const [toolDisclosureFilterEnabled, setToolDisclosureFilterEnabled] = useState(false);
  const [toolDisclosureMaxTools, setToolDisclosureMaxTools] = useState(20);
  const [disclosureStats, setDisclosureStats] = useState([]);
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [showPxpipeModal, setShowPxpipeModal] = useState(false);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");

  const { copied, copy } = useCopyToClipboard();

  // Every caveman level is shown to every locale now that the classical Chinese
  // levels are gone, so there is nothing left to gate on the interface language.
  const visibleCavemanLevels = CAVEMAN_LEVELS;

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
      if (!data?.installed) {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
        return;
      }
      try {
        const er = await fetch("/api/headroom/extras", {
          headers: { "Cache-Control": "no-store" },
        });
        if (er.status === 401 || er.status === 403) {
          // Not a failure to report as absence: the route is local-only and this
          // dashboard is not on loopback. Say so instead of claiming nothing is
          // installed, which is what the state below would otherwise mean.
          setHeadroomExtras({
            version: null,
            extras: { code: false, ml: false },
            available: ["code", "ml"],
            loading: false,
            restricted: true,
          });
          setPendingExtras([]);
          return;
        }
        if (!er.ok) throw new Error("extras status failed");
        const ed = await er.json();
        setHeadroomExtras((s) => ({
          ...s,
          version: ed.version ?? null,
          extras: ed.extras || { code: false, ml: false },
          available: ed.available || ["code", "ml"],
          loading: false,
          restricted: false,
        }));
        setPendingExtras([]);
      } catch {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
          restricted: false,
        });
        setPendingExtras([]);
      }
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const togglePendingExtra = (extra) => {
    setPendingExtras((cur) =>
      cur.includes(extra) ? cur.filter((e) => e !== extra) : [...cur, extra]
    );
  };

  // Poll the install log tail while a pip install/uninstall is running.
  const startLogPolling = useCallback(() => {
    setInstallLog("");
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch("/api/headroom/extras?log=1", {
          headers: { "Cache-Control": "no-store" },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === "string") setInstallLog(d.log);
      } catch { /* ignore transient poll errors */ }
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  const installExtrasConfirmed = useCallback(async () => {
    if (pendingExtras.length === 0) return;
    setExtrasActionLoading(true);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: pendingExtras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Install failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
      setPendingExtras([]);
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setExtrasActionLoading(false);
    }
  }, [pendingExtras, startLogPolling, stopLogPolling]);

  const removeExtraConfirmed = useCallback(async (extra) => {
    setRemovingExtra(extra);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: [extra] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setRemovingExtra(null);
    }
  }, [startLogPolling, stopLogPolling]);

  const handleInstallExtras = useCallback(() => {
    if (pendingExtras.length === 0) return;
    // Warn about the heavy ~1GB torch download before installing [ml].
    if (pendingExtras.includes("ml")) {
      setExtrasConfirm({
        title: "Install [ml]",
        message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
        confirmText: "Install",
        variant: "primary",
        onConfirm: installExtrasConfirmed,
      });
      return;
    }
    installExtrasConfirmed();
  }, [pendingExtras, installExtrasConfirmed]);

  const handleRemoveExtra = useCallback((extra) => {
    setExtrasConfirm({
      title: `Remove [${extra}]`,
      message: `Remove [${extra}] and its packages?`,
      confirmText: "Remove",
      variant: "danger",
      onConfirm: () => removeExtraConfirmed(extra),
    });
  }, [removeExtraConfirmed]);

  // Toggle an extra's active state (persist setting), then restart the proxy so
  // the new --code-aware / --disable-kompress flags take effect.
  const toggleExtraActive = useCallback(async (extra, value) => {
    setExtrasActionError("");
    if (extra === "code") setCodeAware(value);
    if (extra === "ml") setKompress(value);
    const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
    await patchSetting({ [key]: value });
    if (!headroomStatus.running) return;
    setRestartingProxy(true);
    try {
      const res = await fetch("/api/headroom/restart", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restart failed");
      await refreshHeadroomStatus();
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      setRestartingProxy(false);
    }
  }, [headroomStatus.running, refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/pxpipe/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setPxpipeStatus({ ...data, loading: false });
      if (typeof data.minChars === "number") setPxpipeMinChars(data.minChars);
    } catch {
      setPxpipeStatus({ installed: false, installing: false, running: false, version: null, loading: false });
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e) {
      setPxpipeHealth({ healthy: false, checks: [], error: e.message });
    }
  }, []);

  const pxpipeAction = useCallback(
    async (endpoint) => {
      setPxpipeActionError("");
      setPxpipeActionLoading(true);
      try {
        const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
        await refreshPxpipeStatus();
        await runPxpipeHealth();
      } catch (e) {
        setPxpipeActionError(e.message);
      } finally {
        setPxpipeActionLoading(false);
      }
    },
    [refreshPxpipeStatus, runPxpipeHealth]
  );

  const handlePxpipeEnabled = (value) => {
    setPxpipeEnabled(value);
    patchSetting({ pxpipeEnabled: value });
  };

  const handleHeadroomTimeoutBlur = () => {
    const raw = String(headroomTimeoutMs).trim();
    const parsed = Math.round(Number(raw));
    const next =
      raw && Number.isFinite(parsed) && parsed > 0 && parsed < 600000
        ? parsed
        : null;
    setHeadroomTimeoutMs(next ?? "");
    patchSetting({ headroomTimeoutMs: next });
  };

  const handlePxpipeMinCharsBlur = () => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
  };

  const handleToolDisclosureEnabled = (value) => {
    setToolDisclosureEnabled(value);
    patchSetting({ toolDisclosureEnabled: value });
  };
  const handleToolDisclosureFilterEnabled = (value) => {
    setToolDisclosureFilterEnabled(value);
    patchSetting({ toolDisclosureFilterEnabled: value });
  };
  const handleToolDisclosureMaxToolsBlur = () => {
    const next = Math.max(1, Number(toolDisclosureMaxTools) || 20);
    setToolDisclosureMaxTools(next);
    patchSetting({ toolDisclosureMaxTools: next });
  };

  const refreshDisclosureStats = async () => {
    try {
      const res = await fetch("/api/tool-disclosure/stats");
      if (res.ok) setDisclosureStats(await res.json());
    } catch {}
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          setHeadroomTimeoutMs(
            typeof data.headroomTimeoutMs === "number" ? data.headroomTimeoutMs : "",
          );
          setCodeAware(data.headroomCodeAware === true);
          setKompress(data.headroomKompress !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          setPxpipeEnabled(!!data.pxpipeEnabled);
          if (typeof data.pxpipeMinChars === "number") setPxpipeMinChars(data.pxpipeMinChars);
          setToolDisclosureEnabled(!!data.toolDisclosureEnabled);
          setToolDisclosureFilterEnabled(!!data.toolDisclosureFilterEnabled);
          if (typeof data.toolDisclosureMaxTools === "number") setToolDisclosureMaxTools(data.toolDisclosureMaxTools);
          refreshHeadroomStatus();
          // PRD: run the PXPIPE health check automatically when the page opens
          refreshPxpipeStatus().then(runPxpipeHealth);
          refreshDisclosureStats();
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus, refreshPxpipeStatus, runPxpipeHealth]);

  const headroomRunning = !!headroomStatus.running;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomStatus.localUrl !== false && !headroomStatus.installed
        ? "Not installed"
        : headroomStatus.localUrl !== false
          ? "Stopped"
          : "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;

  const pxpipeHealthy = pxpipeHealth?.healthy === true;
  const pxpipeStatusLabel = pxpipeStatus.loading
    ? "Checking…"
    : pxpipeStatus.installing
      ? "Installing…"
      : !pxpipeStatus.installed
        ? "Not installed"
        : pxpipeHealthy
          ? "Healthy"
          : pxpipeStatus.running
            ? "Running"
            : "Stopped";
  const pxpipeChipClass =
    pxpipeHealthy || pxpipeStatus.running
      ? "bg-success-soft border-success-line text-success"
      : "bg-warning-soft border-warning-line text-warning";

  // Aggregate observability (truthful units only; see /api/token-saver/stats)
  const [tsStats, setTsStats] = useState(undefined); // undefined=loading, null=unavailable
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let activeController = null;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      const requestController = new AbortController();
      activeController = requestController;
      let timeoutId;
      try {
        timeoutId = setTimeout(
          () => requestController.abort(),
          TOKEN_SAVER_STATS_TIMEOUT_MS
        );
        const res = await fetch("/api/token-saver/stats", {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" },
          signal: requestController.signal,
        });
        if (!res.ok) throw new Error("stats fetch failed");
        const data = await res.json();
        if (alive) setTsStats(data);
      } catch (e) {
        if (e?.name === "AbortError") {
          if (!alive) return;
          // timeout abort while mounted: same as transient network failure
        }
        if (alive)
          setTsStats((current) =>
            current === undefined ? null : current
          );
      } finally {
        clearTimeout(timeoutId);
        if (activeController === requestController) activeController = null;
        inFlight = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, TOKEN_SAVER_STATS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      activeController?.abort();
    };
  }, []);

  return (
    <div className="space-y-5.5">
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">
              bolt
            </span>
            Token Saver
            <Tooltip text="Data boundary. RTK rewrites tool output locally. Headroom sends prompts to its configured compressor. Caveman and Ponytail change model-output instructions. PXPIPE renders context as images in-process." />
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="focus-ring rounded-sm text-xs font-normal text-brand underline hover:no-underline"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Rewrites git, grep, ls, tree and log output in place. The
              reduction this instance achieved is measured below, in RTK
              chars reduced.
            </p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => handleRtkEnabled(!rtkEnabled)}
            ariaLabel="Compress tool output with RTK"
          />
        </div>
        <div className="flex items-center justify-between py-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-medium">
                Compress context{" "}
                <a
                  href="https://github.com/chopratejas/headroom"
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring rounded-sm text-xs font-normal text-brand underline hover:no-underline"
                >
                  (Headroom)
                </a>
              </p>
              <span
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-[var(--radius-brand)] border ${headroomRunning ? "bg-success-soft border-success-line text-success" : "bg-warning-soft border-warning-line text-warning"}`}
              >
                <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
                  {headroomRunning ? "check_circle" : "pause_circle"}
                </span>
                {headroomStatusLabel}
              </span>
              <button
                type="button"
                onClick={() => setShowHeadroomInstallModal(true)}
                className="focus-ring hit-44 rounded-sm text-xs text-brand underline hover:no-underline"
              >
                {headroomRunning ? "Manage" : "Setup"}
              </button>
            </div>
            <p className="text-sm text-text-muted mt-1">
              Compress prompts via /v1/compress before routing to the model
            </p>
          </div>
          <Toggle
            checked={headroomEnabled}
            onChange={() => handleHeadroomEnabled(!headroomEnabled)}
            ariaLabel="Compress context before routing"
          />
        </div>
        {headroomStatus.installed && (
          <div className="mb-3 ms-1 ps-3 pb-4 border-s-2 border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-muted">
                Compression extras
                {headroomExtras.version ? ` · v${headroomExtras.version}` : ""}:
              </span>
              {headroomExtras.restricted && (
                <span className="text-xs text-warning">
                  Not readable from this address — open the dashboard on the host
                  (localhost) to manage compression extras.
                </span>
              )}
              {!headroomExtras.restricted && headroomExtras.available.map((extra) => {
                const installed = !!headroomExtras.extras[extra];
                const pending = pendingExtras.includes(extra);
                const extraTitle =
                  extra === "code"
                    ? "tree-sitter AST compression for code responses"
                    : "Kompress-v2 HF model for prose/agentic traces (~+1GB)";

                if (installed) {
                  const active = extra === "code" ? codeAware : kompress;
                  return (
                    <div
                      key={extra}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-[var(--radius-brand)] border border-success-line bg-success-soft text-text-main"
                      title={extraTitle}
                    >
                      <Toggle
                        size="sm"
                        checked={active}
                        disabled={restartingProxy}
                        onChange={() => toggleExtraActive(extra, !active)}
                        ariaLabel={`Compression extra [${extra}]`}
                      />
                      <span className="font-medium">[{extra}]</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveExtra(extra)}
                        disabled={removingExtra === extra}
                        className="focus-ring rounded-sm ms-1 text-danger underline hover:no-underline disabled:opacity-50"
                        title={`Uninstall [${extra}]`}
                      >
                        {removingExtra === extra ? "Uninstalling…" : "Uninstall"}
                      </button>
                    </div>
                  );
                }

                return (
                  <label
                    key={extra}
                    className={`focus-ring flex items-center gap-1.5 text-xs px-2 py-1 rounded-[var(--radius-brand)] border cursor-pointer transition-colors duration-150 ${
                      pending
                        ? "border-brand-line bg-brand-soft text-brand"
                        : "border-border text-text-muted hover:bg-surface-2"
                    }`}
                    title={extraTitle}
                  >
                    <input
                      type="checkbox"
                      className="w-3 h-3 accent-brand-500"
                      checked={pending}
                      onChange={() => togglePendingExtra(extra)}
                    />
                    <span className="font-medium">[{extra}]</span>
                    <span className="opacity-70">not installed</span>
                  </label>
                );
              })}
              {pendingExtras.length > 0 && (
                <Button
                  variant="primary" size="sm"
                  onClick={handleInstallExtras}
                  disabled={extrasActionLoading}
                >
                  {extrasActionLoading
                    ? "Installing…"
                    : `Install [proxy,${pendingExtras.join(",")}]`}
                </Button>
              )}
            </div>
            {extrasActionError && (
              <p className="text-xs text-danger mt-1">{extrasActionError}</p>
            )}
            {restartingProxy && (
              <p className="text-xs text-text-muted mt-1">Restarting proxy…</p>
            )}
            {(extrasActionLoading || removingExtra) && installLog && (
              <pre tabIndex={0} aria-label="Install log" className="focus-ring mt-2 max-h-32 overflow-auto rounded-[var(--radius-brand)] bg-surface-2 p-4 text-xs leading-tight text-text-muted whitespace-pre-wrap">
                {installLog}
              </pre>
            )}
            <p className="text-xs text-text-muted mt-1">
              Installing adds the package; use <code>on</code>/<code>off</code>{" "}
              to activate it (restarts the proxy). Default install is{" "}
              <code>[proxy]</code> only (SmartCrusher for JSON). Adding{" "}
              <code>[code]</code> enables AST compression
              (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding <code>[ml]</code>{" "}
              enables the Kompress-v2 HF model for prose/agentic traces but
              adds ~1 GB (torch + huggingface-hub).
            </p>
          </div>
        )}
        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="focus-ring rounded-sm text-xs font-normal text-brand underline hover:no-underline"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Asks the model for terse output. What the same answer would
              have cost without it is counterfactual, so no reduction is
              measured for it.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {visibleCavemanLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handleCavemanLevel(lvl.id)}
                      aria-pressed={cavemanLevel === lvl.id}
                      className={`focus-ring px-3 py-1.5 rounded-[var(--radius-brand)] text-xs font-medium border transition-colors duration-150 ${
                        cavemanLevel === lvl.id
                          ? "bg-brand-solid text-brand-on border-brand-solid"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted">
                  {
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={cavemanEnabled}
              onChange={() => handleCavemanEnabled(!cavemanEnabled)}
              ariaLabel="Compress LLM output with Caveman"
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Minimal code output{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="focus-ring rounded-sm text-xs font-normal text-brand underline hover:no-underline"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Ask the model to favor small, maintainable code changes: reuse,
              deletion before addition, and no speculative abstraction.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handlePonytailLevel(lvl.id)}
                      aria-pressed={ponytailLevel === lvl.id}
                      className={`focus-ring px-3 py-1.5 rounded-[var(--radius-brand)] text-xs font-medium border transition-colors duration-150 ${
                        ponytailLevel === lvl.id
                          ? "bg-brand-solid text-brand-on border-brand-solid"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted">
                  {
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={ponytailEnabled}
              onChange={() => handlePonytailEnabled(!ponytailEnabled)}
              ariaLabel="Bias code output toward minimal with Ponytail"
            />
          </div>
        </div>
        {/* Tool Disclosure (Phase 1+2) */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Filter MCP tool schemas</p>
            <p className="text-sm text-text-muted">
              Static config-driven exclusion of irrelevant MCP server schemas
            </p>
          </div>
          <Toggle
            checked={toolDisclosureFilterEnabled}
            onChange={() => handleToolDisclosureFilterEnabled(!toolDisclosureFilterEnabled)}
            ariaLabel="Filter MCP tool schemas"
          />
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">BM25 tool relevance</p>
            <p className="text-sm text-text-muted">
              Per-turn BM25 ranking — sends only the most relevant schemas (zero new deps)
            </p>
          </div>
          <Toggle
            checked={toolDisclosureEnabled}
            onChange={() => handleToolDisclosureEnabled(!toolDisclosureEnabled)}
            ariaLabel="Rank tools per turn with BM25"
          />
        </div>
        {toolDisclosureEnabled && (
          <div className="ms-1 ps-3 border-s-2 border-border mt-2 flex flex-col gap-2">
            <p className="text-sm font-medium">Max tools per turn</p>
            <Input
              value={String(toolDisclosureMaxTools)}
              onChange={(e) => setToolDisclosureMaxTools(e.target.value)}
              onBlur={handleToolDisclosureMaxToolsBlur}
              placeholder="20"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              BM25 runs when the tool count exceeds this threshold; top-K are kept.
            </p>
          </div>
        )}


        {/* PXPIPE card — unhidden by PR #3494 */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-medium">
                Compress prompts as images{" "}
                <a
                  href="https://github.com/teamchong/pxpipe"
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring rounded-sm text-xs font-normal text-brand underline hover:no-underline"
                >
                  (PXPIPE)
                </a>
              </p>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-[var(--radius-brand)] border ${pxpipeChipClass}`}>
                <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
                  {pxpipeHealthy || pxpipeStatus.running ? "check_circle" : "pause_circle"}
                </span>
                {pxpipeStatusLabel}
              </span>
              <button
                type="button"
                onClick={() => setShowPxpipeModal(true)}
                className="focus-ring hit-44 rounded-sm text-xs text-brand underline hover:no-underline"
              >
                {pxpipeStatus.installed ? "Manage" : "Setup"}
              </button>
              <a
                href="/dashboard/pxpipe"
                className="focus-ring hit-44 rounded-sm text-xs text-brand underline hover:no-underline"
              >
                Dashboard
              </a>
            </div>
            <p className="text-sm text-text-muted mt-1">
              Transforms large textual context into optimized images before
              sending to the LLM. Ideal for huge prompts, tool outputs and long
              conversations.
            </p>
          </div>
          <Toggle
            checked={pxpipeEnabled}
            disabled={!pxpipeStatus.installed}
            onChange={() => handlePxpipeEnabled(!pxpipeEnabled)}
            ariaLabel="Render context as images with pxpipe"
          />
        </div>

        {/* Aggregate observability — three separate units, never summed */}
        <section className="pt-4 mt-4 border-t border-border" aria-label="Token Saver aggregate statistics">
          <h3 className="text-sm font-semibold text-text-main mb-4">Aggregate statistics</h3>
          {tsStats === undefined ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : tsStats === null ? (
            <p className="text-sm text-text-muted">Statistics unavailable</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-[var(--radius-brand)] border border-border p-4">
                  <p className="text-xs font-medium text-text-muted">RTK</p>
                  <p className="text-lg font-semibold text-text-main metric">
                    {(tsStats.windows?.today?.charsReduced ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-text-muted">chars reduced today</p>
                </div>
                <div className="rounded-[var(--radius-brand)] border border-border p-4">
                  <p className="text-xs font-medium text-text-muted">Headroom</p>
                  <p className="text-lg font-semibold text-text-main metric">
                    {tsStats.sources?.headroom?.state === "ok"
                      ? (tsStats.windows?.today?.proxyTokensSaved ?? 0).toLocaleString()
                      : "\u2014"}
                  </p>
                  {tsStats.sources?.headroom?.state === "ok" ? (
                    <p className="text-xs text-text-muted">
                      proxy-reported tokens saved today ·{" "}
                      <span className="metric">{(tsStats.windows?.today?.bodyBytesReduced ?? 0).toLocaleString()}</span> body bytes reduced
                    </p>
                  ) : tsStats.sources?.headroom?.state === "idle" ? (
                    <p className="text-xs text-text-muted">No compression data yet</p>
                  ) : (
                    <p className="text-xs text-warning inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">warning</span>
                      Headroom statistics unavailable
                    </p>
                  )}
                </div>
                <div className="rounded-[var(--radius-brand)] border border-border p-4">
                  <p className="text-xs font-medium text-text-muted">PXPIPE</p>
                  <p className="text-lg font-semibold text-text-main metric">
                    {(tsStats.pxpipe?.windows?.today?.tokensSavedEst ?? 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-text-muted">estimated tokens saved today</p>
                </div>
              </div>

              {/* Phantom warning only when phantom events actually persisted */}
              {tsStats.recent?.some?.((r) => r.reason === "phantom") && (
                <p className="text-xs text-warning inline-flex items-start gap-1.5">
                  <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">warning</span>
                  Headroom recently reported token savings while the outbound body barely shrank — savings may be phantom.
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Daily token-saver aggregates by unit</caption>
                  <thead>
                    <tr className="text-start text-xs text-text-muted">
                      <th scope="col" className="px-4 py-3 font-medium">Day (UTC)</th>
                      <th scope="col" className="px-4 py-3 font-medium">RTK chars</th>
                      <th scope="col" className="px-4 py-3 font-medium">Headroom tokens</th>
                      <th scope="col" className="px-4 py-3 font-medium">PXPIPE est. tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tsStats.timeline || []).slice(-7).map((row) => (
                      <tr key={row.date} className="border-t border-border-subtle">
                        <td className="px-4 py-3 text-text-main metric">{row.date}</td>
                        <td className="px-4 py-3 text-text-main metric">{(row.charsReduced ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-text-main metric">{(row.proxyTokensSaved ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-text-main metric">{(row.estTokensSaved ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-[var(--radius-brand)] border border-border p-4">
                  <p className="text-xs font-medium text-text-muted">Caveman</p>
                  <p className="text-sm text-text-main">
                    {cavemanEnabled ? `Enabled (${cavemanLevel})` : "Disabled"}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Counterfactual output savings are not measurable.
                  </p>
                </div>
                <div className="rounded-[var(--radius-brand)] border border-border p-4">
                  <p className="text-xs font-medium text-text-muted">Ponytail</p>
                  <p className="text-sm text-text-main">
                    {ponytailEnabled ? `Enabled (${ponytailLevel})` : "Disabled"}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Counterfactual output savings are not measurable.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </Card>

      {(toolDisclosureEnabled || toolDisclosureFilterEnabled) && (
        <Card id="tool-disclosure-stats">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">build</span>
              MCP Tools
            </h2>
            <button
              type="button"
              onClick={refreshDisclosureStats}
              className="focus-ring hit-44 rounded-sm text-xs text-brand underline hover:no-underline"
            >
              Refresh
            </button>
          </div>

          {disclosureStats.length === 0 ? (
            <p className="text-sm text-text-muted">
              No tool disclosure events yet. Send a request with MCP tools attached to see stats.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {disclosureStats.slice(0, 5).map((entry, idx) => {
                const savedPct = entry.before > 0
                  ? Math.round((entry.stripped / entry.before) * 100)
                  : 0;
                const ago = Math.round((Date.now() - entry.ts) / 1000);
                const agoLabel = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
                return (
                  <div key={idx} className="rounded-[var(--radius-brand)] border border-border p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                      <span className="font-mono truncate min-w-0">
                        {entry.connectionId ? `session:${entry.connectionId.slice(-8)}` : "no session"}
                      </span>
                      <span className="metric shrink-0">{agoLabel}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-medium font-mono text-text-main metric">{entry.before}</span>
                      <span className="text-text-muted" aria-hidden="true">→</span>
                      <span className="font-medium font-mono text-text-main metric">{entry.after}</span>
                      {entry.stripped > 0 && (
                        <span className="text-xs px-2 py-1 rounded-[var(--radius-brand)] border border-info-line bg-info-soft text-info ms-auto metric">
                          −{entry.stripped} schemas ({savedPct}%)
                        </span>
                      )}
                    </div>
                    {entry.keptNames?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {entry.keptNames.map((n) => (
                          <span key={n} title={`Kept: ${n}`} className="text-xs px-1.5 py-1 rounded-[var(--radius-brand)] bg-success-soft text-success font-mono truncate max-w-[180px]">{n}</span>
                        ))}
                        {(entry.strippedNames || []).map((n) => (
                          <span key={n} title={`Stripped: ${n}`} className="text-xs px-1.5 py-1 rounded-[var(--radius-brand)] bg-surface-2 text-text-muted font-mono truncate max-w-[180px] line-through">{n}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span
              className={headroomRunning ? "text-success" : "text-warning"}
            >
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className="focus-ring block w-full rounded-[var(--radius-brand)] border border-border px-4 py-2 text-center text-sm text-text-main hover:bg-surface-2 transition-colors duration-150"
            >
              Open Headroom Dashboard
            </a>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Proxy URL</p>
            <Input
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              onBlur={handleHeadroomUrlBlur}
              placeholder="http://localhost:8787"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Use a local proxy for Start/Stop, or an external Docker sidecar
              like http://headroom:8787.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Request Timeout (ms)</p>
            <Input
              value={String(headroomTimeoutMs)}
              onChange={(e) => setHeadroomTimeoutMs(e.target.value)}
              onBlur={handleHeadroomTimeoutBlur}
              placeholder="30000"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              How long a compression request may take before the body is sent
              uncompressed. Leave empty to use HEADROOM_TIMEOUT_MS, or the
              built-in default.
            </p>
          </div>
          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className="text-sm text-success">
              Headroom proxy is reachable. You can enable the token saver.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <p className="text-sm text-warning">
              Start Headroom separately at the configured URL, then recheck.
            </p>
          ) : !headroomStatus.python ? (
            <p className="text-sm text-warning">
              Python ≥ 3.10 required for local managed mode. Install Python
              first, or use an external proxy URL.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Install then click Start:</p>
              <div className="flex items-center gap-2">
                <pre className="flex-1 rounded-[var(--radius-brand)] bg-surface-2 text-text-main p-4 text-xs font-mono overflow-x-auto">
                  {`pip install "headroom-ai[proxy]"`}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copy(`pip install "headroom-ai[proxy]"`)
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          {headroomActionError && (
            <p className="text-sm text-warning">{headroomActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPxpipeModal}
        title={pxpipeStatus.installed ? "PXPIPE" : "Setup PXPIPE"}
        onClose={() => setShowPxpipeModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Compress prompts using multimodal encoding. Runs in-process — no
            extra server or environment variables required.
          </p>
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span className={pxpipeHealthy || pxpipeStatus.running ? "text-success" : "text-warning"}>
              {pxpipeStatusLabel}
              {pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}
            </span>
          </div>
          {pxpipeHealth?.checks?.length > 0 && (
            <div className="flex flex-col gap-1 rounded-[var(--radius-brand)] border border-border p-4">
              <p className="text-sm font-semibold text-text-main mb-1">Health check</p>
              {pxpipeHealth.checks.map((check) => (
                <div key={check.id} className="flex items-center justify-between text-xs">
                  <span className={`inline-flex items-center gap-1 ${check.ok ? "text-success" : "text-warning"}`}>
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      {check.ok ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    {check.label}
                  </span>
                  {check.detail && (
                    <span className="text-text-muted font-mono truncate max-w-[50%]">{check.detail}</span>
                  )}
                </div>
              ))}
              {pxpipeHealth.error && (
                <p className="text-xs text-warning mt-1">{pxpipeHealth.error}</p>
              )}
            </div>
          )}
          {!pxpipeStatus.installed ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-warning inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">warning</span>
                PXPIPE is not installed.
              </p>
              <Button
                onClick={() => pxpipeAction("install")}
                fullWidth
                disabled={pxpipeActionLoading || pxpipeStatus.installing}
              >
                {pxpipeActionLoading || pxpipeStatus.installing ? "Installing…" : "Install"}
              </Button>
              <p className="text-xs text-text-muted">
                Installs the npm package <code className="font-mono">pxpipe-proxy</code> into
                the TokenProxy data directory. May take a few minutes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {pxpipeStatus.running ? (
                <>
                  <Button onClick={() => pxpipeAction("restart")} variant="ghost" disabled={pxpipeActionLoading}>
                    Restart
                  </Button>
                  <Button onClick={() => pxpipeAction("stop")} variant="ghost" disabled={pxpipeActionLoading}>
                    Stop
                  </Button>
                </>
              ) : (
                <Button onClick={() => pxpipeAction("start")} disabled={pxpipeActionLoading}>
                  {pxpipeActionLoading ? "Starting…" : "Start"}
                </Button>
              )}
              <Button onClick={() => pxpipeAction("install")} variant="ghost" disabled={pxpipeActionLoading}>
                Repair
              </Button>
              <a
                href="/dashboard/pxpipe#logs"
                className="focus-ring col-span-2 rounded-[var(--radius-brand)] border border-border px-4 py-2 text-center text-sm text-text-main hover:bg-surface-2 transition-colors duration-150"
              >
                Open Logs
              </a>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Minimum prompt size (chars)</p>
            <Input
              value={String(pxpipeMinChars)}
              onChange={(e) => setPxpipeMinChars(e.target.value)}
              onBlur={handlePxpipeMinCharsBlur}
              placeholder="25000"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Requests smaller than this bypass PXPIPE and are sent as-is.
            </p>
          </div>
          {pxpipeActionError && (
            <p className="text-sm text-warning">{pxpipeActionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshPxpipeStatus().then(runPxpipeHealth)}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button onClick={() => setShowPxpipeModal(false)} fullWidth>
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!extrasConfirm}
        onClose={() => setExtrasConfirm(null)}
        onConfirm={() => {
          const fn = extrasConfirm?.onConfirm;
          setExtrasConfirm(null);
          fn?.();
        }}
        title={extrasConfirm?.title}
        message={extrasConfirm?.message}
        confirmText={extrasConfirm?.confirmText}
        variant={extrasConfirm?.variant}
      />
    </div>
  );
}
