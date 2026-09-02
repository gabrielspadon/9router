// /callback terminal state (leaf S1-4).
//
// The OAuth callback page has three outcomes: the provider denied the request,
// the provider returned a credential, or the URL carries neither and the user
// must copy it by hand. A denial used to render the success tick and the words
// "Authorization Successful!", which tells the operator the account is
// connected when it is not.
//
// Assertions are on the outcome and on the rendered text an operator reads.
// No class name is asserted.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}));

const { default: CallbackPage, callbackOutcome } = await import('@/app/callback/page.js');

function renderWith(query) {
  currentParams = new URLSearchParams(query);
  return renderToStaticMarkup(createElement(CallbackPage));
}

describe('callbackOutcome', () => {
  it('reports a provider denial as an error', () => {
    expect(callbackOutcome({ error: 'access_denied' })).toBe('error');
    // An error wins even when the provider also echoes a code back.
    expect(callbackOutcome({ error: 'access_denied', code: 'abc' })).toBe('error');
  });

  it('reports a returned credential as success', () => {
    expect(callbackOutcome({ code: 'abc' })).toBe('success');
    expect(callbackOutcome({ token: 'eyJ' })).toBe('success');
  });

  it('falls back to manual copy when the URL carries nothing usable', () => {
    expect(callbackOutcome({})).toBe('manual');
  });
});

describe('/callback rendering', () => {
  it('shows a denial as a failure, never as success', () => {
    const html = renderWith('error=access_denied&error_description=User+denied+the+request');

    expect(html).toContain('Authorization Failed');
    expect(html).toContain('User denied the request');
    expect(html).toContain('access_denied');
    expect(html).not.toContain('Authorization Successful');
    // The failure is announced, not just coloured.
    expect(html).toContain('role="alert"');
  });

  it('names the error code when the provider sends no description', () => {
    const html = renderWith('error=server_error');

    expect(html).toContain('Authorization Failed');
    expect(html).toContain('server_error');
    expect(html).not.toContain('Authorization Successful');
  });

  it('still confirms a real authorization', () => {
    const html = renderWith('code=abc123&state=s-live');

    expect(html).toContain('Authorization Successful');
    expect(html).not.toContain('Authorization Failed');
  });

  it('asks for a manual copy when the URL carries neither code nor error', () => {
    const html = renderWith('');

    expect(html).toContain('Copy This URL');
    expect(html).not.toContain('Authorization Successful');
    expect(html).not.toContain('Authorization Failed');
  });
});
