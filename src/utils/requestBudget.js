function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, safeNumber(value)));
}

export function maskUrl(url) {
  const text = `${url || ""}`.trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    const query = parsed.search ? "?..." : "";
    return `${parsed.origin}${path}${query}`;
  } catch {
    return text.replace(/([?&](?:token|key|secret|signature)=)[^&]+/gi, "$1...");
  }
}

export function redactSensitiveText(text, secrets = []) {
  let output = `${text || ""}`;
  for (const secret of secrets.filter(Boolean)) {
    output = output.split(secret).join("[redacted]");
  }
  return output.replace(/(https?:\/\/)([^/\s]+)(\/[^\s]*)?/gi, (match) => maskUrl(match));
}

export class RequestBudget {
  constructor({
    timeoutMs = 8_000,
    baseCooldownMs = 30_000,
    maxCooldownMs = 5 * 60_000
  } = {}) {
    this.timeoutMs = Math.max(250, safeNumber(timeoutMs, 8_000));
    this.baseCooldownMs = Math.max(1_000, safeNumber(baseCooldownMs, 30_000));
    this.maxCooldownMs = Math.max(this.baseCooldownMs, safeNumber(maxCooldownMs, 5 * 60_000));
    this.state = new Map();
  }

  allow(key, nowMs = Date.now()) {
    const entry = this.state.get(key);
    if (!entry?.cooldownUntilMs || entry.cooldownUntilMs <= nowMs) {
      return { allow: true, cooldownUntil: null };
    }
    return {
      allow: false,
      cooldownUntil: new Date(entry.cooldownUntilMs).toISOString()
    };
  }

  noteSuccess(key) {
    this.state.delete(key);
  }

  noteFailure(key, nowMs = Date.now()) {
    const entry = this.state.get(key) || { failures: 0, cooldownUntilMs: 0 };
    const failures = entry.failures + 1;
    const multiplier = 2 ** clamp(failures - 1, 0, 4);
    const cooldownMs = Math.min(this.maxCooldownMs, this.baseCooldownMs * multiplier);
    this.state.set(key, {
      failures,
      cooldownUntilMs: nowMs + cooldownMs
    });
    return {
      failures,
      cooldownUntil: new Date(nowMs + cooldownMs).toISOString()
    };
  }

  async fetchJson(url, {
    key = url,
    fetchImpl = globalThis.fetch,
    headers = {},
    timeoutMs = this.timeoutMs
  } = {}) {
    const gate = this.allow(key);
    if (!gate.allow) {
      const error = new Error(`Request budget cooling down until ${gate.cooldownUntil}`);
      error.code = "REQUEST_BUDGET_COOLDOWN";
      error.cooldownUntil = gate.cooldownUntil;
      throw error;
    }
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(Math.max(250, safeNumber(timeoutMs, this.timeoutMs)))
    });
    return response;
  }
}
