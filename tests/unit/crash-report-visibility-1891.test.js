import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverPath = fileURLToPath(new URL('../../custom-server.js', import.meta.url));

/**
 * A backlog large enough to put custom-server.js's console guard into its DROP
 * state (its limit is 1MB) and to leave fd 2 congested. This is the condition
 * both reports were filed under: the CLI and the tray pipe the server's stderr,
 * and a launcher that reads it slowly is all it takes.
 *
 * `process.stderr.write` queues synchronously, so anything reported on the very
 * next line sees the full backlog regardless of how fast the reader is. That is
 * what makes these cases deterministic rather than timing-dependent.
 */
const BACKLOG = "process.stderr.write('x'.repeat(2 * 1024 * 1024));";

/** Run a snippet in a child that has loaded the real custom-server.js. */
function runChild(source) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-e', `require(${JSON.stringify(serverPath)});\n${source}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    // Drop the backlog itself; holding megabytes of filler would only measure
    // this test's own memory use. Long runs only -- a bare /x+/ would also eat
    // the x in "exception", which is one of the strings being asserted on.
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk).replace(/x{64,}/g, '');
    });

    let code = null;
    child.on('exit', (exitCode) => {
      code = exitCode;
    });
    // 'close' rather than 'exit': the pipe still holds bytes after the process
    // is gone, and those bytes are the whole point of the test.
    child.on('close', () => resolve({ stdout, stderr, code }));
  });
}

describe('a crash says what happened even when stderr is congested (#1891, #1814)', () => {
  it('console.error loses the message here, which is the bug being fixed', async () => {
    // The control, and the reason the handlers may not use console.error: the
    // backpressure guard drops it, and Node discards a queued stdio write when
    // the process exits before it drains (asynchronous for a Windows TTY and
    // for a POSIX pipe). Either way the operator gets an exit code and nothing
    // else, which is exactly what both reports describe.
    const { stderr } = await runChild(`${BACKLOG}\nconsole.error('this-line-never-arrives');`);

    expect(stderr).not.toContain('this-line-never-arrives');
  }, 20000);

  it('names an uncaught exception', async () => {
    const { stderr, code } = await runChild(`${BACKLOG}\nthrow new Error('boom-from-the-test');`);

    expect(code).toBe(1);
    expect(stderr).toContain('Uncaught exception in the server process');
    expect(stderr).toContain('boom-from-the-test');
    expect(stderr).toMatch(/pid \d+/);
  }, 20000);

  it('names an unhandled rejection', async () => {
    const { stderr, code } = await runChild(
      `${BACKLOG}\nPromise.reject(new Error('rejected-from-the-test'));`
    );

    expect(code).toBe(1);
    expect(stderr).toContain('Unhandled promise rejection in the server process');
    expect(stderr).toContain('rejected-from-the-test');
  }, 20000);

  it('reports a non-zero exit that nothing else accounted for', async () => {
    // Next's standalone entry answers a failed listen with console.error() and
    // an immediate process.exit(1), which loses its message the same way. The
    // handlers above never see it, so without this hook a port conflict is a
    // dead gateway and an empty log.
    const { stderr, code } = await runChild(`${BACKLOG}\nprocess.exit(3);`);

    expect(code).toBe(3);
    expect(stderr).toContain('is exiting with code 3');
  }, 20000);

  it('stays quiet on a clean exit', async () => {
    const { stderr, code } = await runChild('process.exit(0);');

    expect(code).toBe(0);
    expect(stderr).not.toContain('is exiting with code');
  }, 20000);

  it('does not report the exit twice when a crash already named it', async () => {
    const { stderr } = await runChild("throw new Error('reported-once');");

    expect(stderr).toContain('Uncaught exception in the server process');
    expect(stderr).not.toContain('is exiting with code 1');
  }, 20000);
});

describe('one client hanging up does not take the gateway down (#1814)', () => {
  // Claude Code aborts the in-flight stream when it stops to ask the user to
  // approve a command. On the server that arrives as an unhandled 'error' on
  // the socket or the response, which is an uncaught EXCEPTION rather than a
  // rejection -- and the rejection path already ignored it while the exception
  // path exited, so one client walking away ended every other client's request.
  for (const disconnectCode of [
    'ECONNRESET',
    'ECONNABORTED',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE',
  ]) {
    it(`survives an uncaught ${disconnectCode}`, async () => {
      const { stdout, code } = await runChild(`
        setTimeout(() => {
          const error = new Error('socket hang up');
          error.code = ${JSON.stringify(disconnectCode)};
          throw error;
        }, 10);
        setTimeout(() => { console.log('STILL-SERVING'); process.exit(0); }, 200);
      `);

      expect(code).toBe(0);
      expect(stdout).toContain('STILL-SERVING');
    }, 20000);
  }

  it('survives an uncaught "aborted", which is how Node words the same event', async () => {
    const { stdout, code } = await runChild(`
      setTimeout(() => { throw new Error('aborted'); }, 10);
      setTimeout(() => { console.log('STILL-SERVING'); process.exit(0); }, 200);
    `);

    expect(code).toBe(0);
    expect(stdout).toContain('STILL-SERVING');
  }, 20000);

  it('still dies on a real fault, so nothing is being swallowed wholesale', async () => {
    const { stderr, code } = await runChild(`
      setTimeout(() => {
        const error = new Error('genuinely broken');
        error.code = 'ERR_INVALID_STATE';
        throw error;
      }, 10);
      setTimeout(() => { console.log('STILL-SERVING'); process.exit(0); }, 200);
    `);

    expect(code).toBe(1);
    expect(stderr).toContain('genuinely broken');
  }, 20000);
});
