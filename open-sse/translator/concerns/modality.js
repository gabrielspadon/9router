// Strip multimodal content blocks a model cannot read, BEFORE translation.
// Driven by getCapabilitiesForModel: vision/audioInput/pdf. Replaces removed
// media with a short text placeholder so messages never become empty.
import { FORMATS } from "../formats.js";

// Placeholder text inserted where a media block was removed.
// Current turn: explain the active model can't read what the user just sent.
const PLACEHOLDER_CURRENT = {
  vision: "[image omitted: model has no vision support]",
  audioInput: "[audio omitted: model has no audio support]",
  pdf: "[file omitted: model has no document support]",
};
// Earlier turns: neutral (a combo may route to a different model each turn).
const PLACEHOLDER_PREV = {
  vision: "[Previous image omitted from context.]",
  audioInput: "[Previous audio omitted from context.]",
  pdf: "[Previous file omitted from context.]",
};
const ph = (cap, isLast) => (isLast ? PLACEHOLDER_CURRENT : PLACEHOLDER_PREV)[cap];

// Map gemini inlineData/fileData mime prefix -> capability it requires.
function capForMime(mime) {
  if (typeof mime !== "string") return null;
  if (mime.startsWith("image/")) return "vision";
  if (mime.startsWith("audio/")) return "audioInput";
  if (mime === "application/pdf") return "pdf";
  return null;
}

// Mime a file/document/input_file block carries, from the same four sources and
// in the same order as detectRequiredCapabilities in services/combo.js. Routing
// picks the model from THAT inference, so inferring differently here strips
// media the router deliberately routed to a model able to read it.
function fileBlockMime(block) {
  if (block?.input_audio?.format) return `audio/${block.input_audio.format}`;
  if (block?.file?.file_data) return String(block.file.file_data).match(/^data:([^;,]+)/)?.[1] || null;
  if (block?.source?.media_type) return block.source.media_type;
  if (block?.source?.data) return String(block.source.data).match(/^data:([^;,]+)/)?.[1] || null;
  return null;
}

// The block TYPE says "document"; the mime inside says what it really is. A
// client that ships an image as a file block (data:image/png in file.file_data)
// was routed to a vision model by combo.js and then had the image removed here
// as a document, because pdf is false on every model but one — so the image
// never reached the model that was chosen to read it (#1302, #1201). Unknown or
// absent mime keeps the old answer, which is also combo.js's fallback.
const capForFileBlock = (block) => capForMime(fileBlockMime(block)) || "pdf";

// OpenAI chat content block -> required capability (null = plain text/other, keep).
// input_image / input_file appear here as well as in the Responses shapes below:
// combo.js scans for them on chat messages, so not stripping them here left an
// image on a request routed to a model that cannot read one.
function capForOpenAIBlock(block) {
  const t = block?.type;
  if (t === "image_url" || t === "image" || t === "input_image") return "vision";
  if (t === "input_audio" || t === "audio_url") return "audioInput";
  if (t === "file" || t === "input_file") return capForFileBlock(block);
  return null;
}

// Claude content block -> required capability.
function capForClaudeBlock(block) {
  const t = block?.type;
  if (t === "image") return "vision";
  if (t === "document") return capForFileBlock(block);
  return null;
}

// Filter an array of content blocks; drop unsupported, inject one placeholder per kind.
// isLast = block belongs to the current user turn (picks the explanatory placeholder).
function filterBlocks(blocks, capOf, caps, removed, isLast) {
  const out = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) { removed.add(cap); continue; }
    out.push(block);
  }
  for (const cap of removed) out.push({ type: "text", text: ph(cap, isLast) });
  return out;
}

// OpenAI / OpenAI-compatible chat messages[].content[].
// Returns true when at least one block or attachment was actually dropped.
function stripOpenAI(body, caps) {
  if (!Array.isArray(body.messages)) return false;
  let hit = false;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (caps.vision === false) {
      if (Array.isArray(msg.images)) { if (msg.images.length) hit = true; delete msg.images; }
      // Some OpenAI-compatible clients hang the image off the message rather
      // than a content block. combo.js counts those toward the vision
      // requirement, so leaving them here handed an image to a model with no
      // vision and turned a clean placeholder into an upstream 400 (#1269).
      if (msg.image_url !== undefined) { hit = true; delete msg.image_url; }
      if (msg.image !== undefined) { hit = true; delete msg.image; }
      for (const key of ["experimental_attachments", "attachments"]) {
        if (!Array.isArray(msg[key])) continue;
        const kept = msg[key].filter(
          (a) => !(a?.contentType?.startsWith("image/") || (typeof a?.url === "string" && a.url.startsWith("data:image/")))
        );
        if (kept.length !== msg[key].length) hit = true;
        msg[key] = kept;
      }
    }
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForOpenAIBlock, caps, removed, i === last);
    if (removed.size) hit = true;
  });
  return hit;
}

// Claude messages[].content[].
function stripClaude(body, caps) {
  if (!Array.isArray(body.messages)) return false;
  let hit = false;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForClaudeBlock, caps, removed, i === last);
    if (removed.size) hit = true;
  });
  return hit;
}

// OpenAI Responses input[].content[] (input_image / input_file).
function stripResponses(body, caps) {
  if (!Array.isArray(body.input)) return false;
  let hit = false;
  const last = body.input.length - 1;
  body.input.forEach((item, i) => {
    if (!Array.isArray(item.content)) return;
    const removed = new Set();
    item.content = item.content.filter((b) => {
      const cap = capForOpenAIBlock(b);
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      return true;
    });
    for (const cap of removed) item.content.push({ type: "input_text", text: ph(cap, i === last) });
    if (removed.size) hit = true;
  });
  return hit;
}

// Gemini / gemini-cli contents[].parts[] (inlineData / fileData by mime).
function stripGeminiParts(contents, caps) {
  if (!Array.isArray(contents)) return false;
  let hit = false;
  const last = contents.length - 1;
  contents.forEach((c, i) => {
    if (!Array.isArray(c.parts)) return;
    const removed = new Set();
    c.parts = c.parts.filter((p) => {
      const mime = p?.inlineData?.mimeType || p?.fileData?.mimeType;
      const cap = capForMime(mime);
      if (cap && caps[cap] === false) { removed.add(cap); return false; }
      return true;
    });
    for (const cap of removed) c.parts.push({ text: ph(cap, i === last) });
    if (removed.size) hit = true;
  });
  return hit;
}

/**
 * Remove media blocks the model can't read, in-place on the source-format body.
 * @param {object} body - request body (source format)
 * @param {string} sourceFormat - one of FORMATS
 * @param {object} caps - capabilities from getCapabilitiesForModel
 * @returns {boolean} true if at least one media block was actually removed.
 *   The caller logs "stripped unsupported media" on this, so answering the
 *   weaker question ("is some modality unsupported?") logged a strip on every
 *   text-only turn to a text-only model (#2068).
 */
export function stripUnsupportedModalities(body, sourceFormat, caps) {
  if (!body || !caps) return false;
  // Fast exit: model supports everything we'd strip.
  if (caps.vision !== false && caps.audioInput !== false && caps.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.CLAUDE:
      return stripClaude(body, caps);
    case FORMATS.OPENAI_RESPONSES:
      return stripResponses(body, caps);
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      return stripGeminiParts(body.contents, caps);
    case FORMATS.ANTIGRAVITY:
      return stripGeminiParts(body?.request?.contents, caps);
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
    default:
      return stripOpenAI(body, caps);
  }
}
