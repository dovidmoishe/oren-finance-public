export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;
export const MAX_GRANT_HOURS = 72;
export const MAX_GRANT_MS = MAX_GRANT_HOURS * HOUR_MS;

export function validGrantDuration(hours: number | null): boolean {
  return (
    hours === null ||
    (Number.isInteger(hours) && hours >= 1 && hours <= MAX_GRANT_HOURS)
  );
}

export function grantExpired(
  expiresAt: Date | null,
  now = Date.now(),
): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now;
}

export function grantDurationMatches(
  expiresAt: string | null,
  hours: number | null,
  issuedAt: number,
): boolean {
  return (
    validGrantDuration(hours) &&
    (hours === null
      ? expiresAt === null
      : expiresAt !== null &&
        Date.parse(expiresAt) <= issuedAt + hours * HOUR_MS)
  );
}
