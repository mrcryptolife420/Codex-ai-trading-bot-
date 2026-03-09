import path from "node:path";
import { ensureDir, listFiles, loadJson, removeFile, saveJson } from "../utils/fs.js";

function num(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
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

  async init() {
    if (!this.config.stateBackupEnabled) {
      return;
    }
    await ensureDir(this.backupDir);
    const files = await listFiles(this.backupDir);
    const latest = [...files].sort().reverse()[0] || null;
    this.state.backupCount = files.length;
    this.state.latestFile = latest;
    this.state.lastBackupAt = latest ? path.basename(latest).replace(/^backup-/, "").replace(/\.json$/, "") : null;
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
    const latest = [...files].sort().reverse()[0] || null;
    if (!latest) {
      return null;
    }
    const payload = await loadJson(latest, null);
    if (!payload) {
      return null;
    }
    this.state.latestFile = latest;
    this.state.lastBackupAt = payload.at || this.state.lastBackupAt;
    return payload;
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
