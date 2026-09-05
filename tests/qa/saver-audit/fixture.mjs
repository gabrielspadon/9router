// Deterministic Claude Code-shaped session generator for the token-saver audit.
//
// Produces one growing agentic conversation in the Anthropic Messages shape:
// a cached system prompt, a tool catalogue with JSON-Schema noise, and rounds
// of assistant tool_use -> user tool_result, with human questions every few
// rounds. Tool results draw from the content families the rtk filters sniff
// (git diff, grep, numbered reads, build logs, ls) plus unstructured blobs
// large enough to reach the elide catch-all, error results, and images.
//
// Every turn body a client would have sent is reproducible from the seed, so
// two runs of the pipeline on the same turn are comparable byte for byte.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  "ingest pipeline watermark chunk hypertable compress index vessel trajectory " +
  "segment mmsi timestamp latitude longitude speed heading draught port anchor " +
  "batch worker queue retry backoff schema migration column constraint parquet " +
  "arrow buffer decode encode signature checksum config settings default limit " +
  "error panic unwrap borrow lifetime trait impl struct enum match option result"
).split(" ");

const TOPICS = [
  "ais ingest watermark resume",
  "postgres hypertable compression policy",
  "rust ffi panic boundary",
  "parquet row group sizing",
  "trajectory segmentation gaps",
  "dashboard usage chart",
  "oauth token refresh failure",
  "docker compose network",
];

const CORE_TOOLS = [
  ["Bash", "Executes a bash command in a persistent shell session with optional timeout"],
  ["Read", "Reads a file from the local filesystem, returning numbered lines"],
  ["Edit", "Performs exact string replacement in a file"],
  ["Write", "Writes a file to the local filesystem"],
  ["Grep", "Search file contents with ripgrep regular expressions"],
  ["Glob", "Fast file pattern matching by glob"],
  ["ToolSearch", "Load deferred tool schemas by name"],
  ["Agent", "Launch a subagent for a bounded task"],
];

const MCP_SERVERS = ["serena", "postgres", "playwright", "chrome-devtools", "computer-use", "citations"];

// Each topic owns a vocabulary of its own, so a turn about one topic shares
// few terms with a query about another (the way real sessions drift), and
// the lexical relevance scorer has something to separate.
const TOPIC_WORDS = new Map();
function topicWords(topic) {
  if (!TOPIC_WORDS.has(topic)) {
    const stem = topic.replace(/[^a-z]/g, "").slice(0, 6);
    TOPIC_WORDS.set(topic, Array.from({ length: 40 }, (_, i) => `${stem}${WORDS[(i * 7) % WORDS.length]}${i}`));
  }
  return TOPIC_WORDS.get(topic);
}

let currentTopic = TOPICS[0];
function words(rng, n) {
  const own = topicWords(currentTopic);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(rng() < 0.6 ? own[Math.floor(rng() * own.length)] : WORDS[Math.floor(rng() * WORDS.length)]);
  }
  return out.join(" ");
}

function makeTools(rng, count) {
  const tools = [];
  for (const [name, description] of CORE_TOOLS) {
    tools.push({
      name,
      description,
      input_schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        title: `${name}Input`,
        properties: {
          command: { type: "string", title: "command", description: `The  ${name.toLowerCase()}   argument`, default: "" },
          timeout: { type: "number", default: 120000, examples: [1000, 5000] },
        },
        required: ["command"],
        additionalProperties: false,
      },
    });
  }
  let i = 0;
  while (tools.length < count) {
    const server = MCP_SERVERS[i % MCP_SERVERS.length];
    const verb = ["find", "list", "read", "query", "execute", "click", "snapshot", "rename"][i % 8];
    const noun = WORDS[(i * 7) % WORDS.length];
    const name = `mcp__${server}__${verb}_${noun}`;
    const desc = `${verb} ${noun} via ${server}: ${words(rng, 12)}`;
    const props = {};
    const pn = 2 + Math.floor(rng() * 4);
    for (let p = 0; p < pn; p++) {
      const key = WORDS[Math.floor(rng() * WORDS.length)] + p;
      props[key] = {
        type: ["string", "number", "boolean"][p % 3],
        title: key,
        description: `${words(rng, 6)}  with   extra   spaces`,
        default: p % 3 === 1 ? 0 : "",
      };
    }
    tools.push({
      name,
      description: desc,
      input_schema: { type: "object", title: name, properties: props, required: Object.keys(props).slice(0, 1) },
      defer_loading: i % 5 === 0,
    });
    i++;
  }
  return tools;
}

// --- tool result content families -------------------------------------------

