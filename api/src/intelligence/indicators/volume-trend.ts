/**
 * Recent avg volume / prior avg volume over equal windows (default 7).
 * Returns 1 (neutral) if insufficient data.
 */
export function volumeTrend(volumes: number[], window = 7): number {
  if (volumes.length < window * 2) return 1;

  const recentWindow = volumes.slice(volumes.length - window);
  const priorWindow = volumes.slice(
    volumes.length - window * 2,
    volumes.length - window,
  );
  const recentSum = recentWindow.reduce((sum, value) => sum + value, 0);
  const priorSum = priorWindow.reduce((sum, value) => sum + value, 0);
  const recentAvg = recentSum / recentWindow.length;
  const priorAvg = priorSum / priorWindow.length;
  if (!Number.isFinite(priorAvg) || priorAvg === 0) return 1;
  return recentAvg / priorAvg;
}
