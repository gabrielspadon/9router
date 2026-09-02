import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Codex clients read the provider's model endpoint as a Codex catalog, not as
// an OpenAI list. They decode a `models` array and fail outright on ours with
// "failed to decode models response: missing field `models`" (#1908).
//
// Generic OpenAI clients keep the list shape untouched; only a request this
// router has already identified as Codex gets this one, using the same
// detectClientTool the request path uses rather than a second detector.
//
// Two fields the report names are deliberately ABSENT: `tool_mode` and
// `multi_agent_version`. Their value domains are not derivable from anything in
// this tree, and inventing a string that the client then acts on is worse than
// omitting an optional field. If Codex turns out to require them, the failure is
// the decode error it already gets today, so nothing is made worse by leaving
// them out until someone can name the real values.
function toModelInfo(entry) {
  const id = String(entry?.id || "");
  const [owner, ...rest] = id.split("/");
  const bare = rest.length > 0 ? rest.join("/") : id;
  const caps = getCapabilitiesForModel(entry?.owned_by || owner, bare) || {};
  return {
    slug: id,
    display_name: entry?.name || entry?.display_name || bare || id,
    supported_in_api: true,
    supports_search_tool: caps.search === true,
  };
}

/**
 * Build the Codex-shaped catalog from the OpenAI-shaped list this route
 * already produces, so both views describe exactly the same set of models.
 *
 * @param {Array<object>} data - the entries of the OpenAI `data` array
 * @returns {{ models: Array<object> }}
 */
export function buildCodexCatalog(data) {
  return { models: (Array.isArray(data) ? data : []).filter((e) => e?.id).map(toModelInfo) };
}
