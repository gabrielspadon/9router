// #3642 — "OIDC provider did not return an id_token".
//
// The settings scope box takes any string. Save it as "profile email" and the
// authorization request stops being an OIDC one (OIDC Core 1.0 §3.1.2.1), so a
// compliant provider runs plain OAuth2 and issues no id_token. The callback
// only discovers that after the user has round-tripped through the IdP.
// normalizeScopes now guarantees "openid" on every authorization URL.
import { describe, it, expect } from 'vitest';
import { buildOidcAuthorizationUrl } from '@/lib/auth/oidc.js';

const base = {
  authorizationEndpoint: 'https://idp.example.com/authorize',
  clientId: 'client-123',
  redirectUri: 'https://router.example.com/api/auth/oidc/callback',
  state: 'state-abc',
  nonce: 'nonce-abc',
  codeChallenge: 'challenge-abc',
};

function scopeOf(overrides) {
  return new URL(buildOidcAuthorizationUrl({ ...base, ...overrides })).searchParams.get('scope');
}

describe('OIDC authorization scope always carries openid (#3642)', () => {
  it('re-adds openid when the admin trimmed it out of the configured scopes', () => {
    expect(scopeOf({ scopes: 'profile email' }).split(' ')).toContain('openid');
  });

  it("keeps the admin's other scopes alongside openid", () => {
    expect(scopeOf({ scopes: 'profile email groups' }).split(' ').sort()).toEqual([
      'email',
      'groups',
      'openid',
      'profile',
    ]);
  });

  it('does not duplicate openid when it is already configured', () => {
    expect(scopeOf({ scopes: 'openid email' })).toBe('openid email');
  });

  it('falls back to the full default set for an empty or whitespace scope', () => {
    expect(scopeOf({ scopes: '   ' })).toBe('openid profile email');
    expect(scopeOf({ scopes: undefined })).toBe('openid profile email');
  });

  it('normalizes irregular spacing without dropping a scope', () => {
    expect(scopeOf({ scopes: '  profile   email  ' })).toBe('openid profile email');
  });
});
