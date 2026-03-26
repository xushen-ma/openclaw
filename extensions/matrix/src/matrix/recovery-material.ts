import fs from "node:fs";
import path from "node:path";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMatrixCredentialsDir } from "./credentials.js";

export const MATRIX_RECOVERY_MATERIAL_VERSION = 1;

export type MatrixRecoveryMaterial = {
  version: 1;
  accountId: string;
  homeserver: string;
  userId: string;
  encodedRecoveryKey?: string;
  privateKeyBase64?: string;
  createdAt: string;
  updatedAt: string;
};

function recoveryFilename(accountId?: string | null): string {
  const normalized = normalizeAccountId(accountId);
  return `recovery-material-${normalized}.json`;
}

export function resolveMatrixRecoveryMaterialPath(
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string | null,
): string {
  return path.join(resolveMatrixCredentialsDir(env), recoveryFilename(accountId));
}

export function isMatrixRecoveryMaterialReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_MATRIX_RECOVERY_MATERIAL_READ_ENABLED !== "0";
}

export function isMatrixRecoveryMaterialWriteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OPENCLAW_MATRIX_RECOVERY_MATERIAL_WRITE_ENABLED !== "0";
}

export function loadMatrixRecoveryMaterial(
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string | null,
): MatrixRecoveryMaterial | null {
  if (!isMatrixRecoveryMaterialReadEnabled(env)) {
    return null;
  }
  const filePath = resolveMatrixRecoveryMaterialPath(env, accountId);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<MatrixRecoveryMaterial>;
    if (
      raw.version !== 1 ||
      typeof raw.homeserver !== "string" ||
      typeof raw.userId !== "string" ||
      typeof raw.accountId !== "string"
    ) {
      return null;
    }
    if (raw.privateKeyBase64 !== undefined && typeof raw.privateKeyBase64 !== "string") {
      return null;
    }
    if (raw.encodedRecoveryKey !== undefined && typeof raw.encodedRecoveryKey !== "string") {
      return null;
    }
    return raw as MatrixRecoveryMaterial;
  } catch {
    return null;
  }
}

export function saveMatrixRecoveryMaterial(
  params: {
    homeserver: string;
    userId: string;
    encodedRecoveryKey?: string;
    privateKey: Uint8Array;
  },
  env: NodeJS.ProcessEnv = process.env,
  accountId?: string | null,
): void {
  if (!isMatrixRecoveryMaterialWriteEnabled(env)) {
    return;
  }

  const filePath = resolveMatrixRecoveryMaterialPath(env, accountId);
  const now = new Date().toISOString();
  const existing = loadMatrixRecoveryMaterial(env, accountId);

  const payload: MatrixRecoveryMaterial = {
    version: MATRIX_RECOVERY_MATERIAL_VERSION,
    accountId: normalizeAccountId(accountId),
    homeserver: params.homeserver,
    userId: params.userId,
    encodedRecoveryKey: params.encodedRecoveryKey,
    privateKeyBase64: Buffer.from(params.privateKey).toString("base64"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}
