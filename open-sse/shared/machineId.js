import crypto from "node:crypto";
import { createRequire } from "node:module";

const runtimeRequire = typeof require === "function"
  ? require
  : createRequire(import.meta.url);
const { machineIdSync } = runtimeRequire("node-machine-id");

let cachedRawId = null;

function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = machineIdSync();
  } catch {
    cachedRawId = crypto.randomUUID();
  }
  return cachedRawId;
}

export async function getConsistentMachineId(salt = "endpoint-proxy-salt") {
  const rawId = loadRawMachineId();
  return crypto.createHash("sha256").update(rawId + salt).digest("hex").substring(0, 16);
}
