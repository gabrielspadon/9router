import {
  KIRO_TOOL_DESCRIPTION_MAX_LENGTH,
  KIRO_TOOL_ID_MAX_LENGTH,
  KIRO_TOOL_NAME_MAX_LENGTH,
} from "../../config/kiroConstants.js";

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendText(target, extra) {
  if (!extra) return;
  target.content = target.content ? `${target.content}\n\n${extra}` : extra;
}

function trimCodePoints(value, limit) {
  return [...String(value || "")].slice(0, limit).join("");
}

function uniqueName(rawName, index, usedNames) {
  const cleaned = String(rawName || "")
    .trim()
    .replace(TOOL_NAME_PATTERN, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = trimCodePoints(cleaned || `tool_${index + 1}`, KIRO_TOOL_NAME_MAX_LENGTH);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedNames.add(candidate);
  return candidate;
}

const STRIPPED_SCHEMA_KEYS = new Set([
  "additionalProperties", "$schema", "$id", "examples", "default", "title",
]);
const ROOT_COMBINATORS = ["allOf", "oneOf", "anyOf"];
const SCHEMA_MAP_KEYS = new Set([
  "properties", "patternProperties", "$defs", "definitions", "dependentSchemas",
]);
const STRING_ARRAY_MAP_KEYS = new Set(["dependentRequired"]);

function isSchemaObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanSchemaMap(value) {
  if (!isSchemaObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    cleanSchemaValue(child),
  ]));
}

