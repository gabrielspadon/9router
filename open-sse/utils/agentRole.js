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
 * So detection is deliberately narrow. It applies to Claude Code only, because
 * that is the client whose preamble is known; every other client is `null`,
 * meaning "no basis to decide" rather than "parent". And the whole feature is
 * inert until the user assigns groups, so a preamble that changes upstream
 * costs a lost optimisation, never a misrouted request.
 */

// The sub-agent preamble Claude Code puts in front of a Task-tool request. It
// is a client string and will move; that is why an unmatched request is treated
// as the parent, which is the pre-existing behaviour.
const SUB_AGENT_PREAMBLES = [
  /^you are an agent for claude code/i,
  /^you are a sub-?agent/i,
];

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
  if (!userAgent.includes("claude-cli")) return null;
  const text = systemText(body);
  if (!text) return "parent";
  return SUB_AGENT_PREAMBLES.some((re) => re.test(text)) ? "sub" : "parent";
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
