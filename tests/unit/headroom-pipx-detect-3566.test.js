import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("headroom detection follows the PATH symlink (#3566)", () => {
  const detect = read("src/lib/headroom/detect.js");

  it("resolves the binary before deriving the sibling interpreter", () => {
    // ~/.local/bin/headroom is a link into the pipx venv; dirname of the link
    // is ~/.local/bin, whose python3 is the system one and has no headroom-ai.
    expect(detect).toContain('import { realpathSync } from "fs"');
    expect(detect).toContain("path.dirname(realpathSync(bin))");
  });

  it("keeps the literal directory as a second candidate", () => {
    expect(detect).toContain("const literalDir = path.dirname(bin);");
    expect(detect).toContain("if (!dirs.includes(literalDir)) dirs.push(literalDir);");
  });

  it("does not let a broken link throw", () => {
    const block = detect.slice(detect.indexOf("const realDir"), detect.indexOf("const literalDir"));
    expect(block).toContain("} catch {");
  });
});

describe("a failed install says why (#3566)", () => {
  const proc = read("src/lib/headroom/process.js");

  it("carries the log tail on the error instead of only the exit code", () => {
    expect(proc).toContain("err.log = tail;");
    expect(proc).toContain("lines.slice(-6)");
  });

  it("still succeeds in reporting when the log cannot be read", () => {
    const block = proc.slice(proc.indexOf("let tail = ''"), proc.indexOf("err.code = 'INSTALL_FAILED'"));
    expect(block).toContain("} catch {");
  });
});
