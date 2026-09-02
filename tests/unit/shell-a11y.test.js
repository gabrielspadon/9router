// Shell accessibility contract (leaf A2).
//
// Everything here is asserted from the rendered markup as roles, accessible
// names and document structure. No Tailwind class name is asserted: the class
// list is an implementation detail and a test that reads it fails on a rename
// while passing on a real regression.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentPathname = '/dashboard/statistics';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));

// zustand feeds react-dom/server the store's INITIAL state, so mutating the
// real store cannot make the search field render. Stand in for it instead.
const { headerSearch } = vi.hoisted(() => ({
  headerSearch: { query: '', placeholder: '', visible: false, setQuery: () => {} },
}));

vi.mock('@/store/headerSearchStore', () => ({
  useHeaderSearchStore: (selector) => selector(headerSearch),
}));

vi.mock('@/i18n/runtime', () => ({
  translate: (value) => value,
  reloadTranslations: async () => {},
  onLocaleChange: () => () => {},
}));

const { APP_CONFIG } = await import('@/shared/constants/config.js');
const { default: DashboardLayout } = await import('@/shared/components/layouts/DashboardLayout.js');
const { default: Sidebar } = await import('@/shared/components/Sidebar.js');
const { default: Header } = await import('@/shared/components/Header.js');
const { default: HeaderLanguage } = await import('@/shared/components/HeaderLanguage.js');
const { default: Card } = await import('@/shared/components/Card.js');
const { LOCALE_NAMES } = await import('@/i18n/config.js');

// --- structural helpers ------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };

const text = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ')
    .trim();

function headings(html) {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: text(m[2]),
  }));
}

