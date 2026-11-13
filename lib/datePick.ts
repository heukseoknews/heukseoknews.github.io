/** 기간 고르기(날짜 바·달력)의 순수 로직. 날짜 키는 KST 'YYYY-MM-DD'. 기본은 '기간 제한 없음'(null)이고 숨은 기본 기간은 없다. */
import { addDays, kstDate, shiftMonth } from './dates.ts';

export type Range = { from: string; to: string };
export type Bounds = { min: string; max: string };

/** 빠른 선택: 오늘 · 최근 3일 · 최근 7일 · 최근 30일 · 이번 달(1일~오늘) */
export const QUICK = [
  { key: 'today', label: '오늘', aria: '오늘' },
  { key: 'd3', label: '3일', aria: '최근 3일' },
  { key: 'd7', label: '7일', aria: '최근 7일' },
  { key: 'd30', label: '30일', aria: '최근 30일' },
  { key: 'month', label: '이번 달', aria: '이번 달' },
] as const;
export type QuickKey = typeof QUICK[number]['key'];
export const lastDays = (today: string, n: number): Range => ({ from: addDays(today, -(n - 1)), to: today });
export function quickRange(key: QuickKey, today: string): Range {
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'd3': return lastDays(today, 3);
    case 'd7': return lastDays(today, 7);
    case 'd30': return lastDays(today, 30);
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}
export const sameRange = (a: Range | null, b: Range | null) => a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
/** 빠른 선택이 데이터 범위와 전혀 겹치지 않으면(예: 오늘 기사가 아직 없음) 누를 수 없다 */
export const overlaps = (r: Range, b: Bounds | null) => !!b && r.from <= b.max && r.to >= b.min;

/** 달력에서 날짜 누르기: 첫 번째는 그 하루(바로 적용)이면서 기간의 시작, 두 번째는 기간(앞뒤 순서 무관)으로 끝낸다. */
export function pickDay(anchor: string | null, d: string): { range: Range; anchor: string | null } {
  if (!anchor) return { range: { from: d, to: d }, anchor: d };
  return { range: anchor <= d ? { from: anchor, to: d } : { from: d, to: anchor }, anchor: null };
}

/** 데이터가 있는 날짜 범위(첫 기사~마지막 기사, 오늘을 넘지 않음). 가장 오래된 달을 아직 안 불러왔으면 그 달 1일부터로 둔다(그 달을 보면 불러와 정확해진다). */
export function dataBounds(articles: { published_at: string }[], indexMonths: string[], loadedMonths: string[], today: string): Bounds | null {
  if (!articles.length) return null;
  let min = '9999-12-31', max = '0000-01-01';
  for (const a of articles) { const d = kstDate(a.published_at); if (d < min) min = d; if (d > max) max = d; }
  const oldest = [...indexMonths].sort()[0];
  if (oldest && !loadedMonths.includes(oldest) && `${oldest}-01` < min) min = `${oldest}-01`;
  if (max > today) max = today;
  return min <= max ? { min, max } : null;
}
export const selectable = (d: string, b: Bounds | null) => !!b && d >= b.min && d <= b.max;

/** 달력 키보드: ←→ 하루, ↑↓ 한 주, PageUp/PageDown 한 달(같은 날, 말일 보정). 범위 밖이면 범위 끝에서 멈춘다. 다른 키면 null. */
export function moveDay(d: string, key: string, b: Bounds | null): string | null {
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let n: string;
  if (key in step) n = addDays(d, step[key]);
  else if (key === 'PageUp' || key === 'PageDown') {
    const ym = shiftMonth(d.slice(0, 7), key === 'PageUp' ? -1 : 1);
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    n = `${ym}-${String(Math.min(Number(d.slice(8)), last)).padStart(2, '0')}`;
  } else return null;
  if (!b) return d;
  return n < b.min ? b.min : n > b.max ? b.max : n;
}

/** 기간에 걸친 월 파일(앞날 하루를 더 본다: KST 1일 새벽 기사는 UTC 로 전달 파일에 있다). 최대 36개월. */
export function monthsBetween(r: Range): string[] {
  const out: string[] = [];
  for (let m = addDays(r.from, -1).slice(0, 7); m <= r.to.slice(0, 7) && out.length < 36; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** '기간 제한 없음'일 때 최근 2개월 다음의 과거 달을 몇 개 불러올지(한 번에 하나씩 늘린다).
 *  합계가 budget(바이트, index.json 의 bytes) 안이면 자동으로, 넘으면 목록 끝 페이지에 닿았을 때만 다음 달을 불러온다. */
export const OLDER_BUDGET = 3_000_000;
export function nextOlder(months: { month: string; bytes: number }[], older: number, atEnd: boolean, budget = OLDER_BUDGET): number {
  const i = 2 + older;
  if (i >= months.length) return older;
  const used = months.slice(0, i).reduce((s, m) => s + (m.bytes || 0), 0);
  return used + (months[i].bytes || 0) <= budget || atEnd ? older + 1 : older;
}
