// #2917: "Support external headroom installations, not just self-managed".
// Reporter's own words: findPython() only searches a hardcoded path list that
// doesn't cover a user-created venv (e.g. a PEP-668 workaround), forcing a
// self-install that fails on externally-managed systems. HEADROOM_BIN_PATH /
// HEADROOM_PYTHON_PATH mirror the existing HEADROOM_URL override so a user
// can point tokenproxy straight at an install it doesn't manage.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => {
    throw new Error('not found');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('candidate missing');
  }),
}));

vi.mock('child_process', () => ({
  execSync: mocks.execSync,
  execFileSync: mocks.execFileSync,
}));

const ENV_KEYS = ['HEADROOM_BIN_PATH', 'HEADROOM_PYTHON_PATH'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('external headroom install override', () => {
  it('findHeadroomBinary returns HEADROOM_BIN_PATH directly without probing PATH', async () => {
    process.env.HEADROOM_BIN_PATH = '/home/user/.local/share/headroom-venv/bin/headroom';
    vi.resetModules();
    const { findHeadroomBinary } = await import('../../src/lib/headroom/detect.js');

    expect(findHeadroomBinary()).toBe('/home/user/.local/share/headroom-venv/bin/headroom');
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it('findPython310 tries HEADROOM_PYTHON_PATH first and accepts it once version + pip show both pass', async () => {
    process.env.HEADROOM_PYTHON_PATH = '/home/user/.local/share/headroom-venv/bin/python3';
    delete process.env.HEADROOM_BIN_PATH;
    vi.resetModules();
    const { findPython310 } = await import('../../src/lib/headroom/detect.js');

    mocks.execFileSync.mockImplementation((py, args) => {
      if (py !== '/home/user/.local/share/headroom-venv/bin/python3')
        throw new Error(`unexpected candidate: ${py}`);
      if (args[0] === '--version') return Buffer.from('Python 3.12.1\n');
      if (args.join(' ') === '-m pip show headroom-ai')
        return Buffer.from('Name: headroom-ai\nVersion: 0.26.0\n');
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });

    expect(findPython310()).toBe('/home/user/.local/share/headroom-venv/bin/python3');
  });

  it('without the override, findHeadroomBinary falls back to the PATH probe unchanged', async () => {
    delete process.env.HEADROOM_BIN_PATH;
    vi.resetModules();
    const { findHeadroomBinary } = await import('../../src/lib/headroom/detect.js');

    mocks.execSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(findHeadroomBinary()).toBeNull();
    expect(mocks.execSync).toHaveBeenCalled();
  });
});
