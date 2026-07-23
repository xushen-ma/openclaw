// Matrix helper module supports account config behavior.
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  listConfiguredAccountIds,
  resolveMergedAccountConfig,
  resolveNormalizedAccountEntry,
} from "openclaw/plugin-sdk/account-resolution-runtime";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import type { CoreConfig, MatrixAccountConfig, MatrixConfig } from "../types.js";

type MatrixRoomEntries = Record<string, NonNullable<MatrixConfig["groups"]>[string]>;

export function resolveMatrixBaseConfig(cfg: CoreConfig): MatrixConfig {
  return cfg.channels?.matrix ?? {};
}

function resolveMatrixAccountsMap(cfg: CoreConfig): Readonly<Record<string, MatrixAccountConfig>> {
  const accounts = resolveMatrixBaseConfig(cfg).accounts;
  if (!accounts || typeof accounts !== "object") {
    return {};
  }
  return accounts;
}

function selectInheritedMatrixRoomEntries(params: {
  entries: MatrixRoomEntries | undefined;
  accountId: string;
}): MatrixRoomEntries | undefined {
  const entries = params.entries;
  if (!entries) {
    return undefined;
  }
  const selected = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => {
      const scopedAccount =
        typeof value?.account === "string" ? normalizeAccountId(value.account) : undefined;
      return scopedAccount === undefined || scopedAccount === params.accountId;
    }),
  ) as MatrixRoomEntries;
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function mergeMatrixRoomEntries(
  inherited: MatrixRoomEntries | undefined,
  accountEntries: MatrixRoomEntries | undefined,
  hasAccountOverride: boolean,
): MatrixRoomEntries | undefined {
  if (!inherited && !accountEntries) {
    return undefined;
  }
  if (hasAccountOverride && Object.keys(accountEntries ?? {}).length === 0) {
    return undefined;
  }
  const merged: MatrixRoomEntries = {
    ...inherited,
  };
  for (const [key, value] of Object.entries(accountEntries ?? {})) {
    const inheritedValue = merged[key];
    merged[key] =
      inheritedValue && value
        ? {
            ...inheritedValue,
            ...value,
          }
        : (value ?? inheritedValue);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveMatrixAccountDefaultConfig(
  cfg: CoreConfig,
  accountId: string,
): MatrixAccountConfig | undefined {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return undefined;
  }
  return findMatrixAccountConfig(cfg, DEFAULT_ACCOUNT_ID);
}

function mergeMatrixAccountDefaultRoomEntries(params: {
  inherited: MatrixRoomEntries | undefined;
  defaultEntries: MatrixRoomEntries | undefined;
}): MatrixRoomEntries | undefined {
  return mergeMatrixRoomEntries(params.inherited, params.defaultEntries, false);
}

export function listNormalizedMatrixAccountIds(cfg: CoreConfig): string[] {
  return listConfiguredAccountIds({
    accounts: resolveMatrixAccountsMap(cfg),
    normalizeAccountId,
  });
}

export function findMatrixAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): MatrixAccountConfig | undefined {
  return resolveNormalizedAccountEntry(
    resolveMatrixAccountsMap(cfg),
    accountId,
    normalizeAccountId,
  );
}

export function hasExplicitMatrixAccountConfig(cfg: CoreConfig, accountId: string): boolean {
  const normalized = normalizeAccountId(accountId);
  if (findMatrixAccountConfig(cfg, normalized)) {
    return true;
  }
  if (normalized !== DEFAULT_ACCOUNT_ID) {
    return false;
  }
  const matrix = resolveMatrixBaseConfig(cfg);
  return (
    typeof matrix.enabled === "boolean" ||
    typeof matrix.name === "string" ||
    typeof matrix.homeserver === "string" ||
    typeof matrix.userId === "string" ||
    hasConfiguredSecretInput(matrix.accessToken) ||
    hasConfiguredSecretInput(matrix.password) ||
    typeof matrix.deviceId === "string" ||
    typeof matrix.deviceName === "string" ||
    typeof matrix.avatarUrl === "string"
  );
}

