import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureRuntimeConfig } from "@/lib/server/runtime-config";

export type MediaStorage = {
  putImage(input: { data: Buffer; mimeType: string; extension: string }): Promise<string>;
};

class LocalMediaStorage implements MediaStorage {
  private readonly uploadDir = path.join(process.cwd(), "private-uploads");

  async putImage(input: { data: Buffer; mimeType: string; extension: string }) {
    await mkdir(this.uploadDir, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${input.extension}`;
    const filePath = path.join(this.uploadDir, fileName);
    await writeFile(filePath, input.data);
    return `/api/media/serve/${fileName}`;
  }
}

class RemoteMediaStorage implements MediaStorage {
  constructor(private readonly endpoint: string, private readonly token?: string) {}

  async putImage(input: { data: Buffer; mimeType: string; extension: string }) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": input.mimeType,
        "X-File-Ext": input.extension,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: new Uint8Array(input.data),
    });

    const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !payload.url) {
      throw new Error(payload.error || "Remote media storage upload failed");
    }

    return payload.url;
  }
}

let singleton: MediaStorage | null = null;

export function getMediaStorage(): MediaStorage {
  if (singleton) return singleton;
  ensureRuntimeConfig();

  const backend = (process.env.CHAINSOCIAL_MEDIA_BACKEND ?? "local").trim().toLowerCase();
  if (backend === "remote") {
    const endpoint = process.env.CHAINSOCIAL_MEDIA_REMOTE_URL?.trim();
    if (!endpoint) {
      throw new Error("CHAINSOCIAL_MEDIA_BACKEND=remote requires CHAINSOCIAL_MEDIA_REMOTE_URL");
    }
    singleton = new RemoteMediaStorage(endpoint, process.env.CHAINSOCIAL_MEDIA_REMOTE_TOKEN?.trim());
    return singleton;
  }

  singleton = new LocalMediaStorage();
  return singleton;
}
