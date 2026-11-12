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

/** 날짜 조건. null 은 전체 기간 */
export type DateRange = { from: string; to: string };
/** '전체 뉴스' 기본 기간: 오늘 포함 최근 3일. 수집이 하루 1회(05:37 KST)라 '오늘'만 보이면 아침에 자주 비어서다. */
export const RECENT_DAYS = 3;
export const recentRange = (today: string): DateRange => ({ from: addDays(today, -(RECENT_DAYS - 1)), to: today });
/** 탭별 기본 날짜: '전체 뉴스'는 최근 3일, 다른 탭은 전체 기간 */
export const defaultDate = (tab: TabId, today: string): DateRange | null => tab === 'all' ? recentRange(today) : null;
const same = (a: DateRange | null, b: DateRange | null) => a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
/** 날짜 상태: default(탭 기본값 그대로) · today(사용자가 '오늘'을 고름) · changed(그 밖에 바꿈, 전체 기간 포함) */
export type DateState = 'default' | 'today' | 'changed';
export function dateState(f: DateRange | null, tab: TabId, today: string): DateState {
  if (same(f, defaultDate(tab, today))) return 'default';
  return f && f.from === today && f.to === today ? 'today' : 'changed';
}
/** 필터 버튼 배지 숫자: 칩 수에서 기본 날짜 칩은 뺀다(사용자가 날짜를 바꿨을 때만 날짜를 센다) */
export const badgeCount = (chips: Chip[], date: DateState): number => chips.filter(c => c.kind !== 'date' || date !== 'default').length;

/** 날짜 조건 칩 문구: 오늘·어제·최근 3일·이번 주, 그 밖 '11월 12일' 또는 '11월 6일~11월 12일' */
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
export function dateChipLabel(f: DateRange, today: string): string {
  if (f.from === f.to) return f.from === today ? '오늘' : f.from === addDays(today, -1) ? '어제' : md(f.from);
  if (same(f, recentRange(today))) return `최근 ${RECENT_DAYS}일`;
  const [ws, we] = weekRange(today);
  if (f.from === ws && f.to === we) return '이번 주';
  return `${md(f.from)}~${md(f.to)}`;
}
/** 날짜 칩(필터 칩 줄 맨 앞). 날짜가 걸려 있으면 칩('전체 뉴스' 기본 '최근 3일'도 보이되 배지 숫자에는 세지 않음, badgeCount).
 *  기본과 다르면 칩과 배지가 있다: '전체 뉴스'에서 전체 기간을 고르면 '전체 기간' 칩. 기본이 전체 기간인 탭은 칩 없음. */
export const dateChip = (f: DateRange | null, today: string, tab: TabId): Chip | null =>
  f ? { key: 'date', kind: 'date', kindLabel: '날짜', label: dateChipLabel(f, today) }
    : defaultDate(tab, today) ? { key: 'date', kind: 'date', kindLabel: '날짜', label: '전체 기간' } : null;

/** 칩 하나 해제(날짜 칩은 화면이 처리: 날짜가 걸려 있으면 '전체 기간'으로, '전체 기간' 칩이면 탭 기본으로) */
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
