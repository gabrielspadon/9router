import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../docs/design/verification/instance.sh", import.meta.url), "utf8");
const smoke = readFileSync(new URL("../../docs/design/verification/check-smoke.sh", import.meta.url), "utf8");
const summary = readFileSync(new URL("../../docs/design/verification/write-summary.mjs", import.meta.url), "utf8");
const lintDelta = readFileSync(new URL("../../docs/design/verification/check-lint-delta.sh", import.meta.url), "utf8");

describe("isolated verification instance", () => {
  it("keeps build-time state separate from the seeded runtime database", () => {
    expect(script).toContain('INSTANCE="${TP_INSTANCE:-r3}"');
    expect(script).toContain('ENV="/tmp/tokenproxy-${INSTANCE}.env"');
    expect(script).toContain('PROVENANCE="/tmp/tokenproxy-${INSTANCE}-provenance.json"');
    expect(script).toContain("ensure_env()");
    expect(script).toMatch(/ensure_env\n\s+set -a\n\s+\. \"\$ENV\"\n\s+set \+a/);
    expect(script).toContain('BUILD_DATA="/tmp/tokenproxy-${INSTANCE}-build-data"');
    expect(script).toContain('NEXT_DIST_DIR=.next DATA_DIR="$BUILD_DATA" mise x node@24.15.0 -- npm run build');
    expect(script).toContain('DISABLE_BACKGROUND_TOKEN_REFRESH=1 DATA_DIR="$DATA"');
    expect(script).toContain("mise x node@24.15.0 -- node custom-server.js");
    expect(script).toContain('cp -a "$SOURCE"/node_modules/node-machine-id "$APP"/node_modules/');
    expect(script).toContain('cp -a "$SOURCE"/open-sse/. "$APP"/open-sse/');
    expect(script).toContain('"$SOURCE"/node_modules/{undici,socks-proxy-agent,agent-base,debug,socks,smart-buffer,ip-address,ms}');
  });

  it("builds a fresh isolated source tree instead of shared dependencies", () => {
    expect(script).toContain('SOURCE="/tmp/tokenproxy-${INSTANCE}-source"');
    expect(script).toContain('BUILD="$SOURCE/.next"');
    expect(script).toContain('rsync -a \\');
    expect(script).toContain('cd "$SOURCE"');
    expect(script).toContain("npm install --no-audit --no-fund");
    expect(script).not.toContain("npm ci --no-audit --no-fund");
    expect(script).toContain('cp -a "$BUILD"/standalone/. "$APP"/');
  });

  it("uses the isolated port override consistently in smoke and reporting", () => {
    expect(smoke).toContain('PORT="${TP_PORT:-20135}"');
    expect(smoke).toContain('DATA="/tmp/tokenproxy-${INSTANCE}-data"');
    expect(smoke).toContain("isolated process ownership mismatch");
    expect(summary).not.toContain("defaults to 20129");
  });

  it("can target an existing isolated data copy when proving restart ownership", () => {
    expect(script).toContain('DATA="$(realpath -m "${TP_DATA_DIR:-/tmp/tokenproxy-${INSTANCE}-data}")"');
    expect(script).toContain("TP_DATA_DIR must remain a private /tmp directory for this instance");
  });

  it("refuses a rebuild when it cannot prove the existing listener is isolated", () => {
    expect(script).toContain("restart) down || exit $?; snapshot; up ;;");
  });

  it("reports an empty lint delta as measured rather than unknown", () => {
    expect(summary).toContain('const lintSummary = /no lintable files changed/.test(lint)');
    expect(summary).toContain('"no changed JavaScript files"');
    expect(lintDelta).toContain('git ls-files --others --exclude-standard');
  });
});
