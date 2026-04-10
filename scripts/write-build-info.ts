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
    if (normalized) {
      return normalized;
    }
  }

  try {
    const raw = execSync("git tag --merged HEAD --sort=-version:refname", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
    .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return resolveVersionTagFromTagList(raw);
  } catch {
    return null;
  }
};

const version = resolveVersionFromTagContext() ?? readPackageVersion();
const commit = resolveCommit();

const buildInfo = {
  version,
  packageVersion: readPackageVersion(),
  commit,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
