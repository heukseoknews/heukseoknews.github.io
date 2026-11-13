/** 새 뉴스 판정: 수집시각(collected_at) > 마지막 확인 시각. 발행시각 기준이면 늦게 수집된 과거 발행 기사가 누락되므로 수집시각을 기본으로 쓴다.
 *  기준 기록이 없으면(첫 방문·기록 유실) 전부가 아니라 최근 NO_BASELINE_DAYS 일에 수집된 기사만 새 뉴스로 본다(건수가 수백 건으로 늘지 않게).
 *  시각은 글자가 아니라 시각으로 비교한다(Z·+00:00·마이크로초가 섞여도). 기사 시각이 잘못된 값이면 새 기사로 보지 않는다. */
export const NO_BASELINE_DAYS = 3;
const DAY = 86_400_000;
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

export function isNewArticle(a: { collected_at: string; published_at: string }, baseline: string | null, now: number = Date.now()): boolean {
  const t = ms(a.collected_at || a.published_at);
  if (Number.isNaN(t)) return false;
  const b = ms(baseline);
  return t > (Number.isNaN(b) ? now - NO_BASELINE_DAYS * DAY : b);
}

type Lookup = { has(id: string): boolean };
type Candidate = { id: string; collected_at: string; published_at: string };

/** 새 뉴스 목록·건수에 들어가는 기사: 마지막 확인 이후 수집 + 치우지 않음. 읽음(링크를 연 것)은 상관없다. */
export function isPendingNew(a: Candidate, baseline: string | null, dismissed: Lookup, now?: number): boolean {
  return isNewArticle(a, baseline, now) && !dismissed.has(a.id);
}

/** 새 뉴스 탭에 실제로 보이는지.
 *  - 치우지 않은 새 기사는 (읽었어도) 보인다.
 *  - 치운 새 기사는 '치운 기사 포함'을 켰거나, 방금 치워 사라지는 중(leaving)일 때만 보인다. */
export function visibleInNewTab(a: Candidate, o: { baseline: string | null; dismissed: Lookup; includeDismissed: boolean; leaving?: Lookup; now?: number }): boolean {
  if (!isNewArticle(a, o.baseline, o.now)) return false;
  return !o.dismissed.has(a.id) || o.includeDismissed || !!o.leaving?.has(a.id);
}
