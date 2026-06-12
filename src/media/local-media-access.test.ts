import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalMediaAllowed } from "./local-media-access.js";
import { getMediaDir } from "./store.js";

describe("assertLocalMediaAllowed", () => {
  it("allows managed inbound media paths before explicit root checks", async () => {
    const id = `managed-local-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(getMediaDir(), "inbound", id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("png"));

    try {
      await expect(assertLocalMediaAllowed(filePath, [])).resolves.toBeUndefined();
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("does not allow nested inbound paths as managed media", async () => {
    const filePath = path.join(getMediaDir(), "inbound", "nested", "hidden.png");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("png"));

    try {
      await expect(assertLocalMediaAllowed(filePath, [])).rejects.toMatchObject({
        code: "path-not-allowed",
      });
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    }
  });
});
