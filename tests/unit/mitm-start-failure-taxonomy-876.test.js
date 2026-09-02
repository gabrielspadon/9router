// #876 / #1069 / #1256 — "MITM server failed to start" was one sentence for
// three unrelated failures: another process holding the port, a bind we lack the
// privilege for, and a child that never loaded its own modules. Each has a
// different fix, so each has to arrive as a different sentence.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-mitm-taxonomy-'));
process.env.DATA_DIR = TEST_DATA_DIR;

async function loadManager(env = {}) {
  vi.resetModules();
  const restore = [];
  for (const [k, v] of Object.entries(env)) {
    restore.push([k, process.env[k]]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const mod = await import('@/mitm/manager.js');
    return mod.default ?? mod;
  } finally {
    for (const [k, v] of restore) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let mitm;
beforeAll(async () => {
  mitm = await loadManager({ MITM_PORT: undefined });
});

afterEach(() => {
  delete process.env.MITM_PORT;
});

describe('bind errno classification', () => {
  it('separates a held port from a privilege failure', () => {
    expect(mitm.classifyBindError('EADDRINUSE')).toBe('in-use');
    expect(mitm.classifyBindError('EACCES')).toBe('no-permission');
    // Windows reports an HTTP.sys reservation as EPERM/EACCES, not EADDRINUSE.
    expect(mitm.classifyBindError('EPERM')).toBe('no-permission');
  });

  it('does not silently fold an unknown errno into either of them', () => {
    expect(mitm.classifyBindError('EADDRNOTAVAIL')).toBe('error');
    expect(mitm.classifyBindError(undefined)).toBe('error');
  });

  it('names the port and the errno in the privilege message', () => {
    const msg = mitm.describeNoPermission('EACCES', 443);
    expect(msg).toContain('443');
    expect(msg).toContain('EACCES');
  });
});

describe('start-failure summary', () => {
  const summarize = (over) => mitm.summarizeStartFailure({ port: 443, ...over });

  it('reports a child that could not load its modules as a packaging problem', () => {
    const msg = summarize({
      stderrTail:
        "Error: Cannot find module '../../shared/constants/mitmToolHosts.js'\n    at Function._resolveFilename\n    at Module.require",
    });
    expect(msg).toMatch(/could not load its own modules/i);
    // The line naming the cause survives even though it is not the last chunk.
    expect(msg).toContain('mitmToolHosts.js');
    expect(msg).not.toMatch(/sudo password/i);
  });

  it('reports a losing race for the port as a port problem, naming the holder', () => {
    const msg = summarize({ stderrTail: 'Port 443 already in use', ownerName: 'nginx' });
    expect(msg).toContain('nginx');
    expect(msg).toMatch(/443/);
    expect(msg).not.toMatch(/could not load its own modules/i);
  });

  it('reports a privilege failure with the remedies that actually apply', () => {
    const msg = summarize({ stderrTail: 'Permission denied for port 443' });
    expect(msg).toMatch(/not allowed to bind/i);
    expect(msg).toMatch(/CAP_NET_BIND_SERVICE|root|Administrator/);
  });

  it('reports a rejected sudo password as exactly that', () => {
    const msg = summarize({ stderrTail: 'sudo: 3 incorrect password attempts' });
    expect(msg).toMatch(/sudo password was rejected/i);
  });

  it('does not blame the sudo password or the port when the child said nothing', () => {
    const msg = summarize({ stderrTail: '', timeoutMs: 8000 });
    expect(msg).toMatch(/never answered/i);
    expect(msg).toContain('8s');
    expect(msg).not.toMatch(/sudo password was rejected/i);
  });

  it('gives every cause a distinct sentence', () => {
    const messages = [
      summarize({ stderrTail: "Cannot find module './logger'" }),
      summarize({ stderrTail: 'EADDRINUSE' }),
      summarize({ stderrTail: 'EACCES' }),
      summarize({ stderrTail: 'incorrect password' }),
      summarize({ stderrTail: '' }),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('MITM_PORT override', () => {
  it('defaults to 443', async () => {
    const m = await loadManager({ MITM_PORT: undefined });
    expect(m.MITM_PORT).toBe(443);
  });

  it('moves the interception port so a co-resident server can keep 443 (#1069)', async () => {
    const m = await loadManager({ MITM_PORT: '8443' });
    expect(m.MITM_PORT).toBe(8443);
  });

  it('falls back to 443 rather than binding nonsense', async () => {
    for (const bad of ['', 'not-a-port', '0', '70000', '-1']) {
      const m = await loadManager({ MITM_PORT: bad });
      expect(m.MITM_PORT).toBe(443);
    }
  });
});
