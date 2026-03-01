import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
