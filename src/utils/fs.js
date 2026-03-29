import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function annotateJsonLoadError(error, filePath, corruptionKind) {
  if (error && typeof error === "object") {
    error.filePath = filePath;
    error.corruptionKind = corruptionKind;
  }
  return error;
}

export async function loadJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    if (!normalized.trim()) {
      throw annotateJsonLoadError(new SyntaxError(`Empty JSON file at ${filePath}`), filePath, "empty_file");
    }
    if (normalized.includes("\u0000")) {
      throw annotateJsonLoadError(new SyntaxError(`Null bytes detected in JSON file at ${filePath}`), filePath, "null_bytes");
    }
    try {
      return JSON.parse(normalized);
    } catch (error) {
      throw annotateJsonLoadError(error, filePath, "invalid_json");
    }
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

export async function appendJsonLine(filePath, value) {
  const parentDir = path.dirname(filePath);
  await ensureDir(parentDir);
  const serialized = `${JSON.stringify(value)}\n`;
  await fs.appendFile(filePath, serialized, "utf8");
}

export async function listFiles(dirPath) {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    return items
      .filter((item) => item.isFile())
      .map((item) => path.join(dirPath, item.name));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
