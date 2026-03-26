import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setMatrixRuntime } from "../runtime.js";
import {
  loadMatrixRecoveryMaterial,
  resolveMatrixRecoveryMaterialPath,
  saveMatrixRecoveryMaterial,
} from "./recovery-material.js";

describe("matrix recovery material storage", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    setMatrixRuntime({
      state: {
        resolveStateDir: (env: NodeJS.ProcessEnv) => {
          const explicit = env.OPENCLAW_STATE_DIR?.trim();
          if (!explicit) {
            throw new Error("OPENCLAW_STATE_DIR is required in test env");
          }
          return explicit;
        },
      },
    } as never);
  });

  afterEach(() => {
    setMatrixRuntime({
      state: {
        resolveStateDir: () => {
          throw new Error("Matrix runtime not initialized");
        },
      },
    } as never);
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  function makeEnv(): NodeJS.ProcessEnv {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-recovery-"));
    tempRoots.push(root);
    return { OPENCLAW_STATE_DIR: root } as NodeJS.ProcessEnv;
  }

  it("writes recovery material under credentials/matrix with account-specific filename", () => {
    const env = makeEnv();
    saveMatrixRecoveryMaterial(
      {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        encodedRecoveryKey: "RECOVERY_KEY",
        privateKey: new Uint8Array([1, 2, 3, 4]),
      },
      env,
      "work",
    );

    const filePath = resolveMatrixRecoveryMaterialPath(env, "work");
    expect(filePath).toContain(`${path.sep}credentials${path.sep}matrix${path.sep}`);
    expect(path.basename(filePath)).toBe("recovery-material-work.json");

    const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      privateKeyBase64: string;
      encodedRecoveryKey: string;
      accountId: string;
    };
    expect(saved.accountId).toBe("work");
    expect(saved.encodedRecoveryKey).toBe("RECOVERY_KEY");
    expect(saved.privateKeyBase64).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
  });

  it("keeps default account path account-specific", () => {
    const env = makeEnv();
    saveMatrixRecoveryMaterial(
      {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        privateKey: new Uint8Array([9, 8, 7]),
      },
      env,
      "default",
    );

    const filePath = resolveMatrixRecoveryMaterialPath(env, "default");
    expect(path.basename(filePath)).toBe("recovery-material-default.json");
    expect(filePath).toContain(`${path.sep}credentials${path.sep}matrix${path.sep}`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("supports manual read/write disable flags", () => {
    const env = makeEnv();
    env.OPENCLAW_MATRIX_RECOVERY_MATERIAL_WRITE_ENABLED = "0";

    saveMatrixRecoveryMaterial(
      {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        privateKey: new Uint8Array([5]),
      },
      env,
    );

    expect(fs.existsSync(resolveMatrixRecoveryMaterialPath(env))).toBe(false);

    const writableEnv = { ...env, OPENCLAW_MATRIX_RECOVERY_MATERIAL_WRITE_ENABLED: "1" };
    saveMatrixRecoveryMaterial(
      {
        homeserver: "https://matrix.example.org",
        userId: "@bot:example.org",
        privateKey: new Uint8Array([5]),
      },
      writableEnv,
    );

    const readonlyEnv = { ...writableEnv, OPENCLAW_MATRIX_RECOVERY_MATERIAL_READ_ENABLED: "0" };
    expect(loadMatrixRecoveryMaterial(readonlyEnv)).toBeNull();
  });
});
