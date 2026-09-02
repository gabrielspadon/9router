// @vitest-environment jsdom
//
// #2897 follow-up — the Pi backend shipped without its dashboard surface.
// `pi-settings` exists and `all-statuses` already reports `pi`, but CLI_TOOLS
// had no `pi` key, so the tool never appeared in the list and the detail route
// fell through to DefaultToolCard's "Coming soon...". This pins the wiring:
// the registry entry, and a detail view that resolves a real Pi card bound to
// the field names the route actually returns (`pi.models`, `pi.baseURL`).

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace() {}, push() {} }),
  usePathname: () => '/dashboard/cli-tools/pi',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));

const { CLI_TOOLS } = await import('@/shared/constants/cliTools.js');
const { default: ToolDetailClient } =
  await import('@/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js');

// Exactly what src/app/api/cli-tools/pi-settings/route.js GET returns for a
// configured install. Field names are copied from the route, not invented.
const PI_STATUS = {
  installed: true,
  config: {
    providers: {
      'tokenproxy': {
        baseUrl: 'http://localhost:20128/v1',
        api: 'openai-completions',
        apiKey: 'sk_test',
        models: [{ id: 'cc/claude-sonnet-5', input: ['text', 'image'] }],
      },
    },
  },
  hasTokenProxy: true,
  configPath: '/home/tester/.pi/agent/models.json',
  pi: { models: ['cc/claude-sonnet-5'], baseURL: 'http://localhost:20128/v1' },
};

const ROUTES = {
  '/api/providers': {
    connections: [
      {
        id: 'c1',
        provider: 'anthropic',
        name: 'CC',
        isActive: true,
        testStatus: 'active',
        defaultModel: 'claude-sonnet-5',
      },
    ],
  },
  '/api/settings': { cloudEnabled: false },
  '/api/tunnel/status': {},
  '/api/keys': { keys: [{ id: 'k1', name: 'default', key: 'sk_test' }] },
  '/api/models/alias': { aliases: {} },
  '/api/cli-tools/pi-settings': PI_STATUS,
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url).split('?')[0];
    const body = ROUTES[path] ?? {};
    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const mounted = async (element) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(element);
  });
  return host;
};

const accessibleName = (el) => {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  // Button hides a decorative icon from assistive tech, so the ligature must be
  // dropped before reading the text — otherwise "Apply" reads as "saveApply".
  const clone = el.cloneNode(true);
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  const text = clone.textContent.trim();
  // A bare Material ligature is glyph text, not a name a reader can use.
  if (text && !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(text)) return text;
  return el.getAttribute('title')?.trim() || '';
};

describe('the pi registry entry (#2897)', () => {
  it('is present, so the tool renders in the CLI tools list at all', () => {
    expect(CLI_TOOLS.pi).toBeDefined();
    expect(CLI_TOOLS.pi.id).toBe('pi');
  });

  it('carries the fields ToolSummaryCard and the detail header read', () => {
    expect(CLI_TOOLS.pi).toMatchObject({
      id: 'pi',
      name: expect.any(String),
      color: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
      description: expect.any(String),
      configType: 'custom',
    });
    // Either an image that exists on disk, or a Material icon — never a dangling src.
    expect(CLI_TOOLS.pi.image || CLI_TOOLS.pi.icon).toBeTruthy();
  });

  it('does not collide with the unrelated Oh My Pi entry', () => {
    expect(CLI_TOOLS.omp?.id).toBe('omp');
    expect(CLI_TOOLS.pi.id).not.toBe(CLI_TOOLS.omp?.id);
  });
});

describe('the pi detail view resolves a real card (#2897)', () => {
  it('does not fall through to the DefaultToolCard placeholder', async () => {
    const host = await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    expect(host.textContent).not.toContain('Coming soon...');
    expect(host.textContent).not.toContain('Tool not found or disabled.');
  });

  it('binds to pi.models from the route, not to a guessed field', async () => {
    const host = await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    expect(host.textContent).toContain('cc/claude-sonnet-5');
  });

  it('shows the configured baseUrl the route reports', async () => {
    const host = await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    expect(host.textContent).toContain('http://localhost:20128/v1');
  });

  it('offers Apply and Reset, so the card is operable and not read-only', async () => {
    const host = await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    const names = [...host.querySelectorAll('button')].map(accessibleName);
    expect(names).toContain('Apply');
    expect(names).toContain('Reset');
  });

  it('gives the icon-only model remove control an accessible name', async () => {
    const host = await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    const names = [...host.querySelectorAll('button')].map(accessibleName);
    expect(names).toContain('Remove cc/claude-sonnet-5');
    // Nothing icon-only is left nameless.
    expect(names.filter((n) => n === '')).toHaveLength(0);
  });

  it("talks to the pi-settings route rather than another tool's", async () => {
    await mounted(createElement(ToolDetailClient, { toolId: 'pi', machineId: 'm1' }));
    const called = globalThis.fetch.mock.calls.map(([u]) => String(u));
    expect(called.some((u) => u.startsWith('/api/cli-tools/pi-settings'))).toBe(true);
    expect(called.some((u) => u.includes('opencode-settings'))).toBe(false);
  });
});
