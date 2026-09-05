// Ponytail injector: appends the "lazy senior dev" instruction into the system
// message of the final request body, just before dispatch to the provider executor.

import { injectSystemPrompt } from "./systemInject.js";
import { PONYTAIL_PROMPTS } from "./ponytailPrompt.js";

export function injectPonytail(body, format, level) {
  // Pass through injectSystemPrompt's changed-body report: callers gate
  // "injected" notes and flags on the body actually having changed.
  return injectSystemPrompt(body, format, PONYTAIL_PROMPTS[level]);
}
