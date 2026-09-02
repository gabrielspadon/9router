"use server";

import { NextResponse } from "next/server";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";
import { migrateLegacyCodexHooks } from "@/shared/utils/codexConfig";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has TokenProxy settings
const hasTokenProxyConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"tokenproxy\"") || config.includes("[model_providers.tokenproxy]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      hasTokenProxy: hasTokenProxyConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update TokenProxy settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config. A file that exists but cannot be read or
    // parsed must NOT be treated as empty: the merge below writes the result back,
    // so that would replace every provider, MCP server and policy the user had.
    const existingConfig = await readExistingConfig(configPath, (raw) => parsedToWritable(parseTOML(raw)));
    let parsed = existingConfig ?? {};
    parsed = migrateLegacyCodexHooks(parsed);

    // Update only TokenProxy related fields
    parsed.model = model;
    parsed.model_provider = "tokenproxy";

    // Update or create tokenproxy provider section.
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    // A custom model provider never reads auth.json — Codex authenticates it
    // from env_key, http_headers, env_http_headers or a token command only, so
    // the key has to travel as a static header or every request is a 401.
    setNestedSection(parsed, "model_providers.tokenproxy", {
      name: "TokenProxy",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || model;
    // Recent Codex CLI versions refuse a role with no description and log
    // "agent role `subagent` must define a description", so the section TokenProxy
    // wrote was ignored and the subagent silently fell back (#1454). `model`
    // stays first because the dashboard card parses this section by regex.
    setNestedSection(parsed, "agents.subagent", {
      model: effectiveSubagentModel,
      description: "General-purpose subagent routed through TokenProxy.",
    });

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Keep auth.json in step too: it is what the BUILT-IN openai provider reads,
    // which is where a user lands when they switch model_provider back.
    const authPath = getCodexAuthPath();
    // Same rule as above, and here it is the ChatGPT OAuth tokens that a silent
    // "treat it as empty" would discard — the very thing the next lines preserve.
    const authData = (await readExistingConfig(authPath, JSON.parse)) ?? {};
    
    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    // Surface the one failure the user can act on — a config file of theirs that
    // cannot be parsed — and keep everything else generic.
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to update codex settings" },
      { status: 500 }
    );
  }
}

// DELETE - Remove TokenProxy settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
      parsed = migrateLegacyCodexHooks(parsed);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove TokenProxy related root fields only if they point to tokenproxy
    if (parsed.model_provider === "tokenproxy") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove tokenproxy provider section
    deleteNestedSection(parsed, "model_providers.tokenproxy");

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "TokenProxy settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
