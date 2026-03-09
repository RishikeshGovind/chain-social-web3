import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { ChainSocialState, StateStore } from "./types";

export class FileStateStore implements StateStore {
  constructor(private readonly filePath: string = path.join(process.cwd(), "data", "posts.json")) {}

  async read(): Promise<ChainSocialState | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as ChainSocialState;
    } catch {
      return null;
    }
  }

  async write(state: ChainSocialState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    
    // Atomic write: write to temp file first, then rename
    // This prevents data corruption if process crashes during write
    const tempPath = path.join(dir, `.${path.basename(this.filePath)}.tmp.${Date.now()}`);
    try {
      await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}
