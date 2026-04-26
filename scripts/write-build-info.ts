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

export const FORK_TAG_PATTERN = /^v\d{4}\.\d+\.\d+(?:-\d+)?-x\.\d+$/;
export const STABLE_TAG_PATTERN = /^v\d{4}\.\d+\.\d+(?:\.\d+)?$/;

function normalizeReleaseCandidate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const prefixed = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  return STABLE_TAG_PATTERN.test(prefixed) || FORK_TAG_PATTERN.test(prefixed) ? prefixed : null;
}

function releaseCandidateRank(value: string): number[] {
  const stable = value.match(/^v(\d{4})\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (stable) {
    return [2, ...stable.slice(1).map((part) => Number(part ?? 0))];
  }
  const fork = value.match(/^v(\d{4})\.(\d+)\.(\d+)(?:-(\d+))?-x\.(\d+)$/);
  if (fork) {
    return [1, ...fork.slice(1).map((part) => Number(part ?? 0))];
  }
  return [0, 0, 0, 0, 0, 0];
}

export function compareReleaseCandidates(a: string, b: string): number {
  const aRank = releaseCandidateRank(a);
  const bRank = releaseCandidateRank(b);
  const length = Math.max(aRank.length, bRank.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (aRank[index] ?? 0) - (bRank[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

const normalizeCandidate = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function resolveVersionTagFromEnv(): string | null {
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
      return normalized;
    }
  }
  return null;
}

export function resolveVersionTagFromTagList(tags: readonly string[]): string | null {
  const candidates = tags.map((tag) => tag.trim()).filter(Boolean);
  return (
    candidates.find((tag) => STABLE_TAG_PATTERN.test(tag)) ??
    candidates.find((tag) => FORK_TAG_PATTERN.test(tag)) ??
    null
  );
}

export function resolveVersionTagFromMergedHeadTagOutput(raw: string): string | null {
  return resolveVersionTagFromTagList(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function resolveVersionTagFromMergedHeadTags(): string | null {
  try {
    const raw = execSync("git tag --merged HEAD --sort=-version:refname", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();

    return resolveVersionTagFromMergedHeadTagOutput(raw);
  } catch {
    return null;
  }
}

export function resolvePreferredBuildInfoVersion(
  tagVersion: string | null,
  packageVersion: string | null,
): string | null {
  const normalizedPackageVersion = normalizeReleaseCandidate(packageVersion);
  if (tagVersion && normalizedPackageVersion) {
    return compareReleaseCandidates(normalizedPackageVersion, tagVersion) > 0
      ? normalizedPackageVersion
      : tagVersion;
  }
  return tagVersion ?? normalizedPackageVersion ?? packageVersion;
}

function resolveBuildInfoVersion(): string | null {
  const explicitTagVersion = resolveVersionTagFromEnv();
  if (explicitTagVersion) {
    return explicitTagVersion;
  }
  return resolvePreferredBuildInfoVersion(
    resolveVersionTagFromMergedHeadTags(),
    readPackageVersion(),
  );
}

const version = resolveBuildInfoVersion();
const commit = resolveCommit();

const buildInfo = {
  version,
  packageVersion: readPackageVersion(),
  commit,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
