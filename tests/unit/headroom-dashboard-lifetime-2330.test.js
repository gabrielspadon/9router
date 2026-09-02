// #2330 — "Headroom dashboard cant access token saver data": Headroom itself
// runs and compresses fine when started from the Token Saver page, but opening
// its dashboard through /api/headroom/proxy shows an error status and no data.
//
// The proxy rewrites root-relative URLs in Headroom's HTML so its own fetches
// come back through tokenproxy. That rewrite is gated on an exact-match allowlist
// (`/p`, `/p/…`, `/p.…`). `stats-lifetime` and `settings` were never in it, so
// the lifetime view's `fetch('/stats-lifetime')` and the whole settings page
// went to the tokenproxy origin instead of Headroom and 404'd.
//
// The fixtures below are the literal call sites in headroom-ai's shipped
// templates (headroom/dashboard/templates/{dashboard,settings}.html), not
// invented ones.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/localDb', () => ({
  getSettings: vi.fn(async () => ({ headroomUrl: 'http://localhost:8787' })),
}));

const { DASHBOARD_PREFIX, rewriteHeadroomHtml } =
  await import('../../src/app/api/headroom/proxy/[...path]/route.js');

// Every root-relative fetch/attribute Headroom's dashboard + settings pages issue.
const HEADROOM_CALL_SITES = [
  "fetch('/stats?cached=1')",
  "fetch('/health')",
  "fetch('/stats-history')",
  "fetch('/stats-lifetime')",
  "fetch('/transformations/feed?limit=50')",
  "fetch('/settings')",
  "fetch('/settings/apply')",
  "fetch('/settings/schema')",
  '<a href="/dashboard/settings">Settings</a>',
  '<script src="/dashboard/static/alpine.min.js"></script>',
];

const rootRelativeTargets = (html) => {
  const found = [];
  const re = /(?:fetch\(\s*|(?:src|href|action)\s*=\s*)(['"`])(\/[^'"`]*)\1/g;
  let m;
  while ((m = re.exec(html))) found.push(m[2]);
  return found;
};

describe('headroom dashboard reaches its own data through the proxy (#2330)', () => {
  it('rewrites every root-relative call the shipped dashboard/settings pages make', () => {
    const out = rewriteHeadroomHtml(HEADROOM_CALL_SITES.join('\n'), DASHBOARD_PREFIX);
    const unrewritten = rootRelativeTargets(out).filter((u) => !u.startsWith(DASHBOARD_PREFIX));
    expect(unrewritten).toEqual([]);
  });

  it('sends the lifetime savings history to Headroom, not to the tokenproxy origin', () => {
    // The regression itself: this fetch used to survive untouched and 404.
    const out = rewriteHeadroomHtml("fetch('/stats-lifetime')", DASHBOARD_PREFIX);
    expect(out).toBe(`fetch('${DASHBOARD_PREFIX}/stats-lifetime')`);
  });

  it('rewrites the settings page and its sub-paths', () => {
    const out = rewriteHeadroomHtml(
      "fetch('/settings');fetch('/settings/schema');fetch('/settings/apply')",
      DASHBOARD_PREFIX
    );
    expect(out).toBe(
      `fetch('${DASHBOARD_PREFIX}/settings');` +
        `fetch('${DASHBOARD_PREFIX}/settings/schema');` +
        `fetch('${DASHBOARD_PREFIX}/settings/apply')`
    );
  });

  it('still refuses paths outside the allowlist, and never double-prefixes', () => {
    const html = [
      "fetch('/api/providers')",
      "fetch('/v1/chat/completions')",
      '<a href="/dashboard/token-saver">tokenproxy</a>'.replace('/dashboard', '/nope'),
      `fetch('${DASHBOARD_PREFIX}/stats-lifetime')`,
    ].join('\n');
    const out = rewriteHeadroomHtml(html, DASHBOARD_PREFIX);
    expect(out).toContain("fetch('/api/providers')");
    expect(out).toContain("fetch('/v1/chat/completions')");
    expect(out).toContain('href="/nope/token-saver"');
    expect(out).not.toContain(`${DASHBOARD_PREFIX}${DASHBOARD_PREFIX}`);
  });
});
