/**
 * #974 — "Why tokenproxy unexpectedly quit randomly?", reported for a launcher
 * started as `nohup tokenproxy -t > /dev/null 2>&1 &`.
 *
 * The server process itself is well covered: custom-server.js reports and exits
 * on both crash events (#1814), keeps a client hang-up from counting as one,
 * survives a launcher that stops draining its stderr (#2447), and names an
 * otherwise silent exit. None of that is in cli/cli.js, which is the process
 * that actually stays resident in tray mode — it holds the tray, and it is the
 * only thing that restarts the server when the server dies.
 *
 * That launcher handled `uncaughtException` by logging and carrying on, and did
 * not handle `unhandledRejection` at all, so Node's default terminated it. The
 * two sibling failures had opposite outcomes: one survivable, one fatal and
 * silent, with the notice going to /dev/null. It also had the handler in the
 * wrong place — registered inside startServer(), so the boot chain that runs
 * before it (killAllAppProcesses -> killProcessOnPort -> startServer) was
 * covered by nothing at all.
 *
 * Source assertions, the same way tests/unit/server-crash-visibility-1814.test.js
 * pins the server's half: requiring cli.js runs the launcher.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../../cli/cli.js', import.meta.url), 'utf8');

// The `tokenproxy stop` subcommand opens with the same two primitives, so the boot
// chain is identified by the only thing unique to it.
const BOOT_CHAIN = 'startServer(updatePromise)';

describe('the launcher outlives a stray rejection (#974)', () => {
  it('handles both crash events, not just one of them', () => {
    expect(src).toContain('process.on("uncaughtException"');
    expect(src).toContain('process.on("unhandledRejection"');
  });

  it('the rejection handler keeps the launcher up rather than exiting', () => {
    // It supervises the server and owns the tray; taking it down for a stray
    // rejection is the outage, not the protection. This is the policy the
    // file's uncaughtException handler already chose.
    const start = src.indexOf('process.on("unhandledRejection"');
    const body = src.slice(start, src.indexOf('});', start));
    expect(body).not.toContain('process.exit');
  });

  it('is registered before the boot chain, not inside startServer', () => {
    // The pre-existing uncaughtException handler sits inside startServer(), so
    // everything upstream of it ran unguarded.
    const handler = src.indexOf('process.on("unhandledRejection"');
    expect(handler).toBeGreaterThan(-1);
    expect(handler).toBeLessThan(src.indexOf(BOOT_CHAIN));
  });

  it('says which process it is, since the report has no other output', () => {
    const start = src.indexOf('process.on("unhandledRejection"');
    const body = src.slice(start, src.indexOf('});', start));
    expect(body).toContain('tokenproxy');
  });
});

describe('a boot failure still ends the launcher (#974)', () => {
  it('the boot chain reports and exits instead of being swallowed', () => {
    // With the handler above in place, an unhandled boot rejection would leave
    // a live launcher and no server. A boot failure is terminal and says so.
    const chain = src.slice(src.indexOf(`.then(() => ${BOOT_CHAIN})`));
    const catchAt = chain.indexOf('.catch(');
    expect(catchAt).toBeGreaterThan(-1);
    expect(chain.slice(catchAt, catchAt + 300)).toContain('process.exit(1)');
  });
});