function openTags(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Elements that take focus by default, in document order. */
function focusables(html) {
  return [...html.matchAll(/<(a|button|input|select|textarea)\b[^>]*>/g)].map((m) => ({
    tag: m[1],
    html: m[0],
  }));
}

function renderShell(pathname = '/dashboard/statistics') {
  currentPathname = pathname;
  return renderToStaticMarkup(
    createElement(DashboardLayout, null, createElement('p', null, 'content'))
  );
}

beforeEach(() => {
  currentPathname = '/dashboard/statistics';
});

// --- A2-1 one H1, naming the route -------------------------------------

describe('A2-1 the route owns the only H1', () => {
  it('renders exactly one H1 and it is the route name, not the product name', () => {
    const h = headings(renderShell('/dashboard/statistics'));
    const h1s = h.filter((x) => x.level === 1);
    expect(h1s).toHaveLength(1);
    expect(h1s[0].text).toBe('Statistics');
  });

  it('never promotes the product name to a heading', () => {
    const html = renderShell('/dashboard/statistics');
    // Read the name from config rather than a literal, so a rebrand moves this
    // assertion with the product instead of silently asserting a dead string.
    expect(html).toContain(APP_CONFIG.name);
    expect(headings(html).some((x) => x.text.includes(APP_CONFIG.name))).toBe(false);
  });

  it('names every route the rail can reach', () => {
    const routes = [
      ['/dashboard/providers', 'Providers'],
      ['/dashboard/combos', 'Combos'],
      ['/dashboard/memory', 'Memory & Context'],
      ['/dashboard/claude-compat', 'Claude Compat'],
      ['/dashboard/endpoint', 'Endpoint'],
      ['/dashboard/cli-tools', 'CLI Tools'],
      ['/dashboard/usage', 'Usage & Analytics'],
      ['/dashboard/statistics', 'Statistics'],
      ['/dashboard/quota', 'Quota Tracker'],
      ['/dashboard/token-saver', 'Token Saver'],
      ['/dashboard/proxy-pools', 'Proxy Pools'],
      ['/dashboard/skills', 'Agent Skills'],
      ['/dashboard/model-context', 'Model Context'],
      ['/dashboard/profile', 'Settings'],
    ];
    for (const [pathname, title] of routes) {
      currentPathname = pathname;
      const h1s = headings(renderToStaticMarkup(createElement(Header, {}))).filter(
        (x) => x.level === 1
      );
      expect(
        h1s.map((x) => x.text),
        pathname
      ).toEqual([title]);
    }
  });
});

// --- A2-2 contiguous outline -------------------------------------------

describe('A2-2 the heading outline skips no level', () => {
  it('starts at 1 and never jumps more than one level', () => {
    const levels = headings(renderShell()).map((x) => x.level);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('puts a card title one level under the route heading', () => {
    // Card is how every dashboard page titles a section. At h3 under an h1 it
    // is the skipped level the shell can never fix from its own side.
    const html = renderToStaticMarkup(createElement(Card, { title: 'Request Details' }));
    expect(headings(html)).toEqual([{ level: 2, text: 'Request Details' }]);
  });
});

// --- A2-3 skip link ----------------------------------------------------

describe('A2-3 skip link', () => {
  it('is the first focusable element and targets the main landmark', () => {
    const html = renderShell();
    const first = focusables(html)[0];
    expect(first.tag).toBe('a');
    expect(attr(first.html, 'href')).toBe('#main');
  });

  it('carries an accessible name', () => {
    const html = renderShell();
    const link = html.match(/<a\b[^>]*href="#main"[^>]*>([\s\S]*?)<\/a>/);
    expect(link).not.toBeNull();
    expect(text(link[1]).length).toBeGreaterThan(0);
  });

  it('points at an element that exists', () => {
    const html = renderShell();
    expect(openTags(html, 'main').some((t) => attr(t, 'id') === 'main')).toBe(true);
  });
});

// --- A2-4 landmarks ----------------------------------------------------

describe('A2-4 landmarks', () => {
  it('exposes a banner: the header is not nested inside main', () => {
    const html = renderShell();
    expect(openTags(html, 'header')).toHaveLength(1);
    expect(html.indexOf('<header')).toBeGreaterThan(-1);
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
  });

  it('exposes a contentinfo: a footer outside main', () => {
    const html = renderShell();
    expect(openTags(html, 'footer')).toHaveLength(1);
    expect(html.indexOf('<footer')).toBeGreaterThan(html.indexOf('</main>'));
  });

  it('gives every nav landmark a distinct accessible name', () => {
    const names = openTags(renderShell(), 'nav').map((t) => attr(t, 'aria-label'));
    expect(names.every((n) => n && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('does not stack a second complementary landmark around the rail', () => {
    expect(openTags(renderToStaticMarkup(createElement(Sidebar, {})), 'aside')).toHaveLength(0);
  });

  it('keeps the off-canvas rail out of the tree while it is closed', () => {
    const html = renderShell();
    expect(html).toMatch(/<div[^>]*\binert\b/);
  });

  it('names the search field', () => {
    // The field only renders once a page registers it, so register it here or
    // the assertion below has nothing to look at and passes vacuously.
    headerSearch.visible = true;
    headerSearch.placeholder = 'Search providers';
    try {
      const inputs = focusables(renderToStaticMarkup(createElement(Header, {}))).filter(
        (el) => el.tag === 'input'
      );
      expect(inputs).toHaveLength(1);
      expect(attr(inputs[0].html, 'aria-label')).toBe('Search providers');
    } finally {
      headerSearch.visible = false;
      headerSearch.placeholder = '';
    }
  });
});

// --- A2-6 language by name ---------------------------------------------

const FLAG = /\p{Regional_Indicator}/u;

describe('A2-6 language is chosen by language, not by country', () => {
  it('labels the header control with the endonym and no flag', () => {
    const html = renderToStaticMarkup(createElement(HeaderLanguage, {}));
    expect(text(html)).toContain(LOCALE_NAMES.en);
    expect(FLAG.test(html)).toBe(false);
  });

  it('gives the control an accessible name that contains its visible label', () => {
    const html = renderToStaticMarkup(createElement(HeaderLanguage, {}));
    const button = html.match(/<button\b[^>]*>/);
    const name = attr(button[0], 'aria-label');
    expect(name).toBeTruthy();
    expect(name).toContain(LOCALE_NAMES.en);
  });
});

// --- accessible names on every shell control ---------------------------

describe('every shell control has an accessible name', () => {
  it('leaves no button unnamed', () => {
    const html = renderShell();
    for (const el of focusables(html)) {
      if (el.tag !== 'button') continue;
      const named =
        attr(el.html, 'aria-label') || attr(el.html, 'aria-labelledby') || attr(el.html, 'title');
      const body = html.slice(html.indexOf(el.html)).match(/^<button\b[^>]*>([\s\S]*?)<\/button>/);
      expect(Boolean(named) || text(body?.[1] ?? '').length > 0).toBe(true);
    }
  });
});
