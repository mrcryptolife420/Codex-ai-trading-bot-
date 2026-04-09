import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, listFiles, loadJson, removeFile, saveJson } from "../utils/fs.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function safeStateNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function parseBackupTimestamp(filePath) {
  const match = path.basename(filePath || "").match(/^backup-(.+)\.json$/);
  if (!match) {
    return null;
  }
  const [datePart, timePart] = match[1].split("T");
  if (!datePart || !timePart) {
    return null;
  }
  const normalizedTime = timePart.replace(/^(\d{2})-(\d{2})-(\d{2})(.*)$/, "$1:$2:$3$4");
  const iso = `${datePart}T${normalizedTime}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : new Date(iso).toISOString();
}

async function fallbackBackupTimestamp(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.toISOString();
  } catch {
    return null;
  }
}

export class StateBackupManager {
  constructor({ runtimeDir, config, logger }) {
    this.runtimeDir = runtimeDir;
    this.config = config;
    this.logger = logger;
    this.backupDir = path.join(runtimeDir, "backups");
    this.state = {
      enabled: Boolean(config.stateBackupEnabled),
      lastBackupAt: null,
      latestFile: null,
      backupCount: 0,
      lastReason: null,
      restoredFromBackupAt: null
    };
  }

  async init(previousState = null) {
    if (!this.config.stateBackupEnabled) {
      return;
    }
    await ensureDir(this.backupDir);
    const files = await listFiles(this.backupDir);
    const latest = [...files].sort().reverse()[0] || null;
    const restored = previousState && typeof previousState === "object" ? previousState : {};
    const latestBackupAt = parseBackupTimestamp(latest) || await fallbackBackupTimestamp(latest);
    const restoredBackupAtMs = restored.lastBackupAt ? new Date(restored.lastBackupAt).getTime() : Number.NaN;
    const latestBackupAtMs = latestBackupAt ? new Date(latestBackupAt).getTime() : Number.NaN;
    const resolvedLastBackupAt = Number.isFinite(restoredBackupAtMs) || Number.isFinite(latestBackupAtMs)
      ? (Number.isFinite(restoredBackupAtMs) && (!Number.isFinite(latestBackupAtMs) || restoredBackupAtMs >= latestBackupAtMs)
          ? restored.lastBackupAt
          : latestBackupAt)
      : null;

    this.state = {
      ...this.state,
      enabled: true,
      lastBackupAt: resolvedLastBackupAt,
      latestFile: latest || restored.latestFile || null,
      backupCount: Math.max(safeStateNumber(restored.backupCount, 0), files.length),
      lastReason: restored.lastReason || this.state.lastReason,
      restoredFromBackupAt: restored.restoredFromBackupAt || this.state.restoredFromBackupAt
    };
  }

  async maybeBackup(payload, { reason = "cycle", force = false, nowIso = new Date().toISOString() } = {}) {
    if (!this.config.stateBackupEnabled) {
      return null;
    }
    const lastBackupMs = this.state.lastBackupAt ? new Date(this.state.lastBackupAt).getTime() : 0;
    const dueMs = (this.config.stateBackupIntervalMinutes || 30) * 60 * 1000;
    if (!force && lastBackupMs && Date.now() - lastBackupMs < dueMs) {
      return null;
    }
    const stamp = nowIso.replaceAll(":", "-");
    const filePath = path.join(this.backupDir, `backup-${stamp}.json`);
    await saveJson(filePath, {
      at: nowIso,
      reason,
      payload
    });
    this.state.lastBackupAt = nowIso;
    this.state.latestFile = filePath;
    this.state.lastReason = reason;
    await this.prune();
    return {
      at: nowIso,
      filePath,
      reason
    };
  }

  async loadLatestBackup() {
    if (!this.config.stateBackupEnabled) {
      return null;
    }
    const files = await listFiles(this.backupDir);
    const orderedFiles = [...files].sort().reverse();
    for (const latest of orderedFiles) {
      try {
        const payload = await loadJson(latest, null);
        if (!payload) {
          continue;
        }
        this.state.latestFile = latest;
        this.state.lastBackupAt = payload.at || this.state.lastBackupAt;
        return payload;
      } catch (error) {
        this.logger?.warn?.("Skipping unreadable backup file", {
          filePath: latest,
          error: error.message
        });
      }
    }
    return null;
  }

  async noteRestore(at) {
    this.state.restoredFromBackupAt = at;
  }

  async prune() {
    const keep = Math.max(2, this.config.stateBackupRetention || 6);
    const files = await listFiles(this.backupDir);
    const stale = [...files].sort().reverse().slice(keep);
    for (const file of stale) {
      await removeFile(file);
    }
    this.state.backupCount = Math.min(files.length, keep);
  }

  getSummary() {
    return {
      ...this.state,
      backupDir: this.backupDir
    };
  }
}



