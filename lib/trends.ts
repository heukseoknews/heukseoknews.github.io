import { addDays, weekRange } from './dates.ts';

export type TrendWeek = { week_start: string; counts: Record<string, number>; total: number };
export type Trends = { generated_at: string; keywords: string[]; weeks: TrendWeek[] };

/** 이번 주(월요일 시작)를 끝으로 최근 n주. 데이터가 처음 있는 주보다 앞의 빈 주는 뺀다(중간에 기사가 없던 주는 0). */
export function lastWeeks(t: Trends, today: string, n = 12): TrendWeek[] {
  const end = weekRange(today)[0];
  const first = t.weeks.filter(w => w.total > 0).map(w => w.week_start).sort()[0];
  const byStart = new Map(t.weeks.map(w => [w.week_start, w]));
  const all = Array.from({ length: n }, (_, i) => {
    const ws = addDays(end, -7 * (n - 1 - i));
    return byStart.get(ws) ?? { week_start: ws, counts: Object.fromEntries(t.keywords.map(k => [k, 0])), total: 0 };
  });
  return first ? all.filter(w => w.week_start >= first) : all.slice(-1);
}

export function niceMax(v: number): number {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 50;
  return Math.ceil(v / step) * step;
}

/** 차트 글자: SVG 는 화면 폭에 맞춰 통째로 줄어들므로, 좁은 화면에서도 실제 글자가 11px 이상이 되게 좌표 단위로 환산한다.
 *  넓은 화면(좌표 1 ≤ 화면 1.1px)은 예전 그대로(글자 10, 왼쪽 36, 오른쪽 12, 아래 34, 날짜 매주). 폭을 아직 모르면(0) 넓은 화면 값.
 *  반환: font·left·right·bottom(좌표 단위), step(x축 날짜를 몇 주마다 쓸지 — 글자가 겹치지 않게) */
export function chartText(renderedPx: number, viewW: number, weeks: number) {
  const unit = renderedPx > 0 ? viewW / renderedPx : 0;  // 화면 1px 당 좌표 단위
  const font = Math.max(10, Math.round(11 * unit * 10) / 10);
  const left = Math.max(36, Math.ceil(font * 2 + 6));     // y축 숫자 세 자리
  const right = font > 10 ? Math.ceil(font * 1.5) : 12;  // 마지막 날짜 라벨의 오른쪽 절반
  const bottom = Math.max(34, Math.ceil(font + 20));
  const gap = weeks > 1 ? (viewW - left - right) / (weeks - 1) : Infinity;
  const step = Math.max(1, Math.ceil((font * 3.2) / gap)); // '11/10' 폭 ≈ 글자 크기 × 3.2
  return { font, left, right, bottom, step };
}
