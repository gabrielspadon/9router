import fs from "fs/promises";

/**
 * Read a CLI tool's own config file so it can be merged and written back.
 *
 * Returns `null` when the file does not exist, or when it exists but holds
 * nothing — both are the legitimate "start fresh" case. **Everything else
 * throws.** A malformed file, a permission error, a directory where a file was
 * expected: those are not an empty config.
 *
 * The distinction matters because callers merge a few fields into whatever comes
 * back and then write the result over the user's file. Treating an unreadable file
 * as `{}` silently replaces it — for `~/.codex/auth.json` that discards the ChatGPT
 * OAuth tokens the merge is explicitly trying to preserve, and for `config.toml` it
 * discards every provider, MCP server and approval policy the user had.
 *
 * @param {string} filePath
 * @param {(raw: string) => unknown} parse  parser for this file's format
 * @returns {Promise<unknown|null>} parsed contents, or null if absent
 */
export async function readExistingConfig(filePath, parse) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  try {
    return parse(raw);
  } catch (error) {
    // A file holding no bytes has nothing for the refusal to protect, and
    // `JSON.parse("")` throws. Every writer here truncates before it writes, so
    // an apply interrupted mid-write leaves a 0-byte `auth.json` that then
    // blocks every later apply with "refusing to overwrite it" until the user
    // deletes the file by hand. Whitespace-only counts as empty; one byte of
    // real content still raises.
    if (raw.trim() === "") return null;
    const reason = error?.message || String(error);
    throw new Error(`${filePath} exists but could not be parsed (${reason}); refusing to overwrite it`);
  }
}
