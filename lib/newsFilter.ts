/** 새 뉴스 판정: 수집시각(collected_at) > 마지막 확인 시각. 첫 방문(기준 없음)은 전부 새 뉴스.
 *  발행시각 기준이면 늦게 수집된 과거 발행 기사가 누락되므로 수집시각을 기본으로 쓴다. */
export function isNewArticle(a: { collected_at: string; published_at: string }, baseline: string | null): boolean {
  if (!baseline) return true;
  return (a.collected_at || a.published_at) > baseline;
}

type ReadLookup = { has(id: string): boolean };
type Candidate = { id: string; collected_at: string; published_at: string };

/** 새 뉴스 목록·건수에 들어가는 기사: 마지막 확인 이후 수집 + 아직 읽지 않음. */
export function isUnreadNew(a: Candidate, baseline: string | null, read: ReadLookup): boolean {
  return isNewArticle(a, baseline) && !read.has(a.id);
}

/** 새 뉴스 탭에 실제로 보이는지.
 *  - 읽지 않은 새 기사는 보인다.
 *  - 읽은 새 기사는 '다시 보기'(showRead)를 켰거나, 방금 읽어 사라지는 중(justRead)일 때만 보인다. */
export function visibleInNewTab(a: Candidate, o: { baseline: string | null; read: ReadLookup; showRead: boolean; justRead?: ReadLookup }): boolean {
  if (!isNewArticle(a, o.baseline)) return false;
  return !o.read.has(a.id) || o.showRead || !!o.justRead?.has(a.id);
}
