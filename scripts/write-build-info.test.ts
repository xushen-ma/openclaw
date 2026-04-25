import * as childProcess from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  resolveVersionTagFromMergedHeadTags,
  resolveVersionTagFromTagList,
  STABLE_TAG_PATTERN,
  FORK_TAG_PATTERN,
} from "./write-build-info.js";

describe("resolveVersionTagFromTagList", () => {
  it("prefers stable tags over fork tags", () => {
    const tags = ["v2026.4.2-x.2", "v2026.4.9", "v2026.4.8", "v2026.4.2-x.1"];
    expect(resolveVersionTagFromTagList(tags)).toBe("v2026.4.9");
  });

  it("falls back to fork tags only when stable tags are unavailable", () => {
    expect(resolveVersionTagFromTagList(["release-candidate", "v2026.beta"])).toBeNull();
    expect(resolveVersionTagFromTagList(["v2026.4.2-x.1"])).toBe("v2026.4.2-x.1");
    expect(resolveVersionTagFromTagList(["v2026.4.9-x.2", "v2026.4.2-x.1"])).toBe("v2026.4.9-x.2");
  });

  it("ignores non-matching tags", () => {
    const tags = ["v2026.4.9", "release-candidate", "v2026.4.7-beta.1", "random-tag"];
    expect(resolveVersionTagFromTagList(tags)).toBe("v2026.4.9");
  });
});

describe("resolveVersionTagFromMergedHeadTags", () => {
  it("prefers stable merged tags over fork lineage tags", () => {
    const spy = vi
      .spyOn(childProcess, "execSync")
      .mockReturnValue(Buffer.from("v2026.4.15-x.4\nv2026.4.23\nv2026.4.15-x.3\n"));
    try {
      expect(resolveVersionTagFromMergedHeadTags()).toBe("v2026.4.23");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("build-info tag patterns", () => {
  it("keeps stable and fork regexes aligned", () => {
    expect(STABLE_TAG_PATTERN.test("v2026.4.9")).toBe(true);
    expect(FORK_TAG_PATTERN.test("v2026.4.2-x.1")).toBe(true);
    expect(FORK_TAG_PATTERN.test("v2026.4.2-x")).toBe(false);
    expect(FORK_TAG_PATTERN.test("v2026.4.2")).toBe(false);
  });
});
