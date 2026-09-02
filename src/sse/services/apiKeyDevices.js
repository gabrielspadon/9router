import crypto from "node:crypto";
import { getClientIp } from "@/lib/auth/loginLimiter.js";

/**
 * Count the distinct clients using each API key (#930).
 *
 * Usage already answers how much a key spent; it could not answer how many
 * things were spending it, which is what makes a leaked or shared key visible.
 *
 * IDENTITY. A client is the pair (IP, User-Agent), hashed, so nothing here
 * stores an address. The IP comes from getClientIp, which trusts x-tp-real-ip
 * only when custom-server proves it stamped it from the TCP socket — the
 * report proposed reading x-forwarded-for, which is exactly the header
 * custom-server.js:284 deletes because a client can set it, and counting it
 * would let one client inflate its own count at will.
 *
 * IN MEMORY, BY DESIGN. The report's own non-goal. A device count is a live
 * question ("who is on this key right now"), so it is answered from a window
 * that expires rather than from a table that accumulates.
 */

const TTL_MS = 30 * 60 * 1000;
// A ceiling, so a key hammered by a rotating fleet cannot grow this map without
// bound between sweeps. The oldest entries go first, which are the ones a TTL
// was about to drop anyway.
const MAX_DEVICES_PER_KEY = 500;

const byKey = new Map();

function fingerprint(ip, userAgent) {
  return crypto.createHash("sha256").update(`${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

function sweep(devices, now) {
  for (const [id, seenAt] of devices) if (now - seenAt > TTL_MS) devices.delete(id);
}

/**
 * Record that `apiKey` was just used by whoever sent `request`. Never throws:
 * this is bookkeeping on the request path and must not be able to fail one.
 */
export function recordApiKeyDevice(apiKey, request) {
  if (!apiKey || !request) return;
  try {
    const ip = getClientIp(request);
    const userAgent = request.headers?.get?.("user-agent") || "";
    const now = Date.now();

    let devices = byKey.get(apiKey);
    if (!devices) {
      devices = new Map();
      byKey.set(apiKey, devices);
    }
    sweep(devices, now);

    const id = fingerprint(ip, userAgent);
    // Delete before set so a returning client moves to the end of the insertion
    // order, which is what makes the eviction below drop the least recent.
    devices.delete(id);
    devices.set(id, now);

    while (devices.size > MAX_DEVICES_PER_KEY) {
      devices.delete(devices.keys().next().value);
    }
  } catch {
    /* never fail a request over bookkeeping */
  }
}

/** Live device count for one key. */
export function getApiKeyDeviceCount(apiKey) {
  const devices = byKey.get(apiKey);
  if (!devices) return 0;
  sweep(devices, Date.now());
  return devices.size;
}

/** { [apiKey]: count } for every key seen inside the window. */
export function getApiKeyDeviceCounts() {
  const now = Date.now();
  const out = {};
  for (const [apiKey, devices] of byKey) {
    sweep(devices, now);
    if (devices.size === 0) {
      byKey.delete(apiKey);
      continue;
    }
    out[apiKey] = devices.size;
  }
  return out;
}

// Test seam: the module is a process-wide singleton, so a suite needs a way to
// start from empty without reaching into the map.
export function __resetApiKeyDevices() {
  byKey.clear();
}
