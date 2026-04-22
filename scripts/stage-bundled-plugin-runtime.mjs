import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBundledRuntimeDepsNodeModulesDir } from "./bundled-runtime-deps-paths.mjs";
import { removePathIfExists } from "./runtime-postbuild-shared.mjs";

function symlinkType() {
  return process.platform === "win32" ? "junction" : "dir";
}

function relativeSymlinkTarget(sourcePath, targetPath) {
  const relativeTarget = path.relative(path.dirname(targetPath), sourcePath);
  return relativeTarget || ".";
}

function shouldFallbackToCopy(error) {
  return (
    process.platform === "win32" &&
    (error?.code === "EPERM" || error?.code === "EINVAL" || error?.code === "UNKNOWN")
  );
}

function copyPathFallback(sourcePath, targetPath) {
  removePathIfExists(targetPath);
  const stat = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    return;
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureSymlink(targetValue, targetPath, type, fallbackSourcePath) {
  try {
    fs.symlinkSync(targetValue, targetPath, type);
    return;
  } catch (error) {
    if (fallbackSourcePath && shouldFallbackToCopy(error)) {
      copyPathFallback(fallbackSourcePath, targetPath);
      return;
    }
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  try {
    if (fs.lstatSync(targetPath).isSymbolicLink() && fs.readlinkSync(targetPath) === targetValue) {
      return;
    }
  } catch {
    // Fall through and recreate the target when inspection fails.
  }

  removePathIfExists(targetPath);
  try {
    fs.symlinkSync(targetValue, targetPath, type);
  } catch (error) {
    if (fallbackSourcePath && shouldFallbackToCopy(error)) {
      copyPathFallback(fallbackSourcePath, targetPath);
      return;
    }
    throw error;
  }
}

function symlinkPath(sourcePath, targetPath, type) {
  ensureSymlink(relativeSymlinkTarget(sourcePath, targetPath), targetPath, type, sourcePath);
}

function shouldCopyRuntimeJsFile(sourcePath) {
  return path.extname(sourcePath) === ".js";
}

function shouldCopyRuntimeFile(sourcePath) {
  const relativePath = sourcePath.replace(/\\/g, "/");
  return (
    relativePath.endsWith("/package.json") ||
    relativePath.endsWith("/openclaw.plugin.json") ||
    relativePath.endsWith("/.codex-plugin/plugin.json") ||
    relativePath.endsWith("/.claude-plugin/plugin.json") ||
    relativePath.endsWith("/.cursor-plugin/plugin.json") ||
    relativePath.endsWith("/SKILL.md")
  );
}

function resolvePluginRuntimeNodeModulesDir(params) {
  const stateNodeModulesDir = resolveBundledRuntimeDepsNodeModulesDir({
    pluginId: params.pluginId,
    stateRoot: params.stateRoot,
  });
  if (fs.existsSync(stateNodeModulesDir)) {
    return stateNodeModulesDir;
  }
  return params.distPluginNodeModulesDir;
}

function resolveSharedRuntimeNodeModulesDir(params) {
  const bundledRuntimeDepsRoot = params.stateRoot
    ? path.join(params.stateRoot, "bundled-runtime-deps")
    : null;
  if (bundledRuntimeDepsRoot) {
    const directNodeModulesDir = path.join(bundledRuntimeDepsRoot, "node_modules");
    if (fs.existsSync(directNodeModulesDir)) {
      return directNodeModulesDir;
    }
    const bundledRuntimeDepsExtensionsRoot = path.join(bundledRuntimeDepsRoot, "extensions");
    if (fs.existsSync(bundledRuntimeDepsExtensionsRoot)) {
      const candidateNodeModulesDirs = fs
        .readdirSync(bundledRuntimeDepsExtensionsRoot, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => path.join(bundledRuntimeDepsExtensionsRoot, dirent.name, "node_modules"))
        .filter((nodeModulesDir) => fs.existsSync(nodeModulesDir));
      if (candidateNodeModulesDirs.length > 0) {
        return candidateNodeModulesDirs[0];
      }
    }
  }
  return path.join(params.repoRoot, "node_modules");
}

function stagePluginRuntimeOverlay(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const dirent of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (dirent.name === "node_modules") {
      continue;
    }

    const sourcePath = path.join(sourceDir, dirent.name);
    const targetPath = path.join(targetDir, dirent.name);

    if (dirent.isDirectory()) {
      stagePluginRuntimeOverlay(sourcePath, targetPath);
      continue;
    }

    if (dirent.isSymbolicLink()) {
      ensureSymlink(fs.readlinkSync(sourcePath), targetPath, undefined, sourcePath);
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    if (shouldCopyRuntimeJsFile(sourcePath) || shouldCopyRuntimeFile(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      continue;
    }

    symlinkPath(sourcePath, targetPath);
  }
}

function stageSharedDistRuntimeOverlay(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const dirent of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (dirent.name === "extensions") {
      continue;
    }

    const sourcePath = path.join(sourceDir, dirent.name);
    const targetPath = path.join(targetDir, dirent.name);

    if (dirent.isDirectory()) {
      stageSharedDistRuntimeOverlay(sourcePath, targetPath);
      continue;
    }

    if (dirent.isSymbolicLink()) {
      ensureSymlink(fs.readlinkSync(sourcePath), targetPath, undefined, sourcePath);
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    if (shouldCopyRuntimeJsFile(sourcePath) || shouldCopyRuntimeFile(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      continue;
    }

    symlinkPath(sourcePath, targetPath);
  }
}

function linkRuntimeNodeModules(params) {
  removePathIfExists(params.runtimeNodeModulesDir);
  if (!fs.existsSync(params.sourceNodeModulesDir)) {
    return;
  }
  ensureSymlink(
    params.sourceNodeModulesDir,
    params.runtimeNodeModulesDir,
    symlinkType(),
    params.sourceNodeModulesDir,
  );
}

export function stageBundledPluginRuntime(params = {}) {
  const repoRoot = params.cwd ?? params.repoRoot ?? process.cwd();
  const stateRoot = params.stateRoot?.trim() || process.env.OPENCLAW_STATE_DIR?.trim() || null;
  const distRoot = path.join(repoRoot, "dist");
  const runtimeRoot =
    params.runtimeRoot ??
    (stateRoot
      ? path.join(stateRoot, "bundled-plugin-runtime")
      : path.join(repoRoot, "dist-runtime"));
  const distExtensionsRoot = path.join(distRoot, "extensions");
  const runtimeExtensionsRoot = path.join(runtimeRoot, "extensions");

  if (!fs.existsSync(distExtensionsRoot)) {
    removePathIfExists(runtimeRoot);
    return;
  }

  removePathIfExists(runtimeRoot);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  stageSharedDistRuntimeOverlay(distRoot, runtimeRoot);
  linkRuntimeNodeModules({
    runtimeNodeModulesDir: path.join(runtimeRoot, "node_modules"),
    sourceNodeModulesDir: resolveSharedRuntimeNodeModulesDir({ repoRoot, stateRoot }),
  });
  fs.mkdirSync(runtimeExtensionsRoot, { recursive: true });

  for (const dirent of fs.readdirSync(distExtensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const distPluginDir = path.join(distExtensionsRoot, dirent.name);
    const runtimePluginDir = path.join(runtimeExtensionsRoot, dirent.name);
    const distPluginNodeModulesDir = path.join(distPluginDir, "node_modules");
    const runtimeNodeModulesDir = resolvePluginRuntimeNodeModulesDir({
      distPluginNodeModulesDir,
      pluginId: dirent.name,
      stateRoot,
    });

    stagePluginRuntimeOverlay(distPluginDir, runtimePluginDir);
    linkRuntimeNodeModules({
      runtimeNodeModulesDir: path.join(runtimePluginDir, "node_modules"),
      sourceNodeModulesDir: runtimeNodeModulesDir,
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  stageBundledPluginRuntime({ stateRoot: process.env.OPENCLAW_STATE_DIR });
}
