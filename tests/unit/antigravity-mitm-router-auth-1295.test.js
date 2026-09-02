import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #1295 — "There was an error with your authentication. To log in, click here"
// in the Antigravity IDE once the MITM server is on, after which chat is dead.
// The handler piped TokenProxy's own 401 straight back to the IDE, which reads it
// as its Google session being broken and offers a re-login that cannot fix it.
// Enabling this tool pins cloudcode-pa + daily-cloudcode-pa to 127.0.0.1 for the
// whole machine, so there is no native path left either: the handler has to
// forward upstream instead of failing, the same shape as the Cursor stub.

let intercept;
let routerReply = { status: 200 };
let router;

function fakeReq(url = '/v1internal/models/gemini-pro-agent:streamGenerateContent?alt=sse') {
  return { url, method: 'POST', headers: { host: 'daily-cloudcode-pa.googleapis.com' } };
}

function fakeRes() {
  return {
    headersSent: false,
    status: null,
    chunks: [],
    writeHead(status) {
      this.headersSent = true;
      this.status = status;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(chunk) {
      if (chunk) this.chunks.push(String(chunk));
      this.ended = true;
    },
  };
}

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-mitm-1295-'));
  router = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (routerReply.status === 200) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {}');
      } else {
        res.writeHead(routerReply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing API key' } }));
      }
    });
  });
  await new Promise((resolve) => router.listen(0, '127.0.0.1', resolve));
  process.env.MITM_ROUTER_BASE = `http://127.0.0.1:${router.address().port}`;
  ({ intercept } = createRequire(import.meta.url)('../../src/mitm/handlers/antigravity.js'));
});

afterAll(() => new Promise((resolve) => router.close(resolve)));

beforeEach(() => {
  routerReply = { status: 200 };
});

describe('Antigravity MITM handler never hands the IDE an auth failure (#1295)', () => {
  const body = Buffer.from(
    JSON.stringify({ model: 'gemini-pro-agent', request: { contents: [] } })
  );

  it.each([401, 403])(
    "forwards upstream when the router refuses this proxy's key (%i)",
    async (status) => {
      routerReply = { status };
      const res = fakeRes();
      const seen = [];
      await intercept(fakeReq(), res, body, 'mapped-model', (...args) => {
        seen.push(args);
      });

      expect(seen).toHaveLength(1);
      expect(seen[0][2]).toBe(body);
      // Nothing was written to the IDE, so the passthrough owns the response.
      expect(res.headersSent).toBe(false);
      expect(res.status).toBeNull();
    }
  );

  it('pipes a served response through instead of passing it through', async () => {
    const res = fakeRes();
    const seen = [];
    await intercept(fakeReq(), res, body, 'mapped-model', (...args) => {
      seen.push(args);
    });

    expect(seen).toHaveLength(0);
    expect(res.status).toBe(200);
    expect(res.chunks.join('')).toContain('data: {}');
  });

  it('forwards upstream when the request body cannot be parsed', async () => {
    const res = fakeRes();
    const seen = [];
    await intercept(fakeReq(), res, Buffer.from(' not-json'), 'mapped-model', (...a) => {
      seen.push(a);
    });

    expect(seen).toHaveLength(1);
    expect(res.headersSent).toBe(false);
  });

  it('still answers when no forwarder is supplied, rather than hanging', async () => {
    routerReply = { status: 401 };
    const res = fakeRes();
    await intercept(fakeReq(), res, body, 'mapped-model');
    expect(res.status).toBe(401);
  });

  it("relays a provider error unchanged, since only 401/403 are this proxy's own gate", async () => {
    routerReply = { status: 429 };
    const res = fakeRes();
    const seen = [];
    await intercept(fakeReq(), res, body, 'mapped-model', (...args) => {
      seen.push(args);
    });

    expect(seen).toHaveLength(0);
    expect(res.status).toBe(429);
  });
});
