const POSITIVE_STATUSES = new Set([
  "healthy",
  "ready",
  "running",
  "positive",
  "clear",
  "paper",
  "live",
  "eligible",
  "active"
]);

const NEGATIVE_STATUSES = new Set([
  "blocked",
  "critical",
  "failed",
  "negative",
  "stopped",
  "manual_review"
]);

export function resolveStatusTone(value) {
  const normalized = `${value || ""}`.toLowerCase();
  if (POSITIVE_STATUSES.has(normalized)) {
    return "positive";
  }
  if (NEGATIVE_STATUSES.has(normalized)) {
    return "negative";
  }
  return "neutral";
}
