/** 목록 화면 필터 패널(언론사·보험사·유관기관·안 읽은 것만·관련도 낮은 기사 포함)의 순수 로직.
 *  패널은 [필터] 버튼으로 접고 펼치며, 켜진 필터는 칩으로 보여 주고 칩에서 바로 해제한다.
 *  기사 걸러내기·건수 계산은 화면(app/[channel]/page.tsx)의 기존 로직 그대로다. */
import type { TabId } from './channels.ts';
import { addDays, weekRange } from './dates.ts';

export type PanelFilters = { sources: string[]; companies: string[]; orgs: string[]; unreadOnly: boolean; includeLow: boolean };
export type PanelLabels = { sources: string; companies: string; orgs: string };
export type ChipKind = 'sources' | 'companies' | 'orgs' | 'unread' | 'low' | 'date';
export type Chip = { key: string; kind: ChipKind; value?: string; kindLabel?: string; label: string };

/** 켜진 필터 칩: 보험사 → 유관기관 → 언론사(선택한 순서) → 안 읽은 것만 → 관련도 낮은 기사 포함. 북마크 탭에는 관련도 칩이 없다. */
export function panelChips(f: PanelFilters, L: PanelLabels, tab: TabId): Chip[] {
  const multi = (kind: 'sources' | 'companies' | 'orgs') => f[kind].map(v => ({ key: `${kind}:${v}`, kind, value: v, kindLabel: L[kind], label: v }));
  return [
    ...multi('companies'), ...multi('orgs'), ...multi('sources'),
    ...(f.unreadOnly ? [{ key: 'unread', kind: 'unread' as const, label: '안 읽은 것만' }] : []),
    ...(f.includeLow && tab !== 'bookmarks' ? [{ key: 'low', kind: 'low' as const, label: '관련도 낮은 기사 포함' }] : []),
  ];
}

/** 날짜 조건 칩 문구: 오늘·어제·이번 주, 그 밖 '11월 12일' 또는 '11월 6일~11월 12일'. 전체 기간(null)이면 칩 없음. */
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
export function dateChipLabel(f: { from: string; to: string }, today: string): string {
  if (f.from === f.to) return f.from === today ? '오늘' : f.from === addDays(today, -1) ? '어제' : md(f.from);
  const [ws, we] = weekRange(today);
  if (f.from === ws && f.to === we) return '이번 주';
  return `${md(f.from)}~${md(f.to)}`;
}
/** 날짜 칩(필터 칩 줄 맨 앞). '전체 뉴스' 기본값 '오늘'도 칩으로 보인다 — 아침에 오늘 기사가 0건일 때 이유가 보이게. */
export const dateChip = (f: { from: string; to: string } | null, today: string): Chip | null =>
  f ? { key: 'date', kind: 'date', kindLabel: '날짜', label: dateChipLabel(f, today) } : null;

/** 칩 하나 해제(날짜 칩은 화면이 날짜 조건을 '전체 기간'으로 바꾼다) */
export function removeChip(f: PanelFilters, chip: Pick<Chip, 'kind' | 'value'>): PanelFilters {
  switch (chip.kind) {
    case 'unread': return { ...f, unreadOnly: false };
    case 'low': return { ...f, includeLow: false };
    case 'date': return f;
    default: return { ...f, [chip.kind]: f[chip.kind].filter(v => v !== chip.value) };
  }
}

/** 패널 필터 모두 해제(필터 초기화의 패널 부분). 카테고리·검색·날짜는 화면이 함께 푼다. */
export const clearPanel = (f: PanelFilters): PanelFilters => ({ ...f, sources: [], companies: [], orgs: [], unreadOnly: false, includeLow: false });

/** 탭을 옮기면 언론사·유관기관은 풀고, 보험사 선택은 유지한다(사용자 상태에 저장되어 다음 방문에도 유지). 체크 두 개도 유지. */
export const onTabChange = (f: PanelFilters): PanelFilters => ({ ...f, sources: [], orgs: [] });
