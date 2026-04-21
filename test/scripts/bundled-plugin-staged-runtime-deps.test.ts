import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBundledRuntimeDepsNodeModulesDir } from "../../scripts/bundled-runtime-deps-paths.mjs";
import { collectBuiltBundledPluginStagedRuntimeDependencyErrors } from "../../scripts/lib/bundled-plugin-root-runtime-mirrors.mjs";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();

function writeJson(root: string, relativePath: string, value: unknown) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("collectBuiltBundledPluginStagedRuntimeDependencyErrors", () => {
  it("flags built staged plugins whose dist node_modules are missing runtime deps", () => {
    const repoRoot = createTempDir("openclaw-runtime-contracts-");

    writeJson(repoRoot, "dist/extensions/diffs/package.json", {
      name: "@openclaw/diffs",
      dependencies: {
        "@pierre/diffs": "^0.1.0",
      },
      openclaw: {
        bundle: {
          stageRuntimeDependencies: true,
        },
      },
    });

    expect(
      collectBuiltBundledPluginStagedRuntimeDependencyErrors({
        bundledPluginsDir: path.join(repoRoot, "dist/extensions"),
        stateRoot: repoRoot,
      }),
    ).toEqual([
      `built bundled plugin 'diffs' is missing staged runtime dependency '@pierre/diffs: ^0.1.0' under ${resolveBundledRuntimeDepsNodeModulesDir({ pluginId: "diffs", stateRoot: repoRoot })}.`,
    ]);
  });

  it("accepts built staged plugins when their staged runtime deps are present", () => {
    const repoRoot = createTempDir("openclaw-runtime-contracts-");

    writeJson(repoRoot, "dist/extensions/diffs/package.json", {
      name: "@openclaw/diffs",
      dependencies: {
        "@pierre/diffs": "^0.1.0",
      },
      openclaw: {
        bundle: {
          stageRuntimeDependencies: true,
        },
      },
    });
    const stagedDepPath = path.join(
      resolveBundledRuntimeDepsNodeModulesDir({ pluginId: "diffs", stateRoot: repoRoot }),
      "@pierre",
      "diffs",
      "package.json",
    );
    fs.mkdirSync(path.dirname(stagedDepPath), { recursive: true });
    fs.writeFileSync(
      stagedDepPath,
      `${JSON.stringify({ name: "@pierre/diffs", version: "0.1.0" }, null, 2)}\n`,
      "utf8",
    );

    expect(
      collectBuiltBundledPluginStagedRuntimeDependencyErrors({
        bundledPluginsDir: path.join(repoRoot, "dist/extensions"),
        stateRoot: repoRoot,
      }),
    ).toEqual([]);
  });

  it("keeps the WhatsApp bundled plugin opted into staged runtime dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "extensions/whatsapp/package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      openclaw?: {
        bundle?: {
          stageRuntimeDependencies?: boolean;
        };
      };
    };

    expect(packageJson.dependencies?.["@whiskeysockets/baileys"]).toBe("7.0.0-rc.9");
    expect(packageJson.openclaw?.bundle?.stageRuntimeDependencies).toBe(true);
  });
});
