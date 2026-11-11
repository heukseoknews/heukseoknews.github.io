export const STALE_HOURS = 36;

/** 마지막 수집(finished_at)이 hours 시간보다 오래됐으면 true. 값이 없거나 잘못되면 false(안내를 띄우지 않는다). */
export function isStale(finishedAt: string | null | undefined, now: Date = new Date(), hours = STALE_HOURS): boolean {
  if (!finishedAt) return false;
  const t = new Date(finishedAt).getTime();
  if (isNaN(t)) return false;
  return now.getTime() - t > hours * 3600 * 1000;
}
