import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function loadJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function saveJson(filePath, value) {
  const parentDir = path.dirname(filePath);
  await ensureDir(parentDir);
  const tempFile = `${filePath}.${crypto.randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tempFile, serialized, "utf8");
  await fs.rename(tempFile, filePath);
}
