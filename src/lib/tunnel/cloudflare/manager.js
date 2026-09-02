import { loadState, saveState, generateShortId } from "../shared/state.js";
import { spawnQuickTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler } from "./cloudflared.js";
import { clearPid } from "./pid.js";
import { waitForHealth, probeUrlAlive } from "./healthCheck.js";
import { WORKER_URL, INSECURE_WORKER, publicUrlFor } from "./config.js";
import { workerFetch } from "./workerFetch.js";
import { getSettings, updateSettings } from "@/lib/localDb";

const svc = {
  cancelToken: { cancelled: false },
  enablePromise: null,
  settingsWrite: Promise.resolve(),
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService() { return svc; }

/**
 * Is the tunnel actually serving, as opposed to merely having a live process?
 *
 * The watchdog used to return as soon as isCloudflaredRunning() was true, so a
 * cloudflared that was up but not reachable stayed that way forever and the
 * tunnel never recovered (#3412). The direct URL answering is what settles that.
 *
 * The relay is probed too, but only to decide whether the short link may be
 * offered, and to repair a mapping the relay has lost.
 *
 * Returns true when there is nothing to test — no persisted URL means the
 * tunnel has not been established yet, which is not a reachability failure.
 */
export async function isTunnelReachable() {
  const existing = loadState();
  if (!existing?.tunnelUrl || !existing?.shortId) return true;
  const publicUrl = publicUrlFor(existing.shortId);
  const [directOk, publicOk] = await Promise.all([
    probeUrlAlive(existing.tunnelUrl),
    probeUrlAlive(publicUrl),
  ]);

  // Whether the relay answers decides whether the short link may be offered, and
  // reconciling it here is what lets a mapping that was lost or never accepted
  // come back without the user toggling the tunnel (#1365).
  if (publicOk !== (existing.registered === true)) {
    saveState({ ...existing, registered: publicOk });
  }
  // A relay that lost the mapping is repaired by registering again, not by
  // respawning cloudflared. The next tick's probe decides whether it took.
  if (!publicOk) await tryRegister(existing.shortId, existing.tunnelUrl);

  // The relay is a third party. Its being down does not mean this tunnel died,
  // and restarting cloudflared over it rotates the quick-tunnel URL and drops
  // every client already using it. The direct URL answering is the tunnel
  // serving, which is the condition #3412 needed.
  return directOk;
}
export function isTunnelManuallyDisabled() { return svc.cancelToken.cancelled; }
export function isTunnelReconnecting() { return svc.spawnInProgress; }

let onUnexpectedExit = null;
export function setTunnelUnexpectedExitCallback(cb) { onUnexpectedExit = cb; }

async function registerTunnelUrl(shortId, tunnelUrl) {
  // fetch resolves for 4xx and 5xx as well, and nothing here read the status, so
  // a relay that refused the mapping left the dashboard offering a short link
  // the relay had never heard of. That is the 404 in #1365, with the direct
  // *.trycloudflare.com URL serving perfectly beside it.
  const res = await workerFetch(`${WORKER_URL}/api/tunnel/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId, tunnelUrl }),
  });
  if (!res.ok) {
    throw new Error(`relay rejected the short link for ${shortId}: HTTP ${res.status}`);
  }
}

/**
 * Register, and report whether the short link may be offered.
 *
 * A relay failure must not fail the whole enable: the direct tunnel URL is up
 * and usable either way. Only the short link is lost, so only the short link is
 * withheld.
 */
async function tryRegister(shortId, tunnelUrl) {
  try {
    await registerTunnelUrl(shortId, tunnelUrl);
    return true;
  } catch (e) {
    console.warn(`[Tunnel] short link unavailable: ${e.message}`);
    return false;
  }
}

function throwIfCancelled(token) {
  if (token.cancelled) throw new Error("tunnel cancelled");
}

function writeTunnelSettings(next) {
  // A canceled URL-update callback can already be awaiting SQLite when a user
  // disables and re-enables. Keep every manager-owned write in call order, so
  // the retry is the final durable state rather than a stale callback.
  const write = svc.settingsWrite.catch(() => {}).then(() => updateSettings(next));
  svc.settingsWrite = write;
  return write;
}

async function persistEnabledTunnel(token, shortId, tunnelUrl, registered) {
  throwIfCancelled(token);
  saveState({ shortId, tunnelUrl, registered });
  await writeTunnelSettings({ tunnelEnabled: true, tunnelUrl });

  if (!token.cancelled) return;

  // disableTunnel() persists false while the enabled write may still be in
  // flight. Repeat that write after it settles, otherwise the stale enable can
  // be the last durable state.
  if (svc.cancelToken === token) {
    const state = loadState();
    if (state?.tunnelUrl === tunnelUrl) {
      saveState({ shortId: state.shortId, tunnelUrl: null });
    }
    await writeTunnelSettings({ tunnelEnabled: false, tunnelUrl: "" });
  }
  throwIfCancelled(token);
}

async function runEnable(localPort, token) {
  console.log(`[Tunnel] enable start (port=${localPort})`);

  try {
    throwIfCancelled(token);
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && existing?.shortId) {
        // A dead direct URL is a stale socket after a network change and needs a
        // respawn. A dead relay needs a re-register, and respawning for it would
        // rotate a working quick-tunnel URL for nothing (#1365).
        const [directOk, publicOk] = await Promise.all([
          probeUrlAlive(existing.tunnelUrl),
          probeUrlAlive(publicUrlFor(existing.shortId)),
        ]);
        throwIfCancelled(token);
        if (directOk) {
          const registered = publicOk || await tryRegister(existing.shortId, existing.tunnelUrl);
          throwIfCancelled(token);
          saveState({ ...existing, registered });
          console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
          return {
            success: true,
            tunnelUrl: existing.tunnelUrl,
            shortId: existing.shortId,
            publicUrl: registered ? publicUrlFor(existing.shortId) : "",
            alreadyRunning: true,
          };
        }
        console.log(`[Tunnel] stale (direct=${directOk} public=${publicOk}), respawn`);
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token);

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      console.log(`[Tunnel] url updated: ${url}`);
      const registered = await tryRegister(shortId, url);
      try {
        await persistEnabledTunnel(token, shortId, url, registered);
      } catch (e) {
        if (!/tunnel cancelled/.test(e.message)) {
          console.warn(`[Tunnel] url update error: ${e.message}`);
        }
      }
    };

    // Register exit handler BEFORE spawn so it fires even on early exit
    setUnexpectedExitHandler(() => {
      console.warn("[Tunnel] cloudflared exited unexpectedly, scheduling respawn");
      if (onUnexpectedExit) onUnexpectedExit();
    });

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    console.log(`[Tunnel] spawned: ${tunnelUrl}`);
    throwIfCancelled(token);

    const registered = await tryRegister(shortId, tunnelUrl);
    const publicUrl = registered ? publicUrlFor(shortId) : "";
    await persistEnabledTunnel(token, shortId, tunnelUrl, registered);
    console.log(`[Tunnel] registered shortId=${shortId} publicUrl=${publicUrl || "(none)"}`);

    // Prefer the relay (its worker route is usually the first to answer), but accept
    // the direct *.trycloudflare.com URL too: whichever answers first proves the
    // tunnel is up. Requiring the relay alone failed the whole enable whenever its
    // registration lagged past the 60 s budget, even with the tunnel already serving.
    const healthyUrl = await waitForHealth([publicUrl, tunnelUrl], token);
    throwIfCancelled(token);
    if (healthyUrl === publicUrl) {
      console.log("[Tunnel] public URL healthy");
      // Direct tunnel probe is best-effort: DNS for *.trycloudflare.com can be slow/blocked
      if (!(await probeUrlAlive(tunnelUrl))) {
        console.warn("[Tunnel] direct URL not reachable yet, continuing via publicUrl");
      } else {
        console.log("[Tunnel] direct URL healthy");
      }
      throwIfCancelled(token);
    } else {
      console.warn(`[Tunnel] relay not answering yet, continuing via direct URL: ${healthyUrl}`);
    }

    console.log("[Tunnel] enable success");
    return { success: true, tunnelUrl, shortId, publicUrl };
  } catch (e) {
    // Suppress noise when spawn was deliberately killed (restart/disable superseded it)
    if (!/cloudflared killed|tunnel cancelled/.test(e.message)) {
      console.error(`[Tunnel] enable error: ${e.message}`);
      if (/fetch failed|self signed|self-signed|certificate/i.test(e.message) && !INSECURE_WORKER) {
        console.error("[Tunnel] hint: worker TLS rejected. Set TUNNEL_WORKER_INSECURE=1 to bypass cert check for the worker host.");
      }
    }
    throw e;
  } finally {
    if (svc.cancelToken === token) svc.spawnInProgress = false;
  }
}

export function enableTunnel(localPort = 20128) {
  if (svc.enablePromise) {
    if (!svc.cancelToken.cancelled) return svc.enablePromise;

    // A user can re-enable before the canceled operation has unwound. Queue
    // that request behind it instead of returning the stale rejection.
    return svc.enablePromise.catch(() => {}).then(() => enableTunnel(localPort));
  }

  const token = { cancelled: false };
  svc.cancelToken = token;
  svc.activeLocalPort = localPort;
  svc.spawnInProgress = true;

  // Schedule after publishing the promise so a second synchronous call joins
  // this enable rather than starting a second cloudflared process.
  const enablePromise = Promise.resolve().then(() => runEnable(localPort, token));
  svc.enablePromise = enablePromise;
  enablePromise.finally(() => {
    if (svc.enablePromise === enablePromise) svc.enablePromise = null;
  }).catch(() => {});
  return enablePromise;
}

export async function disableTunnel() {
  console.log("[Tunnel] disable");
  // Abort any in-flight enable so it cannot resurrect state after we clear it
  svc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);

  try { killCloudflared(svc.activeLocalPort); } catch (e) { console.warn(`[Tunnel] kill warn: ${e.message}`); }
  clearPid();

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, tunnelUrl: null });

  await writeTunnelSettings({ tunnelEnabled: false, tunnelUrl: "" });
  // Force-clear flags so a subsequent enable is not blocked by a stuck spawnInProgress
  svc.spawnInProgress = false;
  svc.activeLocalPort = null;
  return { success: true };
}

export async function getTunnelStatus() {
  const settings = await getSettings();
  const settingsEnabled = settings.tunnelEnabled === true;
  const state = loadState();
  const shortId = state?.shortId || "";
  // Withheld until the relay is known to serve it, so the dashboard stops
  // offering a link that 404s while the direct URL works (#1365).
  const publicUrl = state?.registered === true ? publicUrlFor(shortId) : "";
  const tunnelUrl = state?.tunnelUrl || "";

  // Lazy: skip PID probe entirely when user disabled tunnel
  const running = settingsEnabled ? isCloudflaredRunning() : false;

  return {
    enabled: settingsEnabled && running,
    settingsEnabled,
    tunnelUrl,
    shortId,
    publicUrl,
    running
  };
}
