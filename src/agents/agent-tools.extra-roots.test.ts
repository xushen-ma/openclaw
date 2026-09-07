import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadTool } from "openclaw/plugin-sdk/agent-sessions";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-openclaw-tools.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  createRebindableDirectoryAlias,
  withRealpathSymlinkRebindRace,
} from "../test-utils/symlink-rebind-race.js";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { wrapToolWorkspaceRootGuardWithOptions } from "./agent-tools.read.js";
import { getTextContent } from "./test-helpers/agent-tools-fs-helpers.js";
import { createAgentToolsSandboxContext } from "./test-helpers/agent-tools-sandbox-context.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";
import type { AnyAgentTool } from "./tools/common.js";

vi.mock("../infra/shell-env.js", async () => {
  const mod =
    await vi.importActual<typeof import("../infra/shell-env.js")>("../infra/shell-env.js");
  return { ...mod, getShellPathFromLoginShell: () => null };
});

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-extra-roots-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function requireTool(tools: AnyAgentTool[], name: "read" | "write" | "edit" | "apply_patch") {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`expected ${name} tool`);
  }
  return tool;
}

function extraRootConfig(params: {
  globalRoots?: Array<{ path: string; mode: "ro" | "rw" }>;
  agentRoots?: Array<{ path: string; mode: "ro" | "rw" }>;
  workspaceOnly?: boolean;
}): OpenClawConfig {
  return {
    tools: {
      fs: {
        workspaceOnly: params.workspaceOnly,
        extraRoots: params.globalRoots,
      },
    },
    ...(params.agentRoots
      ? {
          agents: {
            entries: {
              main: {
                tools: { fs: { extraRoots: params.agentRoots } },
              },
            },
          },
        }
      : {}),
  } as OpenClawConfig;
}

function addFilePatch(filePath: string, content: string): string {
  return `*** Begin Patch\n*** Add File: ${filePath}\n+${content}\n*** End Patch`;
}

function updateFilePatch(filePath: string, oldText: string, newText: string): string {
  return `*** Begin Patch\n*** Update File: ${filePath}\n@@\n-${oldText}\n+${newText}\n*** End Patch`;
}