export function resolveMatrixAccountConfig(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
}): MatrixConfig {
  const accountId = normalizeAccountId(params.accountId);
  const base = resolveMatrixBaseConfig(params.cfg);
  const accounts = params.cfg.channels?.matrix?.accounts as
    | Record<string, Partial<MatrixConfig>>
    | undefined;
  const merged = resolveMergedAccountConfig<MatrixConfig>({
    channelConfig: base,
    accounts,
    accountId,
    normalizeAccountId,
    nestedObjectKeys: ["dm", "actions", "execApprovals", "botLoopProtection"],
  });
  const accountConfig = findMatrixAccountConfig(params.cfg, accountId);
  const accountDefaultConfig = resolveMatrixAccountDefaultConfig(params.cfg, accountId);
  const accountDm = accountConfig?.dm;
  const accountDmHasAllowFrom = Boolean(accountDm && Object.hasOwn(accountDm, "allowFrom"));
  const resolvedDmAllowFrom = accountDmHasAllowFrom
    ? accountDm?.allowFrom
    : (accountDefaultConfig?.dm?.allowFrom ?? merged.dm?.allowFrom);
  const dm =
    resolvedDmAllowFrom === undefined
      ? merged.dm
      : {
          ...merged.dm,
          allowFrom: resolvedDmAllowFrom,
        };
  const accountHasGroupAllowFrom = Boolean(
    accountConfig && Object.hasOwn(accountConfig, "groupAllowFrom"),
  );
  const groupAllowFrom = accountHasGroupAllowFrom
    ? accountConfig?.groupAllowFrom
    : (accountDefaultConfig?.groupAllowFrom ?? merged.groupAllowFrom);
  const groups = mergeMatrixRoomEntries(
    mergeMatrixAccountDefaultRoomEntries({
      inherited: selectInheritedMatrixRoomEntries({
        entries: base.groups,
        accountId,
      }),
      defaultEntries: accountDefaultConfig?.groups,
    }),
    accountConfig?.groups,
    Boolean(accountConfig && Object.hasOwn(accountConfig, "groups")),
  );
  const rooms = mergeMatrixRoomEntries(
    mergeMatrixAccountDefaultRoomEntries({
      inherited: selectInheritedMatrixRoomEntries({
        entries: base.rooms,
        accountId,
      }),
      defaultEntries: accountDefaultConfig?.rooms,
    }),
    accountConfig?.rooms,
    Boolean(accountConfig && Object.hasOwn(accountConfig, "rooms")),
  );
  // Room maps need custom scoping, so keep the generic merge for all other fields.
  const {
    groups: _ignoredGroups,
    rooms: _ignoredRooms,
    dm: _ignoredDm,
    groupAllowFrom: _ignoredGroupAllowFrom,
    ...rest
  } = merged;
  return {
    ...rest,
    ...(dm ? { dm } : {}),
    ...(groupAllowFrom !== undefined ? { groupAllowFrom } : {}),
    ...(groups ? { groups } : {}),
    ...(rooms ? { rooms } : {}),
  };
}

export function resolveMatrixAccountAllowlistConfig(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): {
  dmAllowFrom?: NonNullable<MatrixConfig["dm"]>["allowFrom"];
  groupAllowFrom?: MatrixConfig["groupAllowFrom"];
} {
  const accountId = normalizeAccountId(params.accountId);
  const base = resolveMatrixBaseConfig(params.cfg);
  const accountDefaultConfig = resolveMatrixAccountDefaultConfig(params.cfg, accountId);
  const accountConfig = findMatrixAccountConfig(params.cfg, accountId);
  const accountDm = accountConfig?.dm;

  let dmAllowFrom = accountDefaultConfig?.dm?.allowFrom ?? base.dm?.allowFrom;
  if (accountDm && Object.hasOwn(accountDm, "allowFrom")) {
    dmAllowFrom = accountDm.allowFrom;
  }

  let groupAllowFrom = accountDefaultConfig?.groupAllowFrom ?? base.groupAllowFrom;
  if (accountConfig && Object.hasOwn(accountConfig, "groupAllowFrom")) {
    groupAllowFrom = accountConfig.groupAllowFrom;
  }

  return { dmAllowFrom, groupAllowFrom };
}
