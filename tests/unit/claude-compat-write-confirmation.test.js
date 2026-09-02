// Confirmation for the Claude Compat "Write settings" action (leaf S1-5).
//
// The action overwrites the real ~/.claude/settings.json of the machine
// running the gateway (VERIFY_ONLY is false in the route), which on this host
// is the live Claude Code configuration. It used to fire straight from the
// button. What the operator now reads before confirming is asserted here:
// the absolute path, and every key whose value the write changes.
//
// Nothing in this file touches the filesystem, and no path outside the
// fixtures below is named.

import { describe, expect, it } from 'vitest';
import { claudeWriteConfirmation } from '@/app/(dashboard)/dashboard/claude-compat/page.js';

const FILE = '/tmp/tokenproxy-test-home/.claude/settings.json';

const textOf = (lines) => lines.map((l) => l.text).join('\n');

describe('claudeWriteConfirmation', () => {
  it('names the absolute file being overwritten', () => {
    const text = textOf(claudeWriteConfirmation({ file: FILE, env: { A: '1' }, currentEnv: {} }));

    expect(text).toContain(FILE);
  });

  it('names every existing key it replaces, with the value it replaces', () => {
    const lines = claudeWriteConfirmation({
      file: FILE,
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm/glm-5.3',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi/k3',
      },
      currentEnv: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm/glm-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi/k3',
        ANTHROPIC_AUTH_TOKEN: 'sk-untouched',
      },
    });
    const text = textOf(lines);

    expect(text).toContain('Replaces 1 existing key(s):');
    expect(text).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL: glm/glm-5 → glm/glm-5.3');
    // A key already holding the target value is counted, not listed as a change.
    expect(text).toContain('1 key(s) already hold this value');
    expect(text).not.toContain('ANTHROPIC_DEFAULT_HAIKU_MODEL: kimi/k3 →');
    // Keys the write never touches are never presented as changing.
    expect(text).not.toContain('sk-untouched');
    expect(text).toContain('Nothing else in the file changes.');
  });

  it('separates keys that are added from keys that are replaced', () => {
    const text = textOf(
      claudeWriteConfirmation({
        file: FILE,
        env: { NEW_KEY: 'v', OLD_KEY: 'new' },
        currentEnv: { OLD_KEY: 'old' },
      })
    );

    expect(text).toContain('Adds 1 new key(s):');
    expect(text).toContain('NEW_KEY: v');
    expect(text).toContain('Replaces 1 existing key(s):');
    expect(text).toContain('OLD_KEY: old → new');
  });

  it('says so when the current file could not be read, instead of claiming the keys are new', () => {
    const text = textOf(
      claudeWriteConfirmation({ file: FILE, env: { A: '1', B: '2' }, currentEnv: null })
    );

    expect(text).toContain('current contents could not be read');
    expect(text).toContain('2 key(s)');
    expect(text).toContain(FILE);
  });

  it('still names a file when the server did not report the resolved path', () => {
    const text = textOf(claudeWriteConfirmation({ file: null, env: { A: '1' }, currentEnv: {} }));

    expect(text).toContain('~/.claude/settings.json');
    expect(text).toContain('did not report the resolved path');
  });
});
