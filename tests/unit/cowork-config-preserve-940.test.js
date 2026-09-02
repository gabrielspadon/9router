import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Issue #940. Cowork advertises a tool (`ask_question` in the report) and then
// answers a call to it with "No such tool available", i.e. the runtime's own
// registration is gone while the model still sees the tool. The one thing in
// this tree that can remove it is Apply: it rebuilt the applied profile from a
// literal and wrote it over `configLibrary/<appliedId>.json`, a file Claude
// Desktop owns and stores its own state in, so every key the app had put there
// was deleted on each Apply. Reset was the same defect, blanking the file to
// `{}` instead of removing tokenproxy's own keys.
//
// The route now merges its keys in and strips only its keys out. These assert
// a foreign key survives both, which is what a wholesale write cannot do.

// Both handlers resolve every path from os.homedir(), which is $HOME on POSIX,
// so pointing HOME at a temp tree sandboxes them without mocking node:os.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-cowork-940-'));
const PREV_HOME = process.env.HOME;
process.env.HOME = TMP;

const CONFIG_DIR = path.join(TMP, '.config', 'Claude-3p', 'configLibrary');
const APPLIED_ID = 'applied-profile-id';
const CONFIG_PATH = path.join(CONFIG_DIR, `${APPLIED_ID}.json`);

// Reading the real machine id shells out; the token's value is irrelevant here.
vi.mock('@/shared/utils/machineId', () => ({
  getConsistentMachineId: async () => 'test-cli-token',
}));

// Keys Cowork itself owns in that file. Neither is anything tokenproxy writes.
const FOREIGN = {
  coworkEnabledBuiltinTools: ['ask_question', 'str_replace'],
  workspaces: [{ id: 'w1', name: 'project' }],
};

function seedProfile(extra = {}) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CONFIG_DIR, '_meta.json'),
    JSON.stringify({ appliedId: APPLIED_ID, entries: [{ id: APPLIED_ID, name: 'Default' }] })
  );
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...FOREIGN, ...extra }, null, 2));
}

const readProfile = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function applyRequest(body) {
  return new Request('http://localhost:20128/api/cli-tools/cowork-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const APPLY = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'sk-test',
  models: ['gpt-5'],
  plugins: [],
  localPlugins: [],
  customPlugins: [],
};

beforeEach(() => seedProfile());
afterAll(() => {
  if (PREV_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = PREV_HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("Apply and Reset leave Cowork's own profile keys alone (#940)", () => {
  it('Apply merges over the profile instead of replacing it', async () => {
    const { POST } = await import('@/app/api/cli-tools/cowork-settings/route.js');
    const res = await POST(applyRequest(APPLY));
    expect(res.status).toBe(200);

    const cfg = readProfile();
    // The tool registration the report loses is still there.
    expect(cfg.coworkEnabledBuiltinTools).toEqual(['ask_question', 'str_replace']);
    expect(cfg.workspaces).toEqual(FOREIGN.workspaces);
    // And our own keys landed.
    expect(cfg.inferenceProvider).toBe('gateway');
    expect(cfg.inferenceGatewayBaseUrl).toBe(APPLY.baseUrl);
    expect(cfg.inferenceModels).toEqual([{ name: 'gpt-5' }]);
  });

  it('Apply with no plugins clears a server list a previous Apply wrote', async () => {
    seedProfile({ managedMcpServers: [{ name: 'exa', url: 'https://mcp.exa.ai/mcp' }] });
    const { POST } = await import('@/app/api/cli-tools/cowork-settings/route.js');
    expect((await POST(applyRequest(APPLY))).status).toBe(200);

    const cfg = readProfile();
    expect(cfg.managedMcpServers).toBeUndefined();
    expect(cfg.coworkEnabledBuiltinTools).toEqual(['ask_question', 'str_replace']);
  });

  it("Reset removes only tokenproxy's keys", async () => {
    const route = await import('@/app/api/cli-tools/cowork-settings/route.js');
    expect((await route.POST(applyRequest(APPLY))).status).toBe(200);
    expect((await route.DELETE()).status).toBe(200);

    const cfg = readProfile();
    expect(cfg.coworkEnabledBuiltinTools).toEqual(['ask_question', 'str_replace']);
    expect(cfg.workspaces).toEqual(FOREIGN.workspaces);
    expect(cfg.inferenceProvider).toBeUndefined();
    expect(cfg.inferenceGatewayApiKey).toBeUndefined();
    expect(cfg.inferenceModels).toBeUndefined();
    expect(cfg.coworkEgressAllowedHosts).toBeUndefined();
  });
});