function cleanStringArrayMap(value) {
  if (!isSchemaObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function cleanSchemaValue(value) {
  if (Array.isArray(value)) return value.map(cleanSchemaValue);
  if (!isSchemaObject(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (STRIPPED_SCHEMA_KEYS.has(key)) return [];
    if (key === "required" && Array.isArray(child) && child.length === 0) return [];
    if (SCHEMA_MAP_KEYS.has(key)) return [[key, cleanSchemaMap(child)]];
    if (STRING_ARRAY_MAP_KEYS.has(key)) return [[key, cleanStringArrayMap(child)]];
    if (key === "enum" || key === "const") return [[key, clone(child)]];
    return [[key, cleanSchemaValue(child)]];
  }));
}

function emptyFragment() {
  return {
    properties: new Map(),
    required: [],
    defs: new Map(),
    definitions: new Map(),
    sawDefs: false,
    sawDefinitions: false,
  };
}

function addFirst(target, source) {
  if (!isSchemaObject(source)) return;
  for (const [name, value] of Object.entries(source)) {
    if (!target.has(name)) target.set(name, value);
  }
}

function addRequired(target, names) {
  if (!Array.isArray(names)) return;
  for (const name of names) {
    if (typeof name === "string" && !target.includes(name)) target.push(name);
  }
}

function mergeShape(target, source) {
  addFirst(target.properties, Object.fromEntries(source.properties));
  addFirst(target.defs, Object.fromEntries(source.defs));
  addFirst(target.definitions, Object.fromEntries(source.definitions));
  target.sawDefs ||= source.sawDefs;
  target.sawDefinitions ||= source.sawDefinitions;
}

function commonRequired(fragments) {
  if (fragments.length === 0) return [];
  const later = fragments.slice(1).map((item) => new Set(item.required));
  return fragments[0].required.filter((name) => later.every((set) => set.has(name)));
}

function validBranches(value) {
  return Array.isArray(value) ? value.filter(isSchemaObject) : [];
}

function collectRootFragment(schema) {
  const fragment = emptyFragment();
  addFirst(fragment.properties, schema.properties);
  addRequired(fragment.required, schema.required);

  if (isSchemaObject(schema.$defs)) {
    fragment.sawDefs = true;
    addFirst(fragment.defs, schema.$defs);
  }
  if (isSchemaObject(schema.definitions)) {
    fragment.sawDefinitions = true;
    addFirst(fragment.definitions, schema.definitions);
  }

  for (const branch of validBranches(schema.allOf)) {
    const child = collectRootFragment(branch);
    mergeShape(fragment, child);
    addRequired(fragment.required, child.required);
  }

  for (const keyword of ["oneOf", "anyOf"]) {
    const alternatives = validBranches(schema[keyword]).map(collectRootFragment);
    for (const child of alternatives) mergeShape(fragment, child);
    addRequired(fragment.required, commonRequired(alternatives));
  }

  return fragment;
}

function normalizeRootSchema(schema) {
  const cleaned = cleanSchemaValue(isSchemaObject(schema) ? schema : {});
  const fragment = collectRootFragment(cleaned);
  const preserved = Object.fromEntries(Object.entries(cleaned).filter(([key, value]) => {
    if (ROOT_COMBINATORS.includes(key)) return false;
    if (["type", "properties", "required"].includes(key)) return false;
    if ((key === "$defs" || key === "definitions") && isSchemaObject(value)) return false;
    return true;
  }));
  const normalized = {
    ...preserved,
    type: "object",
    properties: Object.fromEntries(fragment.properties),
  };
  if (fragment.sawDefs && (cleaned.$defs === undefined || isSchemaObject(cleaned.$defs))) {
    normalized.$defs = Object.fromEntries(fragment.defs);
  }
  if (fragment.sawDefinitions &&
      (cleaned.definitions === undefined || isSchemaObject(cleaned.definitions))) {
    normalized.definitions = Object.fromEntries(fragment.definitions);
  }
  const required = fragment.required.filter((name) => fragment.properties.has(name));
  if (required.length > 0) normalized.required = required;
  return normalized;
}

/** Normalize OpenAI- or Claude-shaped tool definitions into Kiro tool specs. */
export function normalizeKiroToolSpecs(tools) {
  const specs = [];
  const nameMap = new Map();
  const usedNames = new Set();

  for (const [index, tool] of (Array.isArray(tools) ? tools : []).entries()) {
    if (!tool || typeof tool !== "object") continue;
    const rawName = tool.function?.name ?? tool.name;
    if (typeof rawName !== "string" || !rawName.trim()) continue;

    // A repeated definition with the same source name describes the same tool.
    if (nameMap.has(rawName)) continue;
    const name = uniqueName(rawName, index, usedNames);
    nameMap.set(rawName, name);

    const rawDescription = tool.function?.description ?? tool.description ?? `Tool: ${rawName}`;
    const description = trimCodePoints(
      String(rawDescription || `Tool: ${rawName}`),
      KIRO_TOOL_DESCRIPTION_MAX_LENGTH
    );
    const schema = tool.function?.parameters ?? tool.parameters ?? tool.input_schema ?? {};
    specs.push({
      toolSpecification: {
        name,
        description,
        inputSchema: { json: normalizeRootSchema(schema) },
      },
    });
  }

  return { specs, nameMap };
}

function toolCallText(toolUse) {
  return `[Tool call: ${toolUse?.name || "unknown"}(${text(toolUse?.input || {})})]`;
}

function toolResultText(toolResult) {
  const content = Array.isArray(toolResult?.content)
    ? toolResult.content.map((part) => text(part?.text ?? part)).filter(Boolean).join("\n")
    : text(toolResult?.content);
  return `[Tool result${toolResult?.status === "error" ? " (error)" : ""}: ${content}]`;
}

function mergeUser(target, source) {
  appendText(target, source.content);
  if (Array.isArray(source.images) && source.images.length > 0) {
    target.images = [...(target.images || []), ...source.images];
  }
  const results = source.userInputMessageContext?.toolResults;
  if (Array.isArray(results) && results.length > 0) {
    target.userInputMessageContext ||= {};
    target.userInputMessageContext.toolResults = [
      ...(target.userInputMessageContext.toolResults || []),
      ...results,
    ];
  }
}

function mergeAssistant(target, source) {
  appendText(target, source.content);
  if (Array.isArray(source.toolUses) && source.toolUses.length > 0) {
    target.toolUses = [...(target.toolUses || []), ...source.toolUses];
  }
}

function normalizeTurns(history, currentMessage, modelId) {
  const rawTurns = [...(Array.isArray(history) ? history : [])];
  if (currentMessage) rawTurns.push(currentMessage);
  const turns = [];

  for (const raw of rawTurns) {
    const isUser = !!raw?.userInputMessage;
    const isAssistant = !!raw?.assistantResponseMessage;
    if (isUser === isAssistant) continue;

    const turn = isUser
      ? { userInputMessage: clone(raw.userInputMessage) }
      : { assistantResponseMessage: clone(raw.assistantResponseMessage) };
    const previous = turns[turns.length - 1];
    if (turn.userInputMessage && previous?.userInputMessage) {
      mergeUser(previous.userInputMessage, turn.userInputMessage);
    } else if (turn.assistantResponseMessage && previous?.assistantResponseMessage) {
      mergeAssistant(previous.assistantResponseMessage, turn.assistantResponseMessage);
    } else {
      turns.push(turn);
    }
  }

  if (turns[0]?.assistantResponseMessage) {
    turns.unshift({ userInputMessage: { content: "continue", modelId } });
  }
  if (turns.length === 0 || turns[turns.length - 1]?.assistantResponseMessage) {
    turns.push({ userInputMessage: { content: "continue", modelId } });
  }

  for (const turn of turns) {
    if (turn.userInputMessage) {
      // A turn carrying tool results or images has no user text by design: the
      // payload is in userInputMessageContext. Substituting the literal word
      // "continue" made the model read a user instruction that nobody typed, and
      // it showed up in the visible conversation on every tool turn of an
      // agentic loop (#2182). The field still has to be non-empty, which is what
      // the fallback is for, so use the same neutral placeholder this function
      // already uses for an empty assistant turn rather than an imperative.
      //
      // The structural turns below keep "continue": those are inserted where the
      // conversation would otherwise start or end on the assistant, and there
      // the model genuinely is being asked to carry on.
      const carriesContext =
        (turn.userInputMessage.userInputMessageContext?.toolResults?.length > 0) ||
        (Array.isArray(turn.userInputMessage.images) && turn.userInputMessage.images.length > 0);
      turn.userInputMessage.content =
        text(turn.userInputMessage.content).trim() || (carriesContext ? "..." : "continue");
      turn.userInputMessage.modelId ||= modelId;
      if (turn.userInputMessage.userInputMessageContext?.tools) {
        delete turn.userInputMessage.userInputMessageContext.tools;
      }
    } else {
      turn.assistantResponseMessage.content =
        text(turn.assistantResponseMessage.content).trim() || "...";
    }
  }
  return turns;
}

function rawId(value) {
  return typeof value === "string" ? value : "";
}

function reserveToolId(value, turnIndex, callIndex, name, usedIds) {
  const sanitized = rawId(value).replace(/[^a-zA-Z0-9_-]/g, "");
  const generated = `call_msg${turnIndex}_tc${callIndex}_${name || "tool"}`;
  const base = trimCodePoints(
    TOOL_ID_PATTERN.test(sanitized) && sanitized ? sanitized : generated,
    KIRO_TOOL_ID_MAX_LENGTH
  );
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_ID_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeToolInput(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) return clone(input);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return input == null ? {} : null;
}

function normalizeToolResult(result) {
  const content = Array.isArray(result?.content)
    ? result.content.map((part) => ({ text: text(part?.text ?? part) }))
    : [{ text: text(result?.content) }];
  return {
    toolUseId: rawId(result?.toolUseId),
    status: result?.status === "error" ? "error" : "success",
    content: content.length > 0 ? content : [{ text: "" }],
  };
}

function flattenResults(userMessage, results) {
  for (const result of results) appendText(userMessage, toolResultText(result));
}

function cleanUserContext(userMessage) {
  const context = userMessage.userInputMessageContext;
  if (!context) return;
  if (!context.toolResults?.length) delete context.toolResults;
  if (!context.tools?.length) delete context.tools;
  if (Object.keys(context).length === 0) delete userMessage.userInputMessageContext;
}

function reconcileToolPair(assistant, user, turnIndex, nameMap, specNames, usedIds, repairs) {
  const calls = Array.isArray(assistant.toolUses) ? assistant.toolUses : [];
  const results = Array.isArray(user.userInputMessageContext?.toolResults)
    ? user.userInputMessageContext.toolResults.map(normalizeToolResult)
    : [];
  if (calls.length === 0) {
    if (results.length > 0) {
      flattenResults(user, results);
      repairs.orphanResults += results.length;
    }
    if (user.userInputMessageContext) delete user.userInputMessageContext.toolResults;
    cleanUserContext(user);
    return;
  }

  const callQueues = new Map();
  const callRecords = calls.map((call, callIndex) => {
    const key = rawId(call?.toolUseId);
    const mappedName = nameMap.get(call?.name) || call?.name;
    const input = normalizeToolInput(call?.input);
    const record = { call, callIndex, key, mappedName, input, result: null };
    const queue = callQueues.get(key) || [];
    queue.push(record);
    callQueues.set(key, queue);
    return record;
  });

  const orphanResults = [];
  for (const result of results) {
    const queue = callQueues.get(rawId(result.toolUseId));
    const record = queue?.find((candidate) => !candidate.result);
    if (record) record.result = result;
    else orphanResults.push(result);
  }

  const keptCalls = [];
  const keptResults = [];
  for (const record of callRecords) {
    const hasSpec = typeof record.mappedName === "string" && specNames.has(record.mappedName);
    const valid = !!record.result && hasSpec && record.input !== null;
    if (!valid) {
      appendText(assistant, toolCallText({ name: record.mappedName, input: record.call?.input }));
      repairs.missingResults += record.result ? 0 : 1;
      repairs.invalidToolUses += hasSpec && record.input !== null ? 0 : 1;
      if (record.result) {
        flattenResults(user, [record.result]);
        repairs.orphanResults++;
      }
      continue;
    }

    const toolUseId = reserveToolId(
      record.key,
      turnIndex,
      record.callIndex,
      record.mappedName,
      usedIds
    );
    keptCalls.push({
      toolUseId,
      name: record.mappedName,
      input: record.input,
    });
    keptResults.push({ ...record.result, toolUseId });
  }

  if (orphanResults.length > 0) {
    flattenResults(user, orphanResults);
    repairs.orphanResults += orphanResults.length;
  }

  if (keptCalls.length > 0) assistant.toolUses = keptCalls;
  else delete assistant.toolUses;
  user.userInputMessageContext ||= {};
  if (keptResults.length > 0) user.userInputMessageContext.toolResults = keptResults;
  else delete user.userInputMessageContext.toolResults;
  cleanUserContext(user);
}

/** Validate the final Kiro wire conversation without mutating it. */
export function validateKiroConversation(history, currentMessage, toolSpecs = []) {
  const errors = [];
  const turns = [...(history || []), currentMessage].filter(Boolean);
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter(Boolean));
  const usedIds = new Set();

  for (let index = 0; index < turns.length; index++) {
    const expectedUser = index % 2 === 0;
    const isUser = !!turns[index]?.userInputMessage;
    if (isUser !== expectedUser) errors.push(`role:${index}`);
    if (!isUser) {
      const calls = turns[index].assistantResponseMessage?.toolUses || [];
      const results = turns[index + 1]?.userInputMessage?.userInputMessageContext?.toolResults || [];
      const callIds = calls.map((call) => call.toolUseId);
      const resultIds = results.map((result) => result.toolUseId);
      if (calls.length !== results.length || callIds.some((id) => !resultIds.includes(id))) {
        errors.push(`pair:${index}`);
      }
      for (const call of calls) {
        if (!call.toolUseId || usedIds.has(call.toolUseId)) errors.push(`id:${index}`);
        usedIds.add(call.toolUseId);
        if (!specNames.has(call.name)) errors.push(`spec:${index}`);
      }
    } else if (index === 0) {
      const results = turns[index].userInputMessage?.userInputMessageContext?.toolResults;
      if (results?.length) errors.push("orphan:0");
    }
  }
  if (!currentMessage?.userInputMessage?.content) errors.push("current");
  return { valid: errors.length === 0, errors };
}

