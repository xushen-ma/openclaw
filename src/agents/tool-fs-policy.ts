/**
 * Tool filesystem policy resolver.
 *
 * Combines global and agent fs/tool policy into workspace-only and root-expansion decisions.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { FsToolsConfig } from "../config/types.tools.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { pickSandboxToolPolicy } from "./sandbox-tool-policy.js";
import type { ToolFsExtraRoot, ToolFsPolicy } from "./tool-fs-policy.types.js";
import { isToolAllowedByPolicies } from "./tool-policy-match.js";
import { mergeAlsoAllowPolicy, resolveToolProfilePolicy } from "./tool-policy.js";

export type { ToolFsPolicy } from "./tool-fs-policy.types.js";

type FsExtraRootConfig = NonNullable<FsToolsConfig["extraRoots"]>[number];

function normalizeExtraRoot(entry: FsExtraRootConfig): ToolFsExtraRoot | undefined {
  if (typeof entry === "string") {
    const value = entry.trim();
    return value ? { path: value, mode: "rw" } : undefined;
  }
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const value = typeof entry.path === "string" ? entry.path.trim() : "";
  if (!value) {
    return undefined;
  }
  return {
    path: value,
    mode: entry.mode === "ro" ? "ro" : "rw",
  };
}

function mergeExtraRoots(
  globalRoots?: readonly FsExtraRootConfig[],
  agentRoots?: readonly FsExtraRootConfig[],
): ToolFsExtraRoot[] {
  const merged = [...(globalRoots ?? []), ...(agentRoots ?? [])];
  const result: ToolFsExtraRoot[] = [];
  const seen = new Set<string>();
  for (const root of merged) {
    const normalized = normalizeExtraRoot(root);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.mode}:${normalized.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function createToolFsPolicy(params: {
  workspaceOnly?: boolean;
  extraRoots?: ToolFsExtraRoot[];
}): ToolFsPolicy {
  const policy: ToolFsPolicy = {
    workspaceOnly: params.workspaceOnly === true,
  };
  if (params.extraRoots && params.extraRoots.length > 0) {
    policy.extraRoots = params.extraRoots;
  }
  return policy;
}

export function resolveToolFsConfig(params: { cfg?: OpenClawConfig; agentId?: string }): {
  workspaceOnly?: boolean;
  extraRoots: ToolFsExtraRoot[];
} {
  const cfg = params.cfg;
  const globalFs = cfg?.tools?.fs;
  const agentFs =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;
  return {
    workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
    extraRoots: mergeExtraRoots(globalFs?.extraRoots, agentFs?.extraRoots),
  };
}

export function resolveEffectiveToolFsWorkspaceOnly(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  return resolveToolFsConfig(params).workspaceOnly === true;
}

export function resolveEffectiveToolFsRootExpansionAllowed(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  const cfg = params.cfg;
  if (!cfg) {
    return true;
  }
  const agentTools = params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools : undefined;
  const globalTools = cfg.tools;
  const profile = agentTools?.profile ?? globalTools?.profile;
  const profileAlsoAllow = new Set(agentTools?.alsoAllow ?? globalTools?.alsoAllow ?? []);
  const fsConfig = resolveToolFsConfig(params);
  if (fsConfig.workspaceOnly === true) {
    return false;
  }
  // tools.fs presence does not grant access; require profile or alsoAllow (#47487).
  const profilePolicy = mergeAlsoAllowPolicy(
    resolveToolProfilePolicy(profile),
    profileAlsoAllow.size > 0 ? Array.from(profileAlsoAllow) : undefined,
  );
  const globalPolicy = pickSandboxToolPolicy(globalTools);
  const agentPolicy = pickSandboxToolPolicy(agentTools);
  return isToolAllowedByPolicies("read", [profilePolicy, globalPolicy, agentPolicy]);
}
