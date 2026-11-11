/** 다중 선택 필터(언론사·보험사·유관기관) 공통 로직. 선택이 비면 전체, 있으면 하나라도 일치(OR), 다른 필터와는 AND 로 결합된다. */
export type FacetOption = { name: string; count: number; group?: string };

/** 드롭다운 옵션: 기사 수 많은 순(같으면 이름순). 선택된 항목은 건수가 0이어도 남겨 해제할 수 있게 한다. */
export function facetOptions<T>(items: T[], keysOf: (a: T) => string[], selected: string[] = [], groupOf?: (name: string) => string | undefined): FacetOption[] {
  const c = new Map<string, number>();
  for (const a of items) for (const k of new Set(keysOf(a))) c.set(k, (c.get(k) ?? 0) + 1);
  for (const s of selected) if (!c.has(s)) c.set(s, 0);
  return [...c.entries()].map(([name, count]) => ({ name, count, group: groupOf?.(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

export function matchesFacet<T>(a: T, keysOf: (a: T) => string[], selected: string[]): boolean {
  return !selected.length || keysOf(a).some(k => selected.includes(k));
}

/** 그룹 순서대로 묶는다(그룹이 없는 옵션은 '기타' 뒤). groups 가 비면 한 덩어리. */
export function groupOptions(options: FacetOption[], groups: string[] = []): { group: string | null; options: FacetOption[] }[] {
  if (!groups.length) return [{ group: null, options }];
  const out = groups.map(g => ({ group: g as string | null, options: options.filter(o => o.group === g) }));
  const rest = options.filter(o => !o.group || !groups.includes(o.group));
  if (rest.length) out.push({ group: '기타', options: rest });
  return out.filter(g => g.options.length);
}

/** 브라우저 저장(보험사 선택 유지)용 안전한 읽기/쓰기. 저장소를 못 쓰면 빈 선택으로 동작한다. */
export function readList(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
export function writeList(key: string, list: string[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* 저장 불가(사생활 보호 모드 등)면 이번 방문에만 유지 */ }
}
