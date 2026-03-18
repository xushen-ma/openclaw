import { describe, expect, it } from "vitest";
import {
  canonicalSparkleBuildFromVersion,
  sparkleBuildFloorsFromShortVersion,
} from "../scripts/sparkle-build.ts";

describe("sparkle-build", () => {
  it("accepts calver strings with a leading v", () => {
    expect(canonicalSparkleBuildFromVersion("v2026.3.13")).toBe(2026031390);
  });

  it("accepts governed hotfix tag-like versions", () => {
    const floors = sparkleBuildFloorsFromShortVersion("v2026.3.13-1-x.3");
    expect(floors).toMatchObject({
      dateKey: 20260313,
      lane: 3,
      laneFloor: 2026031303,
    });
  });
});
