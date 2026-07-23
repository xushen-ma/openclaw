// Write Build Info script supports OpenClaw repository automation.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRootDir = path.resolve(path.dirname(scriptPath), "..");
const FORK_HEAD_TAG_PATTERN = /^v(\d{4})\.(\d{1,2})\.(\d{1,2})-x\.(\d+)$/u;

export const readPackageVersion = (rootDir = defaultRootDir) => {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
};

type ForkTagParts = {
  tag: string;
  version: string;
  year: number;
  month: number;
  day: number;
  fork: number;
};

function parseForkHeadTag(tag: string): ForkTagParts | null {
  const match = FORK_HEAD_TAG_PATTERN.exec(tag.trim());
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return null;
  }
  return {
    tag,
    version: tag.slice(1),
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    fork: Number.parseInt(match[4], 10),
  };
}

function compareForkTags(a: ForkTagParts, b: ForkTagParts): number {
  return (
    a.year - b.year ||
    a.month - b.month ||
    a.day - b.day ||
    a.fork - b.fork ||
    a.tag.localeCompare(b.tag)
  );
}

export const resolveHeadForkVersion = (rootDir = defaultRootDir) => {
  try {
    const raw = execSync("git tag --points-at HEAD --list 'v[0-9]*.[0-9]*.[0-9]*-x.*'", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const matches = raw
      .split(/\r?\n/u)
      .map(parseForkHeadTag)
      .filter((tag): tag is ForkTagParts => Boolean(tag))
      .toSorted(compareForkTags);
    return matches.at(-1)?.version ?? null;
  } catch {
    return null;
  }
};

export const resolveBuildInfoVersion = (rootDir = defaultRootDir) =>
  resolveHeadForkVersion(rootDir) ?? readPackageVersion(rootDir);

export const resolveCommit = (rootDir = defaultRootDir) => {
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

export function writeBuildInfo(rootDir = defaultRootDir): void {
  const distDir = path.join(rootDir, "dist");
  const version = resolveBuildInfoVersion(rootDir);
  const commit = resolveCommit(rootDir);

  const buildInfo = {
    version,
    commit,
    builtAt: new Date().toISOString(),
  };

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(distDir, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  writeBuildInfo();
}
