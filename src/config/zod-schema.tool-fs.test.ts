import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

const absoluteRoot = path.join(path.parse(process.cwd()).root, "openclaw-extra-root");

function parseExtraRoots(extraRoots: unknown) {
  return OpenClawSchema.safeParse({
    tools: {
      fs: {
        workspaceOnly: true,
        extraRoots,
      },
    },
  });
}

describe("tools.fs.extraRoots schema", () => {
  it("accepts explicit absolute read-only and read-write root objects", () => {
    const result = parseExtraRoots([
      { path: absoluteRoot, mode: "ro" },
      { path: `${absoluteRoot}-rw`, mode: "rw" },
    ]);

    expect(result.success).toBe(true);
  });

  it.each([
    ["string shorthand", [absoluteRoot]],
    ["missing mode", [{ path: absoluteRoot }]],
    ["empty path", [{ path: "   ", mode: "ro" }]],
    ["relative path", [{ path: "relative/root", mode: "rw" }]],
  ])("rejects %s", (_name, extraRoots) => {
    expect(parseExtraRoots(extraRoots).success).toBe(false);
  });

  it.each([
    [
      "duplicate declarations",
      [
        { path: absoluteRoot, mode: "ro" },
        { path: `${absoluteRoot}/.`, mode: "ro" },
      ],
    ],
    [
      "conflicting declarations",
      [
        { path: absoluteRoot, mode: "ro" },
        { path: `${absoluteRoot}/.`, mode: "rw" },
      ],
    ],
    [
      "overlapping redundant declarations",
      [
        { path: absoluteRoot, mode: "ro" },
        { path: `${absoluteRoot}/reference`, mode: "ro" },
      ],
    ],
    [
      "overlapping conflicting declarations",
      [
        { path: absoluteRoot, mode: "rw" },
        { path: `${absoluteRoot}/private`, mode: "ro" },
      ],
    ],
  ])("fails closed on %s in one scope", (_name, extraRoots) => {
    const result = parseExtraRoots(extraRoots);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          /duplicate|conflict|overlap|redundant/i.test(issue.message),
        ),
      ).toBe(true);
    }
  });

  it("accepts the same strict shape in per-agent tool config", () => {
    const result = OpenClawSchema.safeParse({
      agents: {
        entries: {
          main: {
            tools: {
              fs: {
                workspaceOnly: true,
                extraRoots: [{ path: absoluteRoot, mode: "ro" }],
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
