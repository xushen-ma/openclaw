// Write Build Info script supports OpenClaw repository automation.
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

const STABLE_TAG_PATTERN = /^v\d{4}\.\d{1,2}\.\d{1,2}$/;
const FORK_TAG_PATTERN = /^v\d{4}\.\d{1,2}\.\d{1,2}-x\.\d+$/;

const parseReleaseTag = (tag: string) => {
  const match = /^v(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-x\.(\d+))?$/.exec(tag);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    patch: Number(match[3]),
    fork: match[4] ? Number(match[4]) : 0,
  };
};

const compareReleaseCandidates = (left: string, right: string) => {
  const parsedLeft = parseReleaseTag(left);
  const parsedRight = parseReleaseTag(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }
  return (
    parsedLeft.year - parsedRight.year ||
    parsedLeft.month - parsedRight.month ||
    parsedLeft.patch - parsedRight.patch ||
    parsedLeft.fork - parsedRight.fork
  );
};

export const resolveVersionTagFromHeadTagList = (tags: readonly string[]) => {
  const candidates = tags.map((tag) => tag.trim()).filter(Boolean);
  const latest = (matcher: RegExp) =>
    candidates
      .filter((tag) => matcher.test(tag))
      .toSorted(compareReleaseCandidates)
      .at(-1) ?? null;
  return latest(FORK_TAG_PATTERN) ?? latest(STABLE_TAG_PATTERN);
};

export const resolveVersionTagFromHeadTagOutput = (raw: string) =>
  resolveVersionTagFromHeadTagList(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

const resolveVersionTagFromHeadTags = () => {
  try {
    const raw = execSync("git tag --points-at HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return resolveVersionTagFromHeadTagOutput(raw);
  } catch {
    return null;
  }
};

const version = readPackageVersion();
const commit = resolveCommit();

const buildInfo = {
  version: resolveVersionTagFromHeadTags() ?? version,
  commit,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
