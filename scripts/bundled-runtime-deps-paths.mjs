import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_STATE_DIRNAMES = [".clawdbot"];
const NEW_STATE_DIRNAME = ".openclaw";

function resolveHomeDir(env = process.env, homedir = os.homedir) {
  const explicitHome = env.OPENCLAW_HOME?.trim();
  if (explicitHome && explicitHome.length > 0) {
    return explicitHome;
  }
  return homedir();
}

function resolveStateDirFromEnv(params = {}) {
  const env = params.env ?? process.env;
  if (typeof params.stateRoot === "string" && params.stateRoot.trim()) {
    return expandUserPath(params.stateRoot, env, params.homedir ?? os.homedir);
  }
  const override = env.OPENCLAW_STATE_DIR?.trim();
  const homedir = params.homedir ?? (() => resolveHomeDir(env));

  if (override) {
    return expandUserPath(override, env, homedir);
  }

  const openclawHome = resolveHomeDir(env, homedir);
  const configured = path.join(openclawHome, NEW_STATE_DIRNAME);
  if (env.OPENCLAW_TEST_FAST === "1") {
    return configured;
  }

  for (const legacyDir of LEGACY_STATE_DIRNAMES) {
    const legacyPath = path.join(openclawHome, legacyDir);
    try {
      if (fs.existsSync(legacyPath)) {
        return legacyPath;
      }
    } catch {
      continue;
    }
  }

  return configured;
}

function expandUserPath(input, env = process.env, homedir = os.homedir) {
  if (typeof input !== "string") {
    return input;
  }
  const expanded = input.trim();
  if (expanded.startsWith("~")) {
    if (expanded === "~") {
      return resolveHomeDir(env, homedir);
    }
    if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
      return path.join(resolveHomeDir(env, homedir), expanded.slice(2));
    }
  }
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

export function resolveBundledRuntimeDepsStateDir(params = {}) {
  return resolveStateDirFromEnv(params);
}

export function resolveBundledRuntimeDepsExtensionDir(params = {}) {
  const stateDir = resolveBundledRuntimeDepsStateDir(params);
  return path.join(stateDir, "bundled-runtime-deps", "extensions");
}

export function resolveBundledRuntimeDepsNodeModulesDir(params = {}) {
  const pluginId = params.pluginId;
  if (!pluginId) {
    throw new Error("pluginId is required to resolve bundled runtime deps path");
  }
  return path.join(resolveBundledRuntimeDepsExtensionDir(params), pluginId, "node_modules");
}

export function resolveBundledRuntimeDepsStampPath(params = {}) {
  const pluginId = params.pluginId;
  if (!pluginId) {
    throw new Error("pluginId is required to resolve bundled runtime deps stamp path");
  }
  return path.join(
    resolveBundledRuntimeDepsExtensionDir(params),
    pluginId,
    ".openclaw-runtime-deps-stamp.json",
  );
}
