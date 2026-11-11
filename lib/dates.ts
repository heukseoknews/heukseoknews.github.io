/** 날짜 유틸 — 모든 날짜 키는 KST 기준 'YYYY-MM-DD' (발행일). */
const KST_MS = 9 * 3600 * 1000;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export const kstDate = (iso: string): string => new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(0, 10);
export const todayKst = (now: Date = new Date()): string => kstDate(now.toISOString());

const toUtcMs = (d: string) => Date.parse(d + 'T00:00:00Z');
export const addDays = (d: string, n: number): string => new Date(toUtcMs(d) + n * 86400000).toISOString().slice(0, 10);
export const weekday = (d: string): number => new Date(toUtcMs(d)).getUTCDay();

/** 월요일 시작 주의 [월, 일] */
export function weekRange(d: string): [string, string] {
  const start = addDays(d, -((weekday(d) + 6) % 7));
  return [start, addDays(start, 6)];
}

export function dayHeading(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(m)}월 ${Number(day)}일 (${DOW[weekday(d)]})`;
}

export function countByDate(items: { published_at: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of items) { const k = kstDate(a.published_at); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** 달력 격자: 해당 월의 날짜 키를 일요일 시작 주 단위로. 월 밖은 null. */
export function monthGrid(ym: string): (string | null)[][] {
  const first = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(weekday(first)).fill(null);
  for (let i = 1; i <= days; i++) cells.push(`${ym}-${String(i).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
export const shiftMonth = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
