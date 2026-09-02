import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Issues #2866 and #1481, both reporting the desktop sidebar as absent, the
// second with a console workaround that force-sets `display:flex` on
// `div.hidden.lg\:flex` above 1024px. That workaround only helps when the
// `lg:flex` utility is missing from the served stylesheet, leaving the bare
// `hidden` to win — a content-scanning failure, not a layout choice.
//
// It is not the state of this tree: the rail markup still carries the pair, and
// a real Tailwind compile of globals.css emits `.lg\:flex` inside the `lg`
// media query and after `.hidden`, so cascade order already resolves to flex on
// a desktop viewport. These assert both halves so a change to the `source()`
// base, the breakpoint scale, or the utility order fails here rather than
// silently reproducing the report.

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

describe('desktop sidebar is not hidden by a missing lg:flex (#2866, #1481)', () => {
  it('the rail wrapper is still the hidden/lg:flex pair the reports name', () => {
    const layout = readFileSync(
      resolve(ROOT, 'src/shared/components/layouts/DashboardLayout.js'),
      'utf8'
    );
    expect(layout).toContain('className="hidden lg:flex"');
  });

  it('compiled CSS emits .lg:flex in the lg media query, after .hidden', async () => {
    const css = readFileSync(resolve(ROOT, 'src/app/globals.css'), 'utf8');
    const { css: out } = await postcss([tailwind({ base: ROOT })]).process(css, {
      from: resolve(ROOT, 'src/app/globals.css'),
    });

    const hiddenAt = out.search(/^\s*\.hidden\s*\{/m);
    const flexAt = out.search(/^\s*\.lg\\:flex\s*\{/m);

    expect(hiddenAt).toBeGreaterThan(-1);
    expect(flexAt).toBeGreaterThan(-1);
    // Same layer, so the later rule wins: `hidden` must come first.
    expect(flexAt).toBeGreaterThan(hiddenAt);

    // And it has to sit under the lg breakpoint, not at every width.
    const enclosing = out.slice(0, flexAt).lastIndexOf('@media');
    expect(out.slice(enclosing, enclosing + 60)).toMatch(/64rem|1024px/);
  }, 60000);
});
