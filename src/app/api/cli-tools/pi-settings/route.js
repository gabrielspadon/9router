"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";
import {
  PROVIDER_KEY,
  getPiConfigDir,
  getPiConfigPath,
  getTokenProxyModelIds,
  hasTokenProxy,
  mergePiProvider,
  removePiProvider,
} from "@/lib/cliTools/piConfig";

const execAsync = promisify(exec);

// Same detection shape as opencode-settings: the binary on PATH, else the
// config file, so a Pi installed outside the server's PATH still shows up.
const checkPiInstalled = async () => {
  try {
    const isWindows = process.platform === "win32";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(isWindows ? "where pi" : "which pi", { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getPiConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read-only path: an unparseable file must not read as "Pi is not installed",
// so this one tolerates what the write path refuses.
const readConfigForDisplay = async () => {
  try {
    return JSON.parse(await fs.readFile(getPiConfigPath(), "utf-8"));
  } catch {
    return null;
  }
};

// GET - Detect Pi and report the current TokenProxy provider entry
export async function GET() {
  try {
    if (!(await checkPiInstalled())) {
      return NextResponse.json({ installed: false, config: null, message: "Pi is not installed" });
    }

    const config = await readConfigForDisplay();
    const provider = config?.providers?.[PROVIDER_KEY];

    return NextResponse.json({
      installed: true,
      config,
      hasTokenProxy: hasTokenProxy(config),
      configPath: getPiConfigPath(),
      pi: {
        models: getTokenProxyModelIds(config),
        baseURL: provider?.baseUrl || null,
      },
    });
  } catch (error) {
    console.log("Error checking pi settings:", error);
    return NextResponse.json({ error: "Failed to check pi settings" }, { status: 500 });
  }
}

// POST - Merge TokenProxy into ~/.pi/agent/models.json
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models } = await request.json();
    const modelsArray = Array.isArray(models) ? models : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configPath = getPiConfigPath();
    await fs.mkdir(getPiConfigDir(), { recursive: true });

    // The whole file is written back below, so a file that exists but cannot be
    // parsed must NOT be treated as empty — that would discard every other
    // provider the user configured in Pi.
    const existing = await readExistingConfig(configPath, JSON.parse);
    const config = mergePiProvider(existing, { baseUrl, apiKey, models: modelsArray });

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Pi settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying pi settings:", error);
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to apply pi settings" },
      { status: 500 }
    );
  }
}

// DELETE - Remove one model, or the whole TokenProxy provider
export async function DELETE(request) {
  try {
    const configPath = getPiConfigPath();
    const modelToRemove = new URL(request.url).searchParams.get("model");

    let existing;
    try {
      existing = await readExistingConfig(configPath, JSON.parse);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (existing === null) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    await fs.writeFile(configPath, JSON.stringify(removePiProvider(existing, modelToRemove), null, 2));

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "TokenProxy removed from Pi config",
    });
  } catch (error) {
    console.log("Error resetting pi settings:", error);
    return NextResponse.json({ error: "Failed to reset pi settings" }, { status: 500 });
  }
}
