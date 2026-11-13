/** 목록 화면 필터 패널(언론사·보험사·유관기관·안 읽은 것만·관련도 낮은 기사 포함·치운 기사 포함)의 순수 로직.
 *  패널은 [필터] 버튼으로 접고 펼치며, 켜진 필터는 칩으로 보여 주고 칩에서 바로 해제한다.
 *  기사 걸러내기·건수 계산은 화면(app/[channel]/page.tsx)의 기존 로직 그대로다. */
import type { TabId } from './channels.ts';
import { addDays } from './dates.ts';

/** includeDismissed: 새 뉴스 탭에서 치운 기사도 흐리게 보이기(기본 꺼짐, 새 뉴스 탭에만 있음) */
export type PanelFilters = { sources: string[]; companies: string[]; orgs: string[]; unreadOnly: boolean; includeLow: boolean; includeDismissed?: boolean };
export type PanelLabels = { sources: string; companies: string; orgs: string };
export type ChipKind = 'sources' | 'companies' | 'orgs' | 'unread' | 'low' | 'dismissed' | 'date';
export type Chip = { key: string; kind: ChipKind; value?: string; kindLabel?: string; label: string };

/** 켜진 필터 칩: 보험사 → 유관기관 → 언론사(선택한 순서) → 안 읽은 것만 → 관련도 낮은 기사 포함 → 치운 기사 포함.
 *  북마크 탭에는 관련도 칩이 없고, 치운 기사 칩은 새 뉴스 탭에만 있다. */
export function panelChips(f: PanelFilters, L: PanelLabels, tab: TabId): Chip[] {
  const multi = (kind: 'sources' | 'companies' | 'orgs') => f[kind].map(v => ({ key: `${kind}:${v}`, kind, value: v, kindLabel: L[kind], label: v }));
  return [
    ...multi('companies'), ...multi('orgs'), ...multi('sources'),
    ...(f.unreadOnly ? [{ key: 'unread', kind: 'unread' as const, label: '안 읽은 것만' }] : []),
    ...(f.includeLow && tab !== 'bookmarks' ? [{ key: 'low', kind: 'low' as const, label: '관련도 낮은 기사 포함' }] : []),
    ...(f.includeDismissed && tab === 'new' ? [{ key: 'dismissed', kind: 'dismissed' as const, label: '치운 기사 포함' }] : []),
  ];
}

/** 날짜 조건. null 은 기간 제한 없음 */
export type DateRange = { from: string; to: string };
/** 탭별 기본 날짜: 모든 탭이 '기간 제한 없음'(2026-11-13 '전체 뉴스'의 최근 3일 기본을 없앰 — 숨은 기본 조건이 없게).
 *  새 뉴스의 범위는 날짜가 아니라 '마지막 확인' 기준이라 여기와 무관하다. */
export const defaultDate = (_tab: TabId, _today: string): DateRange | null => null;
const same = (a: DateRange | null, b: DateRange | null) => a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
/** 날짜 상태: default(제한 없음) · today(사용자가 '오늘'을 고름) · changed(그 밖에 고름) */
export type DateState = 'default' | 'today' | 'changed';
export function dateState(f: DateRange | null, tab: TabId, today: string): DateState {
  if (same(f, defaultDate(tab, today))) return 'default';
  return f && f.from === today && f.to === today ? 'today' : 'changed';
}
/** 필터 버튼 배지 숫자: 칩 수(기간 칩은 기간을 골랐을 때만 생긴다) */
export const badgeCount = (chips: Chip[], date: DateState): number => chips.filter(c => c.kind !== 'date' || date !== 'default').length;

/** 기간 칩 문구: 오늘 · 최근 3일/7일/30일 · 이번 달, 그 밖은 '11.12' 또는 '11.01~11.10'(올해가 아니면 연도까지) */
const md = (d: string, today: string) => (d.slice(0, 4) === today.slice(0, 4) ? '' : `${d.slice(0, 4)}.`) + `${d.slice(5, 7)}.${d.slice(8, 10)}`;
export function dateChipLabel(f: DateRange, today: string): string {
  if (f.from === f.to) return f.from === today ? '오늘' : md(f.from, today);
  if (f.to === today) {
    for (const n of [3, 7, 30]) if (f.from === addDays(today, -(n - 1))) return `최근 ${n}일`;
    if (f.from === `${today.slice(0, 7)}-01`) return '이번 달';
  }
  return `${md(f.from, today)}~${md(f.to, today)}`;
}
/** 기간 칩(필터 칩 줄 맨 앞): 기간을 골랐을 때만 '기간 11.01~11.10 ×'. 제한 없음(기본)이면 칩 없음. */
export const dateChip = (f: DateRange | null, today: string, _tab: TabId): Chip | null =>
  f ? { key: 'date', kind: 'date', kindLabel: '기간', label: dateChipLabel(f, today) } : null;

/** 칩 하나 해제(기간 칩은 화면이 처리: 기간 제한 없음으로) */
export function removeChip(f: PanelFilters, chip: Pick<Chip, 'kind' | 'value'>): PanelFilters {
  switch (chip.kind) {
    case 'unread': return { ...f, unreadOnly: false };
    case 'low': return { ...f, includeLow: false };
    case 'dismissed': return { ...f, includeDismissed: false };
    case 'date': return f;
    default: return { ...f, [chip.kind]: f[chip.kind].filter(v => v !== chip.value) };
  }
}

/** 패널 필터 모두 해제(필터 초기화의 패널 부분). 카테고리·검색·날짜는 화면이 함께 푼다. */
export const clearPanel = (f: PanelFilters): PanelFilters => ({ ...f, sources: [], companies: [], orgs: [], unreadOnly: false, includeLow: false, includeDismissed: false });

/** 탭을 옮기면 언론사·유관기관은 풀고, 보험사 선택은 유지한다(사용자 상태에 저장되어 다음 방문에도 유지). 안 읽은 것만·관련도 체크도 유지.
 *  치운 기사 포함은 새 뉴스 탭에만 있으므로 탭을 옮기면 끈다(돌아오면 기본: 치운 기사 숨김). */
export const onTabChange = (f: PanelFilters): PanelFilters => ({ ...f, sources: [], orgs: [], includeDismissed: false });
