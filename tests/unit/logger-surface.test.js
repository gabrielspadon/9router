// Import-surface regression for src/sse/utils/logger.js: the dead lifecycle
// methods (response, stream; formerly requestEnd/apiRequest/streamEvent) stay
// deleted, while the live surface (request, debug, maskKey) is intact.

import { describe, expect, it } from "vitest";
import * as log from "@/sse/utils/logger.js";

describe("logger.js import surface", () => {
  it("keeps the live helpers and the dead lifecycle methods stay gone", () => {
    expect(typeof log.request).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.maskKey).toBe("function");
    expect(typeof log.line).toBe("function");

    expect("response" in log).toBe(false);
    expect("stream" in log).toBe(false);
    expect("requestEnd" in log).toBe(false);
    expect("apiRequest" in log).toBe(false);
    expect("streamEvent" in log).toBe(false);
  });

  it("maskKey still masks to a prefix form", () => {
    expect(log.maskKey("sk-abcdef1234567890")).toBe("sk-a...7890");
    expect(log.maskKey("short")).toBe("***");
  });
});
