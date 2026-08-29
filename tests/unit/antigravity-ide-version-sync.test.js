import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// shared.js (ESM) pins the official IDE fingerprint; the mitm override must
// rewrite requests to the SAME version. Both read one source.
import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_USER_AGENT,
} from '../../open-sse/providers/shared.js';

describe('Antigravity IDE version single source', () => {
  it('mitm override version matches the provider pin', () => {
    const mitm = require('../../src/mitm/antigravityIdeVersion.js');
    expect(mitm.ANTIGRAVITY_IDE_VERSION).toBe(ANTIGRAVITY_IDE_VERSION);
  });

  it('user agent template carries the pinned version', () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(
      `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`
    );
  });
});
