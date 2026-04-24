import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const pkgPath = path.join(rootDir, "package.json");

const readPackageVersion = () => {
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
};

const resolveCommit = () => {
  const envCommit = process.env.GIT_COMMIT?.trim() || process.env.GIT_SHA?.trim();
  if (envCommit) {
    return envCommit;
  }
  try {
    return execSync("git rev-parse HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const isReleaseVersionCandidate = (value: string | null | undefined): value is string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  const prefixed = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  return STABLE_TAG_PATTERN.test(prefixed) || FORK_TAG_PATTERN.test(prefixed);
};

const stripVersionTagPrefix = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
};

export const FORK_TAG_PATTERN = /^v\d{4}\.\d+\.\d+(?:-\d+)?-x\.\d+$/;
export const STABLE_TAG_PATTERN = /^v\d{4}\.\d+\.\d+(?:\.\d+)?$/;

const normalizeCandidate = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function resolveVersionTagFromTagList(tags: readonly string[]): string | null {
  const candidates = tags.map((tag) => tag.trim()).filter(Boolean);
  return (
    candidates.find((tag) => STABLE_TAG_PATTERN.test(tag)) ??
    candidates.find((tag) => FORK_TAG_PATTERN.test(tag)) ??
    null
  );
}

const resolveVersionFromTagContext = () => {
  const envCandidates = [
    process.env.OPENCLAW_BUILD_VERSION,
    process.env.OPENCLAW_VERSION,
    process.env.GIT_TAG,
    process.env.CI_COMMIT_TAG,
    process.env.GITHUB_REF_NAME,
  ];
  for (const candidate of envCandidates) {
    const normalized = normalizeCandidate(candidate);
    if (isReleaseVersionCandidate(normalized)) {
      return stripVersionTagPrefix(normalized);
    }
  }

  try {
    const raw = execSync("git tag --points-at HEAD --sort=-version:refname", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const resolved = resolveVersionTagFromTagList(raw);
    return resolved === null ? null : stripVersionTagPrefix(resolved);
  } catch {
    return null;
  }
};

const packageVersion = readPackageVersion();
const version = resolveVersionFromTagContext() ?? packageVersion;
const commit = resolveCommit();

const buildInfo = {
  version,
  packageVersion: version,
  commit,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
