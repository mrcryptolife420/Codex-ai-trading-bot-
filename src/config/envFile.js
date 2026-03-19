import fs from "node:fs/promises";
import path from "node:path";

function normalizeEnvKey(key) {
  const normalized = `${key || ""}`.trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid env key: ${key}`);
  }
  return normalized;
}

function normalizeEnvValue(value) {
  const normalized = `${value ?? ""}`;
  if (/[\r\n\0]/.test(normalized)) {
    throw new Error("Env values may not contain newlines or null bytes.");
  }
  return normalized;
}

function normalizeEnvUpdates(updates = {}) {
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [normalizeEnvKey(key), normalizeEnvValue(value)])
  );
}

export async function ensureEnvFile(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  try {
    await fs.access(envPath);
    return envPath;
  } catch {
    const examplePath = path.join(projectRoot, ".env.example");
    const content = await fs.readFile(examplePath, "utf8");
    await fs.writeFile(envPath, content, "utf8");
    return envPath;
  }
}

export async function readEnvFile(envPath) {
  try {
    return await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function updateEnvFile(envPath, updates) {
  const normalizedUpdates = normalizeEnvUpdates(updates);
  const content = await readEnvFile(envPath);
  const lines = content ? content.split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(normalizedUpdates));
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }
    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    if (!remaining.has(key)) {
      return line;
    }
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining.entries()) {
    nextLines.push(`${key}=${value}`);
  }

  await fs.writeFile(envPath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}
