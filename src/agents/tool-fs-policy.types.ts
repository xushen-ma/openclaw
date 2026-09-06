import type { SessionPermissionMode } from "../../packages/gateway-protocol/src/schema/sessions-row.js";

export type PreparedSessionPermissionPolicy = Readonly<{
  root: string;
  mode: SessionPermissionMode;
}>;

export type ToolFsExtraRoot = Readonly<{
  path: string;
  mode: "ro" | "rw";
}>;

/** Filesystem policy for agent tools that can touch local paths. */
export type ToolFsPolicy = {
  workspaceOnly: boolean;
  root?: string;
};
