import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function saveFile(file: Buffer, filename: string) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, filename);
  await writeFile(filePath, file);
  return `/uploads/${filename}`;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    const isFileLike =
      !!file &&
      typeof file === "object" &&
      "arrayBuffer" in file &&
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      "name" in file &&
      typeof (file as { name?: unknown }).name === "string";

    if (!isFileLike) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const uploadFile = file as { arrayBuffer: () => Promise<ArrayBuffer>; name: string };
    const buffer = Buffer.from(await uploadFile.arrayBuffer());
    const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${safeName}`;
    const url = await saveFile(buffer, filename);

    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
