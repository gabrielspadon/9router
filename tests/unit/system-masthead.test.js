// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemState = vi.hoisted(() => ({
  data: {
    freshness: { state: 'live', ageSeconds: 5 },
    window: { kind: 'rolling', seconds: 3600 },
    measures: {
      throughput: { value: 1.2, unit: 'requests_per_second', sampleCount: 8, window: { kind: 'rolling' } },
      latencyP95: { value: 210, unit: 'milliseconds', sampleCount: 8, window: { kind: 'rolling' } },
      errorRate: { value: 0.01, unit: 'ratio', sampleCount: 8, window: { kind: 'rolling' } },
      failoverCount: { value: null, unit: 'count', source: null, unavailable: 'not persisted' },
      spend: { value: 0.42, unit: 'usd', sampleCount: 8, window: { kind: 'rolling' } },
      connectedUpstreams: { value: 2, unit: 'count', window: { kind: 'instant' } },
      degradedUpstreams: { value: 1, unit: 'count', window: { kind: 'instant' } },
    },
    providerHealth: {
      status: 'degraded',
      source: 'providerConnections',
      observedAt: '2026-08-31T00:00:00.000Z',
      unavailable: null,
      degradedProviders: [
        { provider: 'claude', degradedConnections: 1, likelyCauses: ['authentication'] },
      ],
    },
  },
  error: null,
  phase: 'ready',
  fetchedAt: Date.now(),
  refresh: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/providers' }));
vi.mock('@/app/(dashboard)/dashboard/home/useSystemState.js', () => ({
  useSystemState: () => systemState,
}));
vi.mock('@/shared/components/layouts/Sidebar.js', () => ({ default: () => null }));
vi.mock('@/shared/components/Header.js', () => ({ default: () => null }));
vi.mock('@/store/notificationStore.js', () => ({
  useNotificationStore: () => [],
}));

const { default: SystemMasthead } =
  await import('@/app/(dashboard)/dashboard/home/SystemMasthead.js');
const { default: DashboardLayout } =
  await import('@/shared/components/layouts/DashboardLayout.js');

describe('SystemMasthead', () => {
  beforeEach(() => {
    systemState.error = null;
    systemState.phase = 'ready';
    systemState.refresh.mockClear();
  });

  it('names the degraded Provider, safe likely cause, and direct recovery action', () => {
    const html = renderToStaticMarkup(createElement(SystemMasthead));

    expect(html).toContain('claude');
    expect(html).toContain('authentication');
    expect(html).toContain('Review Provider');
    expect(html).toContain('href="/dashboard/providers/claude"');
    expect(html).not.toContain('connectionId');
  });

  it('is persistent in the dashboard shell, not limited to the home route', () => {
    const html = renderToStaticMarkup(
      createElement(DashboardLayout, null, createElement('p', null, 'Route content')),
    );

    expect(html).toContain('Router state');
    expect(html).toContain('Route content');
  });

  it('keeps the system-state heading words separate in the accessibility name', () => {
    const html = renderToStaticMarkup(createElement(SystemMasthead));

    expect(html).toMatch(/Router state<span[^>]*> last 60 min<\/span>/);
  });

  it('marks cached data stale after refresh failure and exposes recovery', () => {
    systemState.error = 'system state responded 503';
    systemState.phase = 'failed';

    const html = renderToStaticMarkup(createElement(SystemMasthead));

    expect(html).toContain('stale, 5s');
    expect(html).toContain('refresh failed; retrying');
    expect(html).toContain('Retry now');
    expect(html).toContain('system state responded 503');
  });
});