function flattenAllStructuredTools(turns, repairs) {
  for (const turn of turns) {
    if (turn.assistantResponseMessage?.toolUses?.length) {
      for (const call of turn.assistantResponseMessage.toolUses) {
        appendText(turn.assistantResponseMessage, toolCallText(call));
      }
      repairs.invalidToolUses += turn.assistantResponseMessage.toolUses.length;
      delete turn.assistantResponseMessage.toolUses;
    }
    const user = turn.userInputMessage;
    const results = user?.userInputMessageContext?.toolResults;
    if (results?.length) {
      flattenResults(user, results);
      repairs.orphanResults += results.length;
      delete user.userInputMessageContext.toolResults;
      cleanUserContext(user);
    }
  }
}

/**
 * Produce a strict Kiro conversation: alternating turns, current user message,
 * adjacent one-to-one tool use/result pairs, and tool specs only on currentMessage.
 */
export function canonicalizeKiroConversation({
  history,
  currentMessage,
  modelId,
  toolSpecs = [],
  nameMap = new Map(),
} = {}) {
  const turns = normalizeTurns(history, currentMessage, modelId);
  const repairs = { missingResults: 0, orphanResults: 0, invalidToolUses: 0 };
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter(Boolean));
  const usedIds = new Set();

  for (let index = 0; index < turns.length; index += 2) {
    const user = turns[index].userInputMessage;
    if (index === 0) {
      const leadingResults = user.userInputMessageContext?.toolResults || [];
      if (leadingResults.length > 0) {
        flattenResults(user, leadingResults);
        repairs.orphanResults += leadingResults.length;
        delete user.userInputMessageContext.toolResults;
        cleanUserContext(user);
      }
    }
    const assistant = turns[index + 1]?.assistantResponseMessage;
    const nextUser = turns[index + 2]?.userInputMessage;
    if (assistant && nextUser) {
      reconcileToolPair(assistant, nextUser, index + 1, nameMap, specNames, usedIds, repairs);
    }
  }

  const finalCurrent = turns[turns.length - 1];
  finalCurrent.userInputMessage.userInputMessageContext ||= {};
  if (toolSpecs.length > 0) {
    finalCurrent.userInputMessage.userInputMessageContext.tools = clone(toolSpecs);
  }
  cleanUserContext(finalCurrent.userInputMessage);

  let finalHistory = turns.slice(0, -1);
  let validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  if (!validation.valid) {
    flattenAllStructuredTools(turns, repairs);
    finalHistory = turns.slice(0, -1);
    validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  }

  return {
    history: finalHistory,
    currentMessage: finalCurrent,
    repairs,
    valid: validation.valid,
    errors: validation.errors,
  };
}
