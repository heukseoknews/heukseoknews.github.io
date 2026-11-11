/** 언론사 드롭다운 옵션: 기사 수 많은 순(같으면 이름순). 선택된 언론사는 건수가 0이어도 남겨서 해제할 수 있게 한다. */
export type SourceOption = { name: string; count: number };

export function sourceOptions(items: { source: string }[], selected: string[] = []): SourceOption[] {
  const c = new Map<string, number>();
  for (const a of items) c.set(a.source, (c.get(a.source) ?? 0) + 1);
  for (const s of selected) if (!c.has(s)) c.set(s, 0);
  return [...c.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

/** 선택이 비어 있으면 전체, 있으면 선택된 언론사 중 하나(OR). 다른 필터와는 AND 로 결합된다. */
export function matchSources<T extends { source: string }>(items: T[], selected: string[]): T[] {
  if (!selected.length) return items;
  const set = new Set(selected);
  return items.filter(a => set.has(a.source));
}
