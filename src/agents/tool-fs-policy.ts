/**
 * Tool filesystem policy resolver.
 *
 * Combines global and agent fs/tool policy into workspace-only and root-expansion decisions.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { FsToolsConfig } from "../config/types.tools.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { pickSandboxToolPolicy } from "./sandbox-tool-policy.js";
import { getSandboxHostPathPolicyKey, isSandboxHostPathAbsolute } from "./sandbox/host-paths.js";
import type { ToolFsExtraRoot } from "./tool-fs-policy.types.js";
import { isToolAllowedByPolicies } from "./tool-policy-match.js";
import { mergeAlsoAllowPolicy, resolveToolProfilePolicy } from "./tool-policy.js";

export type {
  PreparedSessionPermissionPolicy,
  ToolFsExtraRoot,
  ToolFsPolicy,
} from "./tool-fs-policy.types.js";
export { resolveSessionPermissionExecMode } from "./session-permission-exec-mode.js";

type FsExtraRootConfig = NonNullable<FsToolsConfig["extraRoots"]>[number];

function normalizeExtraRoot(entry: FsExtraRootConfig): ToolFsExtraRoot {
  const rootPath = typeof entry?.path === "string" ? entry.path.trim() : "";
  if (!rootPath || !isSandboxHostPathAbsolute(rootPath)) {
    throw new Error("tools.fs.extraRoots entries require a non-empty absolute path");
  }
  if (entry.mode !== "ro" && entry.mode !== "rw") {
    throw new Error(`tools.fs.extraRoots entry for ${rootPath} requires mode "ro" or "rw"`);
  }
  return { path: rootPath, mode: entry.mode };
}

function mergeExtraRoots(
  globalRoots?: readonly FsExtraRootConfig[],
  agentRoots?: readonly FsExtraRootConfig[],
): ToolFsExtraRoot[] {
  const result: ToolFsExtraRoot[] = [];
  const seen = new Map<string, ToolFsExtraRoot>();
  for (const entry of [...(globalRoots ?? []), ...(agentRoots ?? [])]) {
    const normalized = normalizeExtraRoot(entry);
    const key = getSandboxHostPathPolicyKey(normalized.path);
    const priorEntry = Array.from(seen.entries()).find(
      ([priorKey]) =>
        priorKey === key ||
        priorKey.startsWith(key.endsWith("/") ? key : `${key}/`) ||
        key.startsWith(priorKey.endsWith("/") ? priorKey : `${priorKey}/`),
    );
    const prior = priorEntry?.[1];
    if (prior) {
      if (priorEntry?.[0] === key && prior.mode === normalized.mode) {
        throw new Error(`Duplicate tools.fs.extraRoots path: ${normalized.path}`);
      }
      if (prior.mode !== normalized.mode) {
        throw new Error(
          `Conflicting overlapping tools.fs.extraRoots modes for path: ${normalized.path}`,
        );
      }
      throw new Error(`Overlapping tools.fs.extraRoots paths are redundant: ${normalized.path}`);
    }
    seen.set(key, normalized);
    result.push(normalized);
  }
  return result;
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
