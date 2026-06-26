import { describe, expect, it } from "vitest";
import {
  resolveVersionTagFromHeadTagList,
  resolveVersionTagFromHeadTagOutput,
} from "../../scripts/write-build-info.js";

describe("write-build-info exact HEAD tag selection", () => {
  it("prefers exact fork tags over stable tags pointing at the same commit", () => {
    expect(resolveVersionTagFromHeadTagList(["v2026.6.10", "v2026.6.10-x.1"])).toBe(
      "v2026.6.10-x.1",
    );
  });

  it("keeps the latest exact fork tag from git output", () => {
    expect(resolveVersionTagFromHeadTagOutput("v2026.6.10\nv2026.6.10-x.1\nv2026.6.10-x.2\n")).toBe(
      "v2026.6.10-x.2",
    );
  });

  it("falls back to the exact stable tag when no fork tag points at HEAD", () => {
    expect(resolveVersionTagFromHeadTagList(["v2026.6.10", "not-a-release"])).toBe("v2026.6.10");
  });
});