function gitDiff(rng, target) {
  const lines = ["diff --git a/src/ingest.rs b/src/ingest.rs", "index 3f2a1c9..9b7d4e2 100644", "--- a/src/ingest.rs", "+++ b/src/ingest.rs", "@@ -10,7 +10,9 @@ fn main() {"];
  let size = lines.join("\n").length;
  let n = 0;
  while (size < target) {
    const kind = rng();
    const l = kind < 0.35 ? `+    let ${words(rng, 1)} = ${words(rng, 4)};` : kind < 0.7 ? `-    let ${words(rng, 1)} = ${words(rng, 4)};` : `     ${words(rng, 5)}`;
    lines.push(l);
    size += l.length + 1;
    if (++n % 40 === 0) lines.push(`@@ -${n},7 +${n},9 @@ fn ${words(rng, 1)}() {`);
  }
  return lines.join("\n");
}

function grepOut(rng, target) {
  const lines = [];
  let size = 0;
  while (size < target) {
    const l = `src/${words(rng, 1)}/${words(rng, 1)}.rs:${Math.floor(rng() * 900) + 1}:    ${words(rng, 7)}`;
    lines.push(l);
    size += l.length + 1;
  }
  return lines.join("\n");
}

function numberedRead(rng, target) {
  const lines = [];
  let size = 0;
  let n = 1;
  while (size < target) {
    const l = `${String(n).padStart(6, " ")}\t${words(rng, 8)}`;
    lines.push(l);
    size += l.length + 1;
    n++;
  }
  return lines.join("\n");
}

function buildLog(rng, target) {
  const lines = ["npm warn deprecated inflight@1.0.6: This module is not supported"];
  let size = lines[0].length;
  while (size < target) {
    const l = rng() < 0.5 ? `   Compiling ${words(rng, 1)} v0.${Math.floor(rng() * 9)}.0` : `npm warn deprecated ${words(rng, 1)}@1.0.0: ${words(rng, 5)}`;
    lines.push(l);
    size += l.length + 1;
  }
  lines.push("    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.21s");
  return lines.join("\n");
}

function lsOut(rng, target) {
  const lines = ["total 128"];
  let size = 10;
  while (size < target) {
    const l = `-rw-r--r-- 1 spadon spadon ${Math.floor(rng() * 90000)} Sep  4 08:1${Math.floor(rng() * 9)} ${words(rng, 1)}.${["rs", "py", "js", "sql", "md"][Math.floor(rng() * 5)]}`;
    lines.push(l);
    size += l.length + 1;
  }
  return lines.join("\n");
}

function blob(rng, target, topic) {
  // Unstructured prose/code with the topic terms sprinkled in, so the
  // query-aware scorer sees some relevant and some irrelevant blocks.
  const parts = [];
  let size = 0;
  while (size < target) {
    const sentence = rng() < 0.3 ? `${topic} ${words(rng, 10)}.` : `${words(rng, 14)}.`;
    parts.push(sentence);
    size += sentence.length + 1;
    if (rng() < 0.15) { parts.push(""); size += 1; }
  }
  return parts.join("\n");
}

const FAMILIES = [gitDiff, grepOut, numberedRead, buildLog, lsOut, blob, blob];

// A real 1x1 PNG. Anthropic validates image bytes, so padded garbage is
// rejected upstream; the block's cost to the savers is its presence, not
// its size (contextBudget charges media flat).
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function fakePng() {
  return ONE_PIXEL_PNG;
}

/**
 * Build one session.
 *
 * @param {object} o
 * @param {number} o.seed
 * @param {number} o.rounds       assistant tool_use rounds
 * @param {number} o.toolCount    catalogue size (core tools included)
 * @param {[number,number]} o.resultBytes  min/max tool-result size
 * @param {number} o.humanEvery   a human question every N rounds
 * @param {number} o.errorEvery   every Nth result is an error result
 * @param {number} o.imageEvery   every Nth human turn carries an image
 * @param {boolean} o.thinking    assistant turns carry signed thinking blocks
 * @returns {{system:Array, tools:Array, messages:Array, metadata:object, sessionId:string}}
 */
