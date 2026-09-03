import { detectClientTool } from "./clientDetector.js";

/**
 * Tell a parent agent's request from a sub-agent's, and narrow a combo to the
 * model group the user assigned that role (#1092).
 *
 * The report's problem is real: a combo is one flat pool, so a sub-agent
 * spawned for an auxiliary task draws from the same top-tier models the main
 * loop does. What it needs first is a way to tell the two apart, and a
 * sub-agent request is an ordinary chat request over the same endpoint with the
 * same key — the only thing that differs is the preamble the client puts in
 * front of it.
 *
 * So detection is keyed off PREAMBLES_BY_CLIENT_TOOL below, one entry per
 * harness whose sub-agent preamble is documented, using the same
 * detectClientTool the rest of the gateway uses rather than a private string
 * match. A client with no entry is `null`, meaning "no basis to decide"
 * rather than "parent". And the whole feature is inert until the user assigns
 * groups, so a preamble that changes upstream costs a lost optimisation,
 * never a misrouted request.
 *
 * Only Claude Code is populated today, not because this router favours it,
 * but because it is the one integrated harness with no OTHER way to route a
 * sub-agent to a cheaper model: Codex, OpenCode and Grok CLI already carry a
 * native, client-side subagent-model setting (their own `agents.subagent` /
 * `agent.explorer` / `subagents.models` config, written by this app's own
 * cli-tools settings routes) that picks a distinct model per role WITHOUT any
 * server-side detection. Claude Code's Task-tool sub-agents inherit the
 * parent's model with no equivalent per-role override, so the preamble is the
 * only signal available for it. Adding another harness here means adding its
 * own documented preamble, not touching the mechanism.
 */

// One entry per harness whose sub-agent preamble is documented. Add a
// clientTool key here (see open-sse/utils/clientDetector.js) once another
// harness's preamble is known — the detector already recognises the tool,
// this table just needs to learn its wording.
const PREAMBLES_BY_CLIENT_TOOL = {
  claude: [
    /^you are an agent for claude code/i,
    /^you are a sub-?agent/i,
  ],
};

function systemText(body) {
  const parts = [];
  if (typeof body?.system === "string") parts.push(body.system);
  else if (Array.isArray(body?.system)) {
    for (const block of body.system) if (typeof block?.text === "string") parts.push(block.text);
  }
  for (const message of body?.messages || []) {
    if (message?.role !== "system") continue;
    if (typeof message.content === "string") parts.push(message.content);
    else if (Array.isArray(message.content)) {
      for (const block of message.content) if (typeof block?.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n").trimStart();
}

/**
 * @returns {"parent"|"sub"|null} null when the client is not one whose preamble
 *   is known, so the caller leaves routing exactly as it was.
 */
export function detectAgentRole(body, userAgent = "") {
  const clientTool = detectClientTool({ "user-agent": userAgent }, {});
  const preambles = clientTool && PREAMBLES_BY_CLIENT_TOOL[clientTool];
  if (!preambles) return null;
  const text = systemText(body);
  if (!text) return "parent";
  return preambles.some((re) => re.test(text)) ? "sub" : "parent";
}

/**
 * Narrow a combo's member list to the group assigned to `role`.
 *
 * Order is the combo's, not the group's: the user already expressed a fallback
 * preference by writing the combo, and a role group says which members are
 * eligible, not in what sequence to try them.
 *
 * Returns the original list unchanged when there is no group, when the role is
 * unknown, or when narrowing would leave nothing — the report asks for a
 * fallback to other available models, and an empty chain is not one.
 */
export function applyAgentRoleGroup(models, role, settings) {
  if (!Array.isArray(models) || models.length === 0) return models;
  if (role !== "parent" && role !== "sub") return models;

  const group = settings?.agentRoles?.[role];
  if (!Array.isArray(group) || group.length === 0) return models;

  const allowed = new Set(group);
  const narrowed = models.filter((m) => allowed.has(m));
  return narrowed.length ? narrowed : models;
}
