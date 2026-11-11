/** 보험사·유관기관 드롭다운의 그룹(채널 companies.json, orgs.json). 이름 → 그룹, 그룹 표시 순서. */
type Named = { name: string; group: string };
export const groupMap = (items: Named[]): Record<string, string> => Object.fromEntries(items.map(c => [c.name, c.group]));
