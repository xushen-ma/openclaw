/** Filesystem policy for agent tools that can touch local paths. */
export type ToolFsExtraRoot = {
  path: string;
  mode: "ro" | "rw";
};

export type ToolFsPolicy = {
  workspaceOnly: boolean;
  extraRoots?: ToolFsExtraRoot[];
};
