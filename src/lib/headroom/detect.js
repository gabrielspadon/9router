import { Agent } from "undici";

const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

export const DEFAULT_HEADROOM_URL =
  process.env.HEADROOM_URL || "http://localhost:8787";

export function parseHeadroomTimeoutMs() {
  const raw = Number(process.env.HEADROOM_TIMEOUT_MS);
  return Number.isFinite(raw) &&
    Number.isInteger(raw) &&
    raw > 0 &&
    raw < 600000
    ? raw
    : 30000;
}

// Windows commonly resolves the bare "localhost" hostname to the IPv6
// loopback before the IPv4 one, while a locally started headroom proxy binds
// only 127.0.0.1 — the health probe then reports "not running" against a
// proxy that is actually up (#2476, same DNS-order mismatch as the compress
// call in rtk/headroom.js). Force IPv4 only for the literal "localhost" host.
const IPV4_LOOPBACK_DISPATCHER = new Agent({ connect: { family: 4 } });
function dispatcherForUrl(url) {
  try {
    return new URL(url).hostname === "localhost" ? IPV4_LOOPBACK_DISPATCHER : undefined;
  } catch {
    return undefined;
  }
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS),
      dispatcher: dispatcherForUrl(url),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard. Headroom runs externally (operator- or
// user-managed at headroomUrl); tokenproxy only intermediates compression
// traffic to it, so the only local facts are reachability and loopback-ness.
export async function getHeadroomStatus(url) {
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  return { running, localUrl };
}
