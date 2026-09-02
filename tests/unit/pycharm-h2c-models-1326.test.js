// Isolate any DB the server wrapper's boot side effects reach. Set before the
// require below, because src/lib/db/paths.js reads DATA_DIR at import time and
// the default is the operator's live ~/.tokenproxy.
process.env.DATA_DIR =
  process.env.DATA_DIR || `${(await import('node:os')).tmpdir()}/tokenproxy-test-1326`;

/**
 * #1326 — PyCharm reports `GET http://localhost:20128/v1/models` failing with
 * "HTTP/1.1 header parser received no bytes".
 *
 * Zero bytes after a successful TCP connect is not a routing failure; it is
 * Node destroying a socket. JetBrains Runtime 25+ opens OpenAI-compatible
 * requests with `Connection: Upgrade, HTTP2-Settings` + `Upgrade: h2c`, and an
 * http.Server with no 'upgrade' listener answers that by destroying the socket
 * without writing a byte — exactly the message Ktor prints.
 *
 * custom-server.js already intercepts that upgrade and replays the request over
 * HTTP/1.1, so the report is already served here. The committed coverage
 * (tests/unit/custom-server-h2c.test.cjs) only exercises a POST carrying a
 * Content-Length, and the reported request is a GET with no body at all — a
 * different branch of the buffering, since it must serve immediately rather
 * than wait for bytes that never arrive. This pins the reported shape.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

let server;
let port;
const originalCreateServer = http.createServer;

// One raw HTTP/1.1 exchange, returning every byte the server wrote before it
// closed. An empty string is the failure the report describes.
function speak(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(request.join('\r\n'));
    });
    socket.setTimeout(4000, () => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

beforeAll(async () => {
  // Installs the createServer wrapper this file is about.
  require('../../custom-server.js');

  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5.1', url: req.url }] }));
  });
  // What an unwrapped server does with the upgrade, and the whole bug: no bytes.
  server.on('upgrade', (_req, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  http.createServer = originalCreateServer;
});

describe('#1326 a JetBrains h2c GET /v1/models is answered, not dropped', () => {
  it('replays the bodyless upgrade over HTTP/1.1 instead of writing zero bytes', async () => {
    const response = await speak([
      'GET /v1/models HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade, HTTP2-Settings',
      'Upgrade: h2c',
      'HTTP2-Settings: AAEAAEAAAAIAAAAAAAMAAAAAAAQBAAAAAAUAAEAAAAYABgAA',
      'Accept: application/json',
      '',
      '',
    ]);

    expect(response).not.toBe('');
    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(response).toMatch(/\r\nConnection: close\r\n/i);
    expect(response).toContain('"gpt-5.1"');
    // The replayed request keeps its path, so the upgrade does not silently
    // become a request for something else.
    expect(response).toContain('"/v1/models"');
  });

  it('still answers the same GET without the upgrade header', async () => {
    const response = await speak([
      'GET /v1/models HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: close',
      '',
      '',
    ]);

    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    expect(response).toContain('"gpt-5.1"');
  });

  it("leaves a non-h2c upgrade to the application's own listener", async () => {
    // websocket upgrades must keep reaching server.on('upgrade'); the wrapper
    // claims h2c only. The stub listener above destroys the socket, so no bytes
    // here is the correct outcome rather than the bug.
    const response = await speak([
      'GET /ws HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ]);

    expect(response).toBe('');
  });
});
