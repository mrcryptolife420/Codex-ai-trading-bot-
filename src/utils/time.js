const INTERVAL_SUFFIX_MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000
};

export function nowIso() {
  return new Date().toISOString();
}

export function minutesBetween(fromIso, toIso = new Date().toISOString()) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000;
}

export function sameUtcDay(aIso, bIso) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function intervalToMs(interval) {
  const match = `${interval || ""}`.trim().match(/^(\d+)([smhdw])$/i);
  if (!match) {
    return null;
  }
  const [, amountRaw, unitRaw] = match;
  const amount = Number(amountRaw);
  const unit = unitRaw.toLowerCase();
  return amount * INTERVAL_SUFFIX_MS[unit];
}
