// Popup-callback trust boundary (leaf S1-1 / S1-2).
//
// The dashboard modal accepts an OAuth authorization code from a popup window
// via postMessage. Two checks stand between that message and a token exchange:
//
//   1. the sender's origin must be the dashboard itself, or a loopback alias of
//      it (the popup lands on http://localhost:PORT/callback even when the
//      dashboard is open on http://127.0.0.1:PORT, so the two disagree),
//   2. the state carried by the message must be the state this flow generated.
//
// Both are asserted here as behaviour of the exported predicates. Nothing in
// this file asserts markup or class names.

import { describe, expect, it } from 'vitest';
import {
  isTrustedCallbackOrigin,
  isCallbackStateMatch,
  isLoopbackBrowserHostname,
} from '@/shared/components/OAuthModal.js';

const DASHBOARD = 'http://localhost:20128';

describe('isTrustedCallbackOrigin', () => {
  it("accepts the dashboard's own origin", () => {
    expect(isTrustedCallbackOrigin(DASHBOARD, DASHBOARD)).toBe(true);
    expect(isTrustedCallbackOrigin('https://tokenproxy.example', 'https://tokenproxy.example')).toBe(
      true
    );
  });

  it('accepts the loopback alias the popup actually lands on', () => {
    // Dashboard opened on 127.0.0.1, redirect_uri is always localhost.
    expect(isTrustedCallbackOrigin('http://localhost:20128', 'http://127.0.0.1:20128')).toBe(true);
    expect(isTrustedCallbackOrigin('http://127.0.0.1:1455', 'http://localhost:20128')).toBe(true);
    expect(isTrustedCallbackOrigin('http://[::1]:20128', 'http://localhost:20128')).toBe(true);
  });

  it('rejects a hostname that merely contains a loopback name', () => {
    // The regression: a substring test accepted every one of these.
    expect(isTrustedCallbackOrigin('https://localhost.evil.com', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('https://127.0.0.1.evil.com', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('https://evil-localhost.com', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('https://localhost-127.0.0.1.attacker.net', DASHBOARD)).toBe(
      false
    );
  });

  it('rejects an unrelated, opaque or malformed origin', () => {
    expect(isTrustedCallbackOrigin('https://evil.com', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('null', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin(undefined, DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('not a url', DASHBOARD)).toBe(false);
  });

  it('rejects a non-http scheme on a loopback host', () => {
    expect(isTrustedCallbackOrigin('file://localhost', DASHBOARD)).toBe(false);
    expect(isTrustedCallbackOrigin('ftp://localhost', DASHBOARD)).toBe(false);
  });
});

describe('isCallbackStateMatch', () => {
  it('accepts only the state this flow generated', () => {
    expect(isCallbackStateMatch('s-live', 's-live')).toBe(true);
  });

  it("rejects a callback carrying somebody else's state", () => {
    expect(isCallbackStateMatch('s-live', 's-attacker')).toBe(false);
  });

  it('rejects a callback that carries no state at all while one is held', () => {
    // An injected message can simply omit state; that must not pass.
    expect(isCallbackStateMatch('s-live', undefined)).toBe(false);
    expect(isCallbackStateMatch('s-live', null)).toBe(false);
    expect(isCallbackStateMatch('s-live', '')).toBe(false);
  });

  it('does not block providers that issue no state', () => {
    // Nothing was generated, so there is nothing to bind against.
    expect(isCallbackStateMatch(undefined, 'whatever')).toBe(true);
    expect(isCallbackStateMatch(null, undefined)).toBe(true);
    expect(isCallbackStateMatch('', 'whatever')).toBe(true);
  });
});

describe('isLoopbackBrowserHostname', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '::1'])('accepts direct loopback browser host %s', (hostname) => {
    expect(isLoopbackBrowserHostname(hostname)).toBe(true);
  });

  it.each(['router.example', 'localhost.evil.example', '::ffff:127.0.0.1'])('rejects non-loopback browser host %s', (hostname) => {
    expect(isLoopbackBrowserHostname(hostname)).toBe(false);
  });
});
