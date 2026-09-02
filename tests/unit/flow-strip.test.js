import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const channels = readFileSync(resolve(root, "src/shared/components/ChannelList.js"), "utf8");
const combos = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/combos/page.js"), "utf8");
const gallery = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/gallery/page.js"), "utf8");

// direction.md:67 grafts A2's route spine and flow strip onto the Compose
// surfaces; critique.md item 6 is that the routing chain was invisible.
// direction.md signature element 3 is the patch bay, and the combos page
// described fallback order in prose instead of drawing it.
describe("patch bay and flow strip on the Compose surface", () => {
  it("exports a flow strip that names the junction and the channel count", () => {
    expect(channels).toMatch(/export function FlowStrip\(/);
    expect(channels).toMatch(/junction, channels/);
  });

  it("draws a combo's fallback order as numbered channels, not chips", () => {
    expect(combos).toMatch(/<ChannelList>/);
    expect(combos).toMatch(/<Channel\b/);
    expect(combos).toMatch(/index=\{index \+ 1\}/);
  });

  it("states the chain above the channels on the combos page", () => {
    expect(combos).toMatch(/<FlowStrip/);
    expect(combos).toMatch(/junction=\{STRATEGY_OPTIONS\.find/);
  });

  it("documents both in the gallery, which is the primitives' reference", () => {
    expect(gallery).toMatch(/<FlowStrip/);
    expect(gallery).toMatch(/<ChannelList>/);
  });

  it("keeps the channel number out of the accessible name and in a label", () => {
    expect(channels).toMatch(/aria-hidden="true"[\s\S]{0,200}\{index\}/);
    expect(channels).toMatch(/<span className="sr-only">Channel \{index\}\. <\/span>/);
  });
});
