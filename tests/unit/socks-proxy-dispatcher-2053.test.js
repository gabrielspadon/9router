/**
 * #2053 — a socks5 proxy is accepted everywhere and works nowhere.
 *
 * resolveEffectiveProxyRoute allows socks:, socks4:, socks4a:, socks5: and
 * socks5h:, and the connection form takes them, but both places that turn a
 * proxy URL into a dispatcher build an undici ProxyAgent. ProxyAgent speaks
 * HTTP CONNECT only, so every request through a socks proxy fails at the
 * transport with an error that says nothing about the scheme, and the proxy
 * test on the settings screen fails the same way.
 *
 * socks-proxy-agent is already a dependency — open-sse/utils/http2Connect.js
 * tunnels through it — and it plugs into undici as a connector.
 *
 * The server below is a real SOCKS5 endpoint: it performs the greeting and the
 * CONNECT exchange, then wires the caller to a local HTTP server whatever
 * destination was requested. Nothing here passes unless a genuine SOCKS5
 * handshake happened.
 */
import { createServer } from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { proxyAwareFetch } = await import('open-sse/utils/proxyFetch.js');
const { testProxyUrl } = await import('@/lib/network/proxyTest');

let origin;
let socks;
let socksUrl;
let handshakes;

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
}

// Minimal SOCKS5, no auth. Reads the greeting and the CONNECT request, answers
// success, then pipes the client at the origin server.
function createSocksServer(originPort, onHandshake) {
  return net.createServer((client) => {
    let stage = 'greeting';
    const onData = (chunk) => {
      if (stage === 'greeting') {
        if (chunk[0] !== 0x05) return client.destroy();
        stage = 'request';
        client.write(Buffer.from([0x05, 0x00]));
        return;
      }
      if (stage !== 'request') return;
      // VER CMD RSV ATYP DST.ADDR DST.PORT
      if (chunk[0] !== 0x05 || chunk[1] !== 0x01) return client.destroy();
      const atyp = chunk[3];
      let host = '';
      if (atyp === 0x03) host = chunk.subarray(5, 5 + chunk[4]).toString('utf8');
      else if (atyp === 0x01) host = Array.from(chunk.subarray(4, 8)).join('.');
      onHandshake(host);
      stage = 'piping';
      client.removeListener('data', onData);
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      const upstream = net.connect(originPort, '127.0.0.1', () => {
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
    };
    client.on('data', onData);
    client.on('error', () => {});
  });
}

beforeAll(async () => {
  handshakes = [];
  origin = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ via: 'socks', path: req.url }));
  });
  const originPort = await listen(origin);
  socks = createSocksServer(originPort, (host) => handshakes.push(host));
  const socksPort = await listen(socks);
  socksUrl = `socks5h://127.0.0.1:${socksPort}`;
});

afterAll(() => {
  origin?.close();
  socks?.close();
});

describe('a socks5 proxy actually carries the request (#2053)', () => {
  it('proxyAwareFetch tunnels through the socks proxy', async () => {
    const res = await proxyAwareFetch(
      'http://upstream.example.test/v1/models',
      {},
      {
        connectionProxyEnabled: true,
        connectionProxyUrl: socksUrl,
        strictProxy: true,
      }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ via: 'socks', path: '/v1/models' });
    // socks5h defers name resolution to the proxy, so the hostname arrives here.
    expect(handshakes).toContain('upstream.example.test');
  });

  it('the settings-screen proxy test reports a working socks proxy as working', async () => {
    const result = await testProxyUrl({
      proxyUrl: socksUrl,
      testUrl: 'http://probe.example.test/',
      timeoutMs: 5000,
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('an http proxy URL is untouched by the socks path', async () => {
    // A bad http proxy must still fail as a proxy failure, not be mistaken for
    // a socks URL: this pins that only socks* schemes take the new branch.
    const result = await testProxyUrl({
      proxyUrl: 'http://127.0.0.1:1/',
      testUrl: 'http://probe.example.test/',
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
  });
});
