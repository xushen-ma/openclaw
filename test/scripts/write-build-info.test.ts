import { describe, expect, it } from "vitest";
import {
  resolveVersionTagFromHeadTagList,
  resolveVersionTagFromHeadTagOutput,
  resolveVersionTagFromMergedHeadTagOutput,
  resolveVersionTagFromTagList,
} from "../../scripts/write-build-info.js";

describe("write-build-info exact HEAD tag selection", () => {
  it("prefers exact fork tags over stable tags pointing at the same commit", () => {
    expect(resolveVersionTagFromHeadTagList(["v2026.5.26", "v2026.5.26-x.1"])).toBe(
      "v2026.5.26-x.1",
    );
  });

  it("keeps the latest exact fork tag from git output", () => {
    expect(resolveVersionTagFromHeadTagOutput("v2026.5.26\nv2026.5.26-x.1\nv2026.5.26-x.2\n")).toBe(
      "v2026.5.26-x.2",
    );
  });

  it("still preserves stable merged-tag fallback ordering", () => {
    expect(
      resolveVersionTagFromMergedHeadTagOutput("v2026.4.15-x.4\nv2026.4.23\nv2026.4.15-x.3\n"),
    ).toBe("v2026.4.23");
    expect(resolveVersionTagFromTagList(["v2026.4.2-x.2", "v2026.4.9"])).toBe("v2026.4.9");
  });
});