describe("tools.fs.extraRoots", () => {
  it("keeps extra roots disabled unless workspaceOnly is explicitly enabled", async () => {
    const root = await makeTempRoot();
    const workspaceDir = path.join(root, "workspace");
    const configuredRoot = path.join(root, "configured");
    const unrelatedRoot = path.join(root, "unrelated");
    await Promise.all([fs.mkdir(workspaceDir), fs.mkdir(configuredRoot), fs.mkdir(unrelatedRoot)]);
    const tools = createOpenClawCodingTools({
      workspaceDir,
      config: extraRootConfig({
        globalRoots: [{ path: configuredRoot, mode: "ro" }],
      }),
    });

    await requireTool(tools, "write").execute("default-unrestricted", {
      path: path.join(unrelatedRoot, "legacy.txt"),
      content: "legacy unrestricted behavior",
    });

    await expect(fs.readFile(path.join(unrelatedRoot, "legacy.txt"), "utf8")).resolves.toBe(
      "legacy unrestricted behavior",
    );
  });

  it("merges global and agent roots while enforcing read-only and read-write modes", async () => {
    const root = await makeTempRoot();
    const workspaceDir = path.join(root, "workspace");
    const readOnlyRoot = path.join(root, "read-only");
    const readWriteRoot = path.join(root, "read-write");
    const outsideRoot = path.join(root, "outside");
    await Promise.all(
      [workspaceDir, readOnlyRoot, readWriteRoot, outsideRoot].map((dir) => fs.mkdir(dir)),
    );
    await Promise.all([
      fs.writeFile(path.join(readOnlyRoot, "notes.txt"), "read only", "utf8"),
      fs.writeFile(path.join(readWriteRoot, "notes.txt"), "read write", "utf8"),
      fs.writeFile(path.join(outsideRoot, "secret.txt"), "outside", "utf8"),
    ]);

    const tools = createOpenClawCodingTools({
      workspaceDir,
      agentId: "main",
      config: extraRootConfig({
        workspaceOnly: true,
        globalRoots: [{ path: readOnlyRoot, mode: "ro" }],
        agentRoots: [{ path: readWriteRoot, mode: "rw" }],
      }),
    });
    const read = requireTool(tools, "read");
    const write = requireTool(tools, "write");
    const edit = requireTool(tools, "edit");
    const applyPatch = requireTool(tools, "apply_patch");

    expect(
      getTextContent(await read.execute("read-ro", { path: path.join(readOnlyRoot, "notes.txt") })),
    ).toContain("read only");
    expect(
      getTextContent(
        await read.execute("read-rw", { path: path.join(readWriteRoot, "notes.txt") }),
      ),
    ).toContain("read write");

    await expect(
      write.execute("write-ro", {
        path: path.join(readOnlyRoot, "blocked.txt"),
        content: "blocked",
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      edit.execute("edit-ro", {
        path: path.join(readOnlyRoot, "notes.txt"),
        edits: [{ oldText: "only", newText: "changed" }],
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      applyPatch.execute("patch-ro", {
        input: addFilePatch(path.join(readOnlyRoot, "blocked-patch.txt"), "blocked"),
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);

    await write.execute("write-rw", {
      path: path.join(readWriteRoot, "written.txt"),
      content: "written",
    });
    await edit.execute("edit-rw", {
      path: path.join(readWriteRoot, "notes.txt"),
      edits: [{ oldText: "read write", newText: "edited" }],
    });
    await applyPatch.execute("patch-rw", {
      input: addFilePatch(path.join(readWriteRoot, "patched.txt"), "patched"),
    });
    await expect(fs.readFile(path.join(readWriteRoot, "written.txt"), "utf8")).resolves.toBe(
      "written",
    );
    await expect(fs.readFile(path.join(readWriteRoot, "notes.txt"), "utf8")).resolves.toBe(
      "edited",
    );
    await expect(fs.readFile(path.join(readWriteRoot, "patched.txt"), "utf8")).resolves.toBe(
      "patched\n",
    );

    await expect(
      read.execute("read-outside", { path: path.join(outsideRoot, "secret.txt") }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      write.execute("write-outside", {
        path: path.join(outsideRoot, "blocked.txt"),
        content: "blocked",
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
  });

  it("resolves relative input once against the coding cwd instead of remapping it per root", async () => {
    const root = await makeTempRoot();
    const containmentRoot = path.join(root, "session-root");
    const codingRoot = path.join(root, "coding-root");
    const extraRoot = path.join(root, "extra-root");
    await Promise.all([containmentRoot, codingRoot, extraRoot].map((dir) => fs.mkdir(dir)));
    await fs.writeFile(path.join(extraRoot, "secret.txt"), "must not be remapped", "utf8");

    const guarded = wrapToolWorkspaceRootGuardWithOptions(
      createReadTool(codingRoot),
      containmentRoot,
      {
        cwdResolvedAdditionalRoots: [extraRoot],
        resolutionCwd: codingRoot,
        normalizeGuardedPathParams: true,
      },
    );

    await expect(guarded.execute("relative-remap", { path: "secret.txt" })).rejects.toThrow(
      /Path escapes sandbox root/i,
    );
  });

  it("rejects a read-only extra root nested inside the writable workspace", async () => {
    const root = await makeTempRoot();
    const workspaceDir = path.join(root, "workspace");
    const nestedReadOnlyRoot = path.join(workspaceDir, "read-only");
    await fs.mkdir(nestedReadOnlyRoot, { recursive: true });

    expect(() =>
      createOpenClawCodingTools({
        workspaceDir,
        config: extraRootConfig({
          workspaceOnly: true,
          globalRoots: [{ path: nestedReadOnlyRoot, mode: "ro" }],
        }),
      }),
    ).toThrow(/overlaps the writable workspace root/i);
  });

  it("rejects a read-write extra root that is an ancestor of the writable workspace", async () => {
    const root = await makeTempRoot();
    const configuredRoot = path.join(root, "configured");
    const workspaceDir = path.join(configuredRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    expect(() =>
      createOpenClawCodingTools({
        workspaceDir,
        config: extraRootConfig({
          workspaceOnly: true,
          globalRoots: [{ path: configuredRoot, mode: "rw" }],
        }),
      }),
    ).toThrow(/overlaps the writable workspace root/i);
  });

  it("rejects case-only workspace aliases on case-insensitive filesystems", async () => {
    const root = await makeTempRoot();
    const workspaceDir = path.join(root, "CaseWorkspace");
    const caseAlias = path.join(root, "caseworkspace");
    await fs.mkdir(workspaceDir);
    const [workspaceCanonical, aliasCanonical] = await Promise.all([
      fs.realpath(workspaceDir),
      fs.realpath(caseAlias).catch(() => undefined),
    ]);
    if (aliasCanonical !== workspaceCanonical) {
      return;
    }

    expect(() =>
      createOpenClawCodingTools({
        workspaceDir,
        config: extraRootConfig({
          workspaceOnly: true,
          globalRoots: [{ path: caseAlias, mode: "rw" }],
        }),
      }),
    ).toThrow(/overlaps the writable workspace root/i);
  });

  it.runIf(process.platform !== "win32")(
    "fails closed when symlinked roots alias the workspace or each other",
    async () => {
      const root = await makeTempRoot();
      const workspaceDir = path.join(root, "workspace");
      const realExtraRoot = path.join(root, "real-extra");
      const workspaceAlias = path.join(root, "workspace-alias");
      const extraAlias = path.join(root, "extra-alias");
      const workspaceAncestorAlias = path.join(root, "workspace-ancestor-alias");
      await Promise.all([workspaceDir, realExtraRoot].map((dir) => fs.mkdir(dir)));
      await fs.symlink(workspaceDir, workspaceAlias);
      await fs.symlink(realExtraRoot, extraAlias);
      await fs.symlink(root, workspaceAncestorAlias);

      expect(() =>
        createOpenClawCodingTools({
          workspaceDir,
          config: extraRootConfig({
            workspaceOnly: true,
            globalRoots: [{ path: workspaceAlias, mode: "ro" }],
          }),
        }),
      ).toThrow(/overlaps the writable workspace root/i);

      expect(() =>
        createOpenClawCodingTools({
          workspaceDir,
          config: extraRootConfig({
            workspaceOnly: true,
            globalRoots: [
              { path: realExtraRoot, mode: "rw" },
              { path: extraAlias, mode: "ro" },
            ],
          }),
        }),
      ).toThrow(/duplicate or overlapping host roots/i);

      expect(() =>
        createOpenClawCodingTools({
          workspaceDir,
          config: extraRootConfig({
            workspaceOnly: true,
            globalRoots: [{ path: workspaceAncestorAlias, mode: "rw" }],
          }),
        }),
      ).toThrow(/overlaps the writable workspace root/i);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects traversal, symlink, and hardlink escapes from configured roots",
    async () => {
      const root = await makeTempRoot();
      const workspaceDir = path.join(root, "workspace");
      const readWriteRoot = path.join(root, "read-write");
      const outsideRoot = path.join(root, "outside");
      await Promise.all([workspaceDir, readWriteRoot, outsideRoot].map((dir) => fs.mkdir(dir)));
      const outsideFile = path.join(outsideRoot, "secret.txt");
      await fs.writeFile(outsideFile, "unchanged", "utf8");
      await fs.symlink(outsideRoot, path.join(readWriteRoot, "outside-link"));
      await fs.link(outsideFile, path.join(readWriteRoot, "hardlink.txt"));

      const tools = createOpenClawCodingTools({
        workspaceDir,
        config: extraRootConfig({
          workspaceOnly: true,
          globalRoots: [{ path: readWriteRoot, mode: "rw" }],
        }),
      });
      const read = requireTool(tools, "read");
      const write = requireTool(tools, "write");
      const edit = requireTool(tools, "edit");
      const applyPatch = requireTool(tools, "apply_patch");
      const rawTraversal = `${readWriteRoot}${path.sep}..${path.sep}outside${path.sep}traversed.txt`;

      await expect(
        write.execute("write-traversal", { path: rawTraversal, content: "blocked" }),
      ).rejects.toThrow(/Path escapes sandbox root/i);
      await expect(
        write.execute("write-symlink", {
          path: path.join(readWriteRoot, "outside-link", "written.txt"),
          content: "blocked",
        }),
      ).rejects.toThrow(/symlink|alias|outside|escape|sandbox/i);
      await expect(
        edit.execute("edit-symlink", {
          path: path.join(readWriteRoot, "outside-link", "secret.txt"),
          edits: [{ oldText: "unchanged", newText: "blocked" }],
        }),
      ).rejects.toThrow(/symlink|alias|outside|escape|sandbox/i);
      await expect(
        applyPatch.execute("patch-symlink", {
          input: addFilePatch(path.join(readWriteRoot, "outside-link", "patched.txt"), "blocked"),
        }),
      ).rejects.toThrow(/symlink|alias|outside|escape|sandbox/i);
      await expect(
        read.execute("read-hardlink", { path: path.join(readWriteRoot, "hardlink.txt") }),
      ).rejects.toThrow(/hardlink|sandbox/i);
      await expect(
        write.execute("write-hardlink", {
          path: path.join(readWriteRoot, "hardlink.txt"),
          content: "blocked",
        }),
      ).rejects.toThrow(/hardlink|sandbox/i);
      await expect(
        edit.execute("edit-hardlink", {
          path: path.join(readWriteRoot, "hardlink.txt"),
          edits: [{ oldText: "unchanged", newText: "blocked" }],
        }),
      ).rejects.toThrow(/hardlink|sandbox/i);
      await expect(
        applyPatch.execute("patch-hardlink", {
          input: updateFilePatch(path.join(readWriteRoot, "hardlink.txt"), "unchanged", "blocked"),
        }),
      ).rejects.toThrow(/hardlink|sandbox/i);
      await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("unchanged");
    },
  );

  it.runIf(process.platform !== "win32")(
    "does not create outside an extra root when a parent alias is rebound during mkdir",
    async () => {
      const root = await makeTempRoot();
      const workspaceDir = path.join(root, "workspace");
      const readWriteRoot = path.join(root, "read-write");
      const insideRoot = path.join(readWriteRoot, "inside");
      const outsideRoot = path.join(root, "outside");
      const slot = path.join(readWriteRoot, "slot");
      await Promise.all(
        [workspaceDir, insideRoot, outsideRoot].map((dir) => fs.mkdir(dir, { recursive: true })),
      );
      await createRebindableDirectoryAlias({ aliasPath: slot, targetPath: insideRoot });
      const tools = createOpenClawCodingTools({
        workspaceDir,
        config: extraRootConfig({
          workspaceOnly: true,
          globalRoots: [{ path: readWriteRoot, mode: "rw" }],
        }),
      });
      const target = path.join(slot, "nested", "deep", "file.txt");

      await withRealpathSymlinkRebindRace({
        shouldFlip: (realpathInput) => realpathInput.endsWith(path.join("read-write", "slot")),
        symlinkPath: slot,
        symlinkTarget: outsideRoot,
        timing: "after-realpath",
        run: async () => {
          await expect(
            requireTool(tools, "write").execute("write-rebound-parent", {
              path: target,
              content: "blocked",
            }),
          ).rejects.toThrow(/alias|symlink|escape|sandbox|outside|root/i);
        },
      });
      await expect(fs.stat(path.join(outsideRoot, "nested"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("never projects configured host roots into sandboxed runs", async () => {
    const root = await makeTempRoot();
    const sandboxRoot = path.join(root, "sandbox");
    const hostExtraRoot = path.join(root, "host-extra");
    await Promise.all([sandboxRoot, hostExtraRoot].map((dir) => fs.mkdir(dir)));
    await fs.writeFile(path.join(hostExtraRoot, "secret.txt"), "host secret", "utf8");
    const sandbox = createAgentToolsSandboxContext({
      workspaceDir: sandboxRoot,
      agentWorkspaceDir: sandboxRoot,
      workspaceAccess: "rw",
      fsBridge: createHostSandboxFsBridge(sandboxRoot),
      tools: { allow: [], deny: [] },
    });
    const tools = createOpenClawCodingTools({
      workspaceDir: sandboxRoot,
      sandbox,
      config: extraRootConfig({
        workspaceOnly: true,
        globalRoots: [{ path: hostExtraRoot, mode: "rw" }],
      }),
    });

    await expect(
      requireTool(tools, "read").execute("sandbox-read-host", {
        path: path.join(hostExtraRoot, "secret.txt"),
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      requireTool(tools, "write").execute("sandbox-write-host", {
        path: path.join(hostExtraRoot, "written.txt"),
        content: "blocked",
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      requireTool(tools, "edit").execute("sandbox-edit-host", {
        path: path.join(hostExtraRoot, "secret.txt"),
        edits: [{ oldText: "host", newText: "blocked" }],
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      requireTool(tools, "apply_patch").execute("sandbox-patch-host", {
        input: addFilePatch(path.join(hostExtraRoot, "patched.txt"), "blocked"),
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
  });

  it("does not broaden session-permission or memory-flush roots", async () => {
    const root = await makeTempRoot();
    const sessionRoot = path.join(root, "session");
    const extraRoot = path.join(root, "extra");
    await Promise.all([sessionRoot, extraRoot].map((dir) => fs.mkdir(dir)));
    await fs.writeFile(path.join(extraRoot, "secret.txt"), "secret", "utf8");
    const config = extraRootConfig({
      workspaceOnly: true,
      globalRoots: [{ path: extraRoot, mode: "rw" }],
    });

    const sessionTools = createOpenClawCodingTools({
      workspaceDir: sessionRoot,
      config,
      sessionPermissionPolicy: { root: sessionRoot, mode: "guarded" },
    });
    await expect(
      requireTool(sessionTools, "read").execute("session-read-extra", {
        path: path.join(extraRoot, "secret.txt"),
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);

    const memoryPath = "memory/2026-09-06.md";
    await fs.mkdir(path.join(sessionRoot, "memory"));
    await fs.writeFile(path.join(sessionRoot, memoryPath), "seed", "utf8");
    const memoryTools = createOpenClawCodingTools({
      workspaceDir: sessionRoot,
      config,
      trigger: "memory",
      memoryFlushWritePath: memoryPath,
    });
    await expect(
      requireTool(memoryTools, "read").execute("memory-read-extra", {
        path: path.join(extraRoot, "secret.txt"),
      }),
    ).rejects.toThrow(/Path escapes sandbox root/i);
    await expect(
      requireTool(memoryTools, "write").execute("memory-write-extra", {
        path: path.join(extraRoot, "blocked.txt"),
        content: "blocked",
      }),
    ).rejects.toThrow(/memory flush|append|Path escapes sandbox root/i);
  });
});
