import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const managerPath = fileURLToPath(new URL('../../src/mitm/manager.js', import.meta.url));
const dnsConfigPath = fileURLToPath(new URL('../../src/mitm/dns/dnsConfig.js', import.meta.url));

// stopServer() killed the listener and only then stripped the /etc/hosts entries
// that point every intercepted tool at 127.0.0.1, so for the whole cleanup window
// — and forever, if the cleanup needed rights it did not get — those tools failed
// with "connect ECONNREFUSED 127.0.0.1:443". That is why the reported workaround
// was to press Stop DNS by hand before Stop Server (#1809).
//
// manager.js is CommonJS and reaches the filesystem and child_process at module
// scope, so it is exercised in a child process with its dnsConfig dependency
// injected into require.cache, the same shape the other MITM tests here use.
function runStop({ removalSucceeds = true, writePidFile = true } = {}) {
  // The child used to mkdtemp its own DATA_DIR and never remove it, so every
  // call left a tokenproxy-mitm-stop-* tree behind holding logs/ and mitm/.
  // Six calls per run, and /tmp here has no age-based reaper, so they
  // accumulated indefinitely. The parent owns the directory now and removes it
  // in `finally`, which also covers the spawn throwing before the child runs.
  const root = mkdtempSync(join(tmpdir(), 'tokenproxy-mitm-stop-'));
  try {
    const script = `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const out = process.stdout.write.bind(process.stdout);

    const root = ${JSON.stringify(root)};
    process.env.DATA_DIR = root;

    const events = [];
    const removalSucceeds = ${JSON.stringify(removalSucceeds)};
    const TOOL_HOSTS = { kiro: ["codewhisperer.example.invalid"] };

    const dnsPath = require.resolve(${JSON.stringify(dnsConfigPath)});
    require.cache[dnsPath] = {
      id: dnsPath, filename: dnsPath, loaded: true,
      exports: {
        TOOL_HOSTS,
        addDNSEntry: async () => {},
        removeDNSEntry: async () => {},
        removeAllDNSEntries: async () => { events.push("dns-removed"); },
        removeAllDNSEntriesSync: () => {},
        // Mirrors the real all-or-nothing per-tool report: true while every host
        // for that tool is still redirected.
        checkAllDNSStatus: () => ({ kiro: !removalSucceeds }),
        isSudoAvailable: () => false,
        isSudoPasswordRequired: () => false,
        execWithPassword: async () => {},
      },
    };

    const childProcess = require("child_process");
    childProcess.exec = (command, options, callback) => {
      if (/kill/.test(command)) events.push("server-killed");
      if (typeof callback === "function") callback(null, "", "");
      if (typeof options === "function") options(null, "", "");
    };
    childProcess.execSync = () => "";

    console.log = () => {};
    console.error = () => {};

    const manager = require(${JSON.stringify(managerPath)});
    const mitmDir = path.join(root, "mitm");
    fs.mkdirSync(mitmDir, { recursive: true });
    // A pid that is certainly alive, so the kill branch actually runs.
    if (${JSON.stringify(writePidFile)}) {
      fs.writeFileSync(path.join(mitmDir, ".mitm.pid"), String(process.pid), "utf8");
    }

    manager.stopServer()
      .then(() => out(JSON.stringify({ events, threw: null })))
      .catch((e) => out(JSON.stringify({ events, threw: e.message })));
  `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('stopServer removes the DNS redirect before it kills the listener (#1809)', () => {
  it('the hosts entries go first, so nothing points at a dead port', () => {
    const { events } = runStop();
    expect(events).toContain('dns-removed');
    expect(events).toContain('server-killed');
    expect(events.indexOf('dns-removed')).toBeLessThan(events.indexOf('server-killed'));
  });

  it('cleanup is not conditional on there being a process to kill', () => {
    // A stale or missing pid file must not skip the part that un-breaks DNS.
    const { events } = runStop({ writePidFile: false });
    expect(events).toEqual(['dns-removed']);
  });

  it("the docstring's promised order is what the code now does", () => {
    const { events } = runStop();
    expect(events[0]).toBe('dns-removed');
  });
});

describe('a cleanup that could not remove the entries leaves the server up (#1809)', () => {
  it('refuses to kill the listener while a tool is still redirected to loopback', () => {
    const { events, threw } = runStop({ removalSucceeds: false });
    expect(events).not.toContain('server-killed');
    expect(threw).toMatch(/kiro/);
  });

  it('the failure names the tool and says the server was left running', () => {
    const { threw } = runStop({ removalSucceeds: false });
    // The permanent form of the report is unrecoverable from inside the app, so
    // the operator has to be told what to retry and with what rights.
    expect(threw).toMatch(/administrator|sudo/i);
    expect(threw).toMatch(/left running/i);
  });
});
