import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWindowsDrivePath } from "../infra/archive-path.js";
import { expandHomePrefix } from "../infra/home-dir.js";
import { isPathInside } from "../infra/path-guards.js";
import { assertSandboxPath, resolveSandboxInputPath } from "./sandbox-paths.js";

export type FsExtraRootMode = "ro" | "rw";

export type FsExtraRootConfig =
  | string
  | {
      path: string;
      mode?: FsExtraRootMode;
    };

export type ResolvedFsRoot = {
  path: string;
  mode: FsExtraRootMode;
};

export type FsRootAccess = "read" | "write";

function expandConfiguredRoot(rootPath: string): string {
  const home = os.homedir();
  return expandHomePrefix(rootPath.trim(), { home });
}

function isFilesystemRoot(resolved: string): boolean {
  const parsed = path.parse(resolved);
  if (process.platform === "win32") {
    return resolved.toLowerCase() === parsed.root.toLowerCase();
  }
  return resolved === parsed.root;
}

function isHomeRoot(resolved: string, homeReal: string | null): boolean {
  if (!homeReal) {
    return false;
  }
  return process.platform === "win32"
    ? resolved.toLowerCase() === homeReal.toLowerCase()
    : resolved === homeReal;
}

function isRootMode(value: unknown): value is FsExtraRootMode {
  return value === "ro" || value === "rw";
}

function parseExtraRootConfig(value: FsExtraRootConfig): { path: string; mode: FsExtraRootMode } {
  if (typeof value === "string") {
    return { path: value, mode: "ro" };
  }
  return { path: value.path, mode: isRootMode(value.mode) ? value.mode : "ro" };
}

function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

export function resolveFsExtraRoots(
  roots: readonly FsExtraRootConfig[] | undefined,
): ResolvedFsRoot[] {
  if (!roots?.length) {
    return [];
  }

  const homeReal = realpathIfExists(os.homedir());
  const deduped = new Map<string, ResolvedFsRoot>();

  for (const root of roots) {
    const parsed = parseExtraRootConfig(root);
    if (typeof parsed.path !== "string" || !parsed.path.trim() || parsed.path.includes("\0")) {
      throw new Error("tools.fs.extraRoots entries must provide a non-empty path.");
    }

    const expanded = expandConfiguredRoot(parsed.path);
    if (!path.isAbsolute(expanded) && !isWindowsDrivePath(expanded)) {
      throw new Error(`tools.fs.extraRoots path must be absolute or home-expanded: ${parsed.path}`);
    }

    const resolved = path.resolve(expanded);
    const real = fs.realpathSync(resolved);
    if (isFilesystemRoot(real)) {
      throw new Error(`tools.fs.extraRoots refuses filesystem root: ${parsed.path}`);
    }
    if (isHomeRoot(real, homeReal)) {
      throw new Error(`tools.fs.extraRoots refuses the entire home directory: ${parsed.path}`);
    }

    const existing = deduped.get(real);
    if (!existing || (existing.mode === "ro" && parsed.mode === "rw")) {
      // Keep the configured absolute spelling for boundary checks so macOS aliases
      // like /var -> /private/var do not make legitimate configured roots unusable.
      // The realpath key still de-duplicates aliases and powers root/home refusal.
      deduped.set(real, { path: resolved, mode: parsed.mode });
    }
  }

  return Array.from(deduped.values());
}

export function getAllowedFsRoots(params: {
  workspaceRoot: string;
  extraRoots?: readonly ResolvedFsRoot[];
  access: FsRootAccess;
}): ResolvedFsRoot[] {
  const roots: ResolvedFsRoot[] = [{ path: params.workspaceRoot, mode: "rw" }];
  for (const root of params.extraRoots ?? []) {
    if (params.access === "read" || root.mode === "rw") {
      roots.push(root);
    }
  }
  return roots;
}

function isAbsoluteLikeInput(filePath: string): boolean {
  const expanded = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  const homeExpanded = expandHomePrefix(expanded, { home: os.homedir() });
  return path.isAbsolute(homeExpanded) || isWindowsDrivePath(homeExpanded);
}

export async function assertPathWithinFsRoots(params: {
  filePath: string;
  cwd: string;
  workspaceRoot: string;
  allowedRoots: readonly ResolvedFsRoot[];
  boundaryLabel?: string;
  allowRoot?: boolean;
  allowFinalSymlinkForUnlink?: boolean;
  allowFinalHardlinkForUnlink?: boolean;
}): Promise<{ resolved: string; root: ResolvedFsRoot; relative: string }> {
  const errors: Error[] = [];
  const roots =
    params.allowedRoots.length > 0
      ? params.allowedRoots
      : [{ path: params.workspaceRoot, mode: "rw" as const }];

  for (const root of roots) {
    if (root.path !== params.workspaceRoot && !isAbsoluteLikeInput(params.filePath)) {
      continue;
    }
    try {
      const resolved = await assertSandboxPath({
        filePath: params.filePath,
        cwd: root.path === params.workspaceRoot ? params.cwd : params.workspaceRoot,
        root: root.path,
        allowFinalSymlinkForUnlink: params.allowFinalSymlinkForUnlink,
        allowFinalHardlinkForUnlink: params.allowFinalHardlinkForUnlink,
      });
      if (!params.allowRoot && !resolved.relative) {
        const label =
          params.boundaryLabel ??
          (roots.length === 1 && roots[0]?.path === params.workspaceRoot
            ? "sandbox root"
            : "allowed filesystem roots");
        throw new Error(`Path escapes ${label}: ${params.filePath}`);
      }
      return { ...resolved, root };
    } catch (err) {
      errors.push(err as Error);
    }
  }

  const label =
    params.boundaryLabel ??
    (roots.length === 1 && roots[0]?.path === params.workspaceRoot
      ? "sandbox root"
      : "allowed filesystem roots");
  const first = errors.find((err) =>
    /hardlink|symlink|alias|not allowed|not a regular file/i.test(err.message),
  );
  throw new Error(first?.message ?? `Path escapes ${label}: ${params.filePath}`);
}

export function relativePathWithinResolvedRoot(params: {
  root: string;
  absolutePath: string;
  allowRoot?: boolean;
}): string {
  const rootResolved = path.resolve(params.root);
  const candidate = path.resolve(params.absolutePath);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate === rootResolved) {
    if (params.allowRoot) {
      return "";
    }
    throw new Error(`Path escapes allowed filesystem roots: ${params.absolutePath}`);
  }
  if (!isPathInside(rootWithSep, candidate)) {
    throw new Error(`Path escapes allowed filesystem roots: ${params.absolutePath}`);
  }
  return path.relative(rootResolved, candidate);
}

export function resolveDisplayPath(filePath: string, workspaceRoot: string): string {
  const resolved = resolveSandboxInputPath(filePath, workspaceRoot);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative === "") {
    return path.basename(resolved);
  }
  return relative.startsWith("..") || path.isAbsolute(relative) ? resolved : relative;
}
