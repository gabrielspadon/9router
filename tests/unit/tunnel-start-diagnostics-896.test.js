// #896 / #1352 — a tunnel that will not come up told the user nothing usable.
// `tailscale up` had its stdout and stderr collected and then discarded, and the
// cloudflared path assumed it could always download a binary from github.com,
// which is exactly what a container cannot do.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DATA_DIR =
  process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-tunnel-diag-'));

let describeLoginFailure;
let ensureCloudflared;

beforeAll(async () => {
  ({ describeLoginFailure } = await import('@/lib/tunnel/tailscale/tailscale.js'));
  ({ ensureCloudflared } = await import('@/lib/tunnel/cloudflare/cloudflared.js'));
});

describe('tailscale login failure (#896)', () => {
  it('names an unreachable daemon rather than reporting a bare timeout', () => {
    const msg = describeLoginFailure(
      "failed to connect to local tailscaled; it doesn't appear to be running"
    );
    expect(msg).toMatch(/daemon is not reachable/i);
    expect(msg).toContain('tailscale said:');
  });

  it('names a socket permission failure and what to do about it', () => {
    const msg = describeLoginFailure('tailscaled: permission denied opening /var/run/tailscale');
    expect(msg).toMatch(/permission denied/i);
    expect(msg).toMatch(/sudo|system-wide/i);
  });

  it('names a rejected auth key', () => {
    const msg = describeLoginFailure('invalid key: authkey expired');
    expect(msg).toMatch(/TAILSCALE_AUTHKEY was rejected/i);
  });

  it('says the daemon printed nothing, instead of implying it refused', () => {
    const msg = describeLoginFailure('');
    expect(msg).toMatch(/printed nothing/i);
    expect(msg).not.toMatch(/rejected|permission denied/i);
  });

  it('still carries the output it could not classify', () => {
    const msg = describeLoginFailure('something nobody has a rule for yet');
    expect(msg).toContain('something nobody has a rule for yet');
  });

  it('gives every cause a distinct sentence', () => {
    const messages = [
      describeLoginFailure('failed to connect to local tailscaled'),
      describeLoginFailure('permission denied'),
      describeLoginFailure('invalid key'),
      describeLoginFailure('some other thing'),
      describeLoginFailure(''),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

// A cloudflared-shaped file: big enough to pass the truncation check, with this
// platform's executable magic. Never executed — only resolved.
function writeFakeCloudflared(dir) {
  const magic =
    {
      win32: Buffer.from([0x4d, 0x5a]),
      darwin: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    }[process.platform] || Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
  const file = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  fs.writeFileSync(file, Buffer.concat([magic, Buffer.alloc(2 * 1024 * 1024)]));
  fs.chmodSync(file, 0o755);
  return file;
}

describe('cloudflared resolution in a container (#1352)', () => {
  afterEach(() => {
    delete process.env.CLOUDFLARED_BIN;
  });

  it('uses an operator-supplied binary instead of downloading one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-cf-bin-'));
    const bin = writeFakeCloudflared(dir);
    process.env.CLOUDFLARED_BIN = bin;
    await expect(ensureCloudflared()).resolves.toBe(bin);
  });

  it('says CLOUDFLARED_BIN is unusable rather than failing later at spawn', async () => {
    process.env.CLOUDFLARED_BIN = path.join(os.tmpdir(), 'definitely-not-cloudflared');
    await expect(ensureCloudflared()).rejects.toThrow(/CLOUDFLARED_BIN is set to/);
  });

  it('rejects a truncated or HTML-substituted binary as unusable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-cf-html-'));
    const bogus = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    fs.writeFileSync(bogus, '<html><body>captive portal</body></html>');
    process.env.CLOUDFLARED_BIN = bogus;
    await expect(ensureCloudflared()).rejects.toThrow(/not a usable cloudflared binary/);
  });
});