export function buildSession(o = {}) {
  const {
    seed = 1,
    rounds = 10,
    toolCount = 48,
    resultBytes = [1500, 7000],
    humanEvery = 4,
    errorEvery = 7,
    imageEvery = 2,
    thinking = true,
    bigEvery = 5,
  } = o;
  const rng = mulberry32(seed);
  const sessionId = `session_${seed.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const tools = makeTools(rng, toolCount);
  const system = [
    { type: "text", text: `You are Claude Code, Anthropic's official CLI for Claude.\n${blob(rng, 6000, "harness")}` },
    { type: "text", text: `Environment: linux, cwd /home/spadon/Codebases/oceanstack, git branch main.\n${words(rng, 120)}`, cache_control: { type: "ephemeral" } },
  ];
  const messages = [];
  let topic = TOPICS[0];
  currentTopic = topic;
  const humanText = () => {
    const pasted = rng() < 0.5 ? `\n\n${buildLog(rng, 1500 + Math.floor(rng() * 4000))}` : "";
    return `${topic}: ${words(rng, 12)}. Please check ${tools[Math.floor(rng() * tools.length)].name} and gabriel@spadon.com.br told me ${words(rng, 5)}.${pasted}`;
  };
  messages.push({ role: "user", content: [{ type: "text", text: humanText() }] });
  let humanCount = 1;
  for (let r = 1; r <= rounds; r++) {
    // A model only calls tools it can see: mostly the core set, now and then
    // an MCP tool (the way Claude Code sessions actually run).
    const tool = rng() < 0.85
      ? tools[Math.floor(rng() * CORE_TOOLS.length)]
      : tools[Math.floor(rng() * tools.length)];
    const content = [];
    if (thinking) {
      content.push({ type: "thinking", thinking: `Considering ${topic}. ${words(rng, 60)}`, signature: "sig_" + words(rng, 1) });
    }
    content.push({ type: "text", text: `${rng() < 0.4 ? topic + " " : ""}${words(rng, 30 + Math.floor(rng() * 90))}.` });
    content.push({ type: "tool_use", id: `toolu_${seed}_${r}`, name: tool.name, input: { command: words(rng, 4) } });
    messages.push({ role: "assistant", content });

    const fam = FAMILIES[Math.floor(rng() * FAMILIES.length)];
    const target = r % bigEvery === 0
      ? 9000 + Math.floor(rng() * 6000)
      : resultBytes[0] + Math.floor(rng() * (resultBytes[1] - resultBytes[0]));
    const isError = r % errorEvery === 0;
    const text = isError
      ? `Error: ${words(rng, 6)}\n    at ${words(rng, 1)} (src/${words(rng, 1)}.rs:42)\n    at main (src/main.rs:7)\n${grepOut(rng, 900)}`
      : fam(rng, target, topic);
    const resultBlock = { type: "tool_result", tool_use_id: `toolu_${seed}_${r}`, content: [{ type: "text", text }] };
    if (isError) resultBlock.is_error = true;
    const userContent = [resultBlock];
    if (r % humanEvery === 0) {
      // Close the round with an assistant reply and open a new human turn.
      messages.push({ role: "user", content: userContent });
      messages.push({ role: "assistant", content: [{ type: "text", text: `${words(rng, 20)}.` }] });
      topic = TOPICS[humanCount % TOPICS.length];
      currentTopic = topic;
      if (humanCount % 2 === 1) {
        // A pure question/answer exchange with no tool in it: the unit the
        // pair dropper and the embedding reorder work on.
        messages.push({ role: "user", content: [{ type: "text", text: `${topic} quick question: ${words(rng, 25)}?` }] });
        messages.push({ role: "assistant", content: [{ type: "text", text: `${topic} answer: ${words(rng, 80)}.` }] });
      }
      const human = [{ type: "text", text: humanText() }];
      if (humanCount % imageEvery === 0) {
        human.push({ type: "image", source: { type: "base64", media_type: "image/png", data: fakePng() } });
      }
      humanCount++;
      messages.push({ role: "user", content: human });
    } else {
      messages.push({ role: "user", content: userContent });
    }
  }
  return {
    sessionId,
    system,
    tools,
    messages,
    metadata: { user_id: `user_${"a".repeat(64)}_account__session_${sessionId.slice(8)}` },
  };
}

/**
 * The sequence of request bodies a client sends over the life of the session:
 * one per user message, each carrying the whole history up to and including
 * that message. Client cache anchors are stamped like Claude Code does: last
 * system block, last tool, last message.
 */
export function turnBodies(session, { model = "claude-haiku-4-5", maxTokens = 4096 } = {}) {
  const out = [];
  for (let i = 0; i < session.messages.length; i++) {
    if (session.messages[i].role !== "user") continue;
    const messages = structuredClone(session.messages.slice(0, i + 1));
    const tools = structuredClone(session.tools);
    const last = messages[messages.length - 1];
    if (Array.isArray(last.content) && last.content.length) {
      last.content[last.content.length - 1].cache_control = { type: "ephemeral" };
    }
    // Claude Code anchors the last tool; a deferred tool cannot carry an
    // anchor, so the client picks the last non-deferred one.
    for (let t = tools.length - 1; t >= 0; t--) {
      if (!tools[t].defer_loading) { tools[t].cache_control = { type: "ephemeral" }; break; }
    }
    out.push({
      turn: out.length,
      messageIndex: i,
      body: {
        model,
        max_tokens: maxTokens,
        system: structuredClone(session.system),
        tools,
        messages,
        metadata: structuredClone(session.metadata),
        stream: false,
      },
    });
  }
  return out;
}
