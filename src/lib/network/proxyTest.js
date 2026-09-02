import { fetch as undiciFetch } from "undici";
import { createProxyDispatcher } from "open-sse/utils/proxyFetch.js";

import { fetchPublicUrl, findBlockedError } from "@/shared/utils/ssrfGuard.js";

const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;
const RELAY_TIMEOUT_MS = 30000;
const RELAY_PROBE_TARGET = "https://api.ipify.org";
const RELAY_PROBE_PATH = "/?format=json";

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Probe a vercel/cloudflare relay pool entry.
 *
 * The relay URL is fetched DIRECTLY by this server, so it is guarded with
 * `fetchPublicUrl`: `assertPublicUrl` rejects literal internal targets before any
 * socket opens, and the public-only connector rejects a hostname that resolves or
 * redirects to one. A relay is always a public serverless deployment, so nothing
 * legitimate is lost. `testProxyUrl` below is deliberately NOT guarded: there the
 * URL is a proxy the operator dials THROUGH, and a proxy on the LAN or on loopback
 * is a normal configuration rather than a forged request.
 */
export async function testRelayUrl({ relayUrl } = {}) {
  const normalizedRelayUrl = normalizeString(relayUrl);
  if (!normalizedRelayUrl) {
    return { ok: false, status: 400, error: "Blocked relay URL: missing host. A relay pool must point at a public URL." };
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const res = await fetchPublicUrl(normalizedRelayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": RELAY_PROBE_TARGET,
        "x-relay-path": RELAY_PROBE_PATH,
      },
      signal: controller.signal,
    });

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    const blocked = findBlockedError(err);
    if (blocked) {
      return {
        ok: false,
        status: 400,
        error: `${blocked.message}. A relay pool must point at a public URL.`,
      };
    }

    return {
      ok: false,
      status: 500,
      error: err?.name === "AbortError" ? "Relay test timed out" : getErrorMessage(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    try {
      // A socks URL needs a socks connector, not a CONNECT proxy: building a
      // ProxyAgent for one rejected the scheme outright, so a working socks5
      // proxy was reported as invalid on the settings screen (#2053).
      dispatcher = await createProxyDispatcher(normalizedProxyUrl);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${err?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "TokenProxy",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}
