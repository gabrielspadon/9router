import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import { SocksProxyAgent } from "socks-proxy-agent";

const TUNNEL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);

const nodePrimitives = {
  netConnect: options => net.connect(options),
  tlsConnect: options => tls.connect(options),
  http2Connect: (origin, options) => http2.connect(origin, options),
  createSocksAgent: proxyUrl => new SocksProxyAgent(proxyUrl),
};

function abortReason(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function destroyOnce(resource, error, destroyed) {
  if (!resource || destroyed.has(resource)) return;
  destroyed.add(resource);
  try {
    if (typeof resource.destroy === "function") resource.destroy(error);
    else if (typeof resource.close === "function") resource.close();
  } catch {}
}

function waitForEvent(resource, eventName, signal, destroyed) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      resource.removeListener?.(eventName, onEvent);
      resource.removeListener?.("error", onError);
      resource.removeListener?.("close", onClosed);
      resource.removeListener?.("end", onClosed);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onEvent = () => settle(resolve, resource);
    const onError = error => settle(reject, signal?.aborted ? abortReason(signal) : error);
    const onClosed = () => settle(reject, connectionClosedError());
    const onAbort = () => {
      const reason = abortReason(signal);
      destroyOnce(resource, reason, destroyed);
      settle(reject, reason);
    };

    resource.once(eventName, onEvent);
    resource.once("error", onError);
    resource.once("close", onClosed);
    resource.once("end", onClosed);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function waitWithAbort(promise, signal, onLateValue) {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => {
        if (settled) {
          onLateValue?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function requiredUnavailableError(route) {
  return Object.assign(new Error(route.reason || "Required proxy is unavailable"), {
    code: "required_proxy_unavailable",
  });
}

function unsupportedRelayError() {
  return Object.assign(new Error("Relay does not support HTTP/2 tunnelling"), {
    code: "unsupported_proxy_route",
  });
}

function connectionClosedError() {
  return Object.assign(new Error("HTTP/2 connection closed before readiness"), {
    code: "http2_connection_closed",
  });
}

function proxyConnectError(status) {
  return Object.assign(new Error(`Proxy CONNECT failed with status ${status}`), {
    code: "proxy_connect_failed",
  });
}

function targetOrigin(target) {
  return `${target.protocol}//${target.host}`;
}

function targetPort(target) {
  if (target.port) return Number(target.port);
  return target.protocol === "https:" ? 443 : 80;
}

function proxyAuthorization(proxy) {
  if (!proxy.username && !proxy.password) return "";
  const username = decodeURIComponent(proxy.username);
  const password = decodeURIComponent(proxy.password);
  return `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`;
}

function establishHttpConnect(socket, target, proxy, signal, destroyed) {
  throwIfAborted(signal);
  const authority = `${target.hostname}:${targetPort(target)}`;
  const request = [
    `CONNECT ${authority} HTTP/1.1\r\n`,
    `Host: ${authority}\r\n`,
    "Proxy-Connection: Keep-Alive\r\n",
    proxyAuthorization(proxy),
    "\r\n",
  ].join("");

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffered = Buffer.alloc(0);
    const cleanup = () => {
      socket.removeListener?.("data", onData);
      socket.removeListener?.("error", onError);
      socket.removeListener?.("close", onClosed);
      socket.removeListener?.("end", onClosed);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onError = error => finish(reject, signal?.aborted ? abortReason(signal) : error);
    const onClosed = () => finish(reject, connectionClosedError());
    const onAbort = () => {
      const reason = abortReason(signal);
      destroyOnce(socket, reason, destroyed);
      finish(reject, reason);
    };
    const onData = chunk => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0) return;

      const header = buffered.subarray(0, boundary).toString("latin1");
      const status = /^HTTP\/\d\.\d\s+(\d{3})(?:\s|$)/i.exec(header)?.[1];
      if (status !== "200") {
        finish(reject, proxyConnectError(status || "invalid"));
        return;
      }
      const remainder = buffered.subarray(boundary + 4);
      if (remainder.length) socket.unshift?.(remainder);
      finish(resolve, socket);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClosed);
    socket.once("end", onClosed);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      socket.write(request);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function openTargetTls(socket, target, signal, primitives, destroyed) {
  const targetSocket = primitives.tlsConnect({
    socket,
    servername: target.hostname,
    ALPNProtocols: ["h2"],
  });
  try {
    await waitForEvent(targetSocket, "secureConnect", signal, destroyed);
    return targetSocket;
  } catch (error) {
    destroyOnce(targetSocket, error, destroyed);
    throw error;
  }
}

async function openProxyTunnel(target, route, signal, primitives, destroyed) {
  const proxy = new URL(route.proxyUrl);
  if (!TUNNEL_PROTOCOLS.has(proxy.protocol)) {
    throw Object.assign(new Error("Unsupported proxy protocol"), { code: "unsupported_proxy_protocol" });
  }

  let proxySocket;
  try {
    if (proxy.protocol.startsWith("socks")) {
      const agent = primitives.createSocksAgent(route.proxyUrl);
      const request = { destroy() {} };
      proxySocket = await waitWithAbort(
        agent.connect(request, {
          host: target.hostname,
          port: targetPort(target),
          secureEndpoint: false,
        }),
        signal,
        value => destroyOnce(value, abortReason(signal), destroyed),
      );
      throwIfAborted(signal);
      return await openTargetTls(proxySocket, target, signal, primitives, destroyed);
    }

    const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
    if (proxy.protocol === "https:") {
      proxySocket = primitives.tlsConnect({
        host: proxy.hostname,
        port: proxyPort,
        servername: proxy.hostname,
      });
      await waitForEvent(proxySocket, "secureConnect", signal, destroyed);
    } else {
      proxySocket = primitives.netConnect({ host: proxy.hostname, port: proxyPort });
      await waitForEvent(proxySocket, "connect", signal, destroyed);
    }

    await establishHttpConnect(proxySocket, target, proxy, signal, destroyed);
    return await openTargetTls(proxySocket, target, signal, primitives, destroyed);
  } catch (error) {
    destroyOnce(proxySocket, error, destroyed);
    throw error;
  }
}

async function openSession(target, tunnel, signal, primitives, destroyed) {
  const options = tunnel ? { createConnection: () => tunnel } : {};
  const session = primitives.http2Connect(targetOrigin(target), options);
  try {
    await waitForEvent(session, "connect", signal, destroyed);
    return session;
  } catch (error) {
    destroyOnce(session, error, destroyed);
    throw error;
  }
}

function makeLease(session, tunnel, effectiveRoute) {
  let closed = false;
  let tunnelClosed = false;
  const closeTunnel = error => {
    if (tunnelClosed || !tunnel) return;
    tunnelClosed = true;
    try { tunnel.destroy?.(error); } catch {}
  };
  session.once?.("close", closeTunnel);
  session.once?.("error", closeTunnel);

  return {
    session,
    effectiveRoute,
    close() {
      if (closed) return;
      closed = true;
      try { session.close?.(); } finally { closeTunnel(); }
    },
  };
}

async function connectOne(target, route, signal, primitives, destroyed) {
  let tunnel = null;
  let session = null;
  try {
    if (route.kind === "proxy") {
      tunnel = await openProxyTunnel(target, route, signal, primitives, destroyed);
    }
    session = await openSession(target, tunnel, signal, primitives, destroyed);
    return makeLease(session, tunnel, route);
  } catch (error) {
    destroyOnce(session, error, destroyed);
    destroyOnce(tunnel, error, destroyed);
    throw signal?.aborted ? abortReason(signal) : error;
  }
}

/**
 * Establish one HTTP/2 session through a direct, HTTP(S), or SOCKS route.
 * The caller supplies the already-composed deadline and caller-abort signal.
 */
export async function connectHttp2(url, { route, signal, primitives = nodePrimitives } = {}) {
  throwIfAborted(signal);
  const target = new URL(url);
  if (route?.kind === "required-unavailable") throw requiredUnavailableError(route);
  if (route?.kind === "relay") throw unsupportedRelayError();
  if (route?.kind !== "direct" && route?.kind !== "proxy") {
    throw Object.assign(new Error("Unsupported HTTP/2 route"), { code: "unsupported_proxy_route" });
  }
  if (route.kind === "proxy") {
    let protocol;
    try { protocol = new URL(route.proxyUrl).protocol; } catch { protocol = ""; }
    if (!TUNNEL_PROTOCOLS.has(protocol)) {
      throw Object.assign(new Error("Unsupported proxy protocol"), { code: "unsupported_proxy_protocol" });
    }
  }

  const destroyed = new Set();
  try {
    return await connectOne(target, route, signal, primitives, destroyed);
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (route.kind !== "proxy" || route.strictProxy === true) throw error;
    const directRoute = { kind: "direct", strictProxy: false, cacheIdentity: "direct" };
    return connectOne(target, directRoute, signal, primitives, destroyed);
  }
}
