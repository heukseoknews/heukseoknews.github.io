/** 뉴스 목록이 비었을 때 보일 한 줄. 필터·검색이 켜져 있으면 '조건에 맞는 기사가 없습니다' + [필터 초기화] 하나,
 *  꺼져 있으면 원인에 맞는 한 줄만. 조건별 진단('해제하면 N건')은 두지 않는다.
 *  날짜: 기본은 모든 탭이 '기간 제한 없음'이라 숨은 날짜 조건이 없다. 사용자가 고른 기간은 필터다.
 *  단 '전체 뉴스'에서 '오늘'만 고른 경우는 '오늘 올라온 기사가 아직 없습니다' + [어제 보기]. */
import type { TabId } from './channels.ts';
import type { DateState } from './filterState.ts';

export type EmptyKind = 'filtered' | 'noData' | 'noNew' | 'noBookmarks' | 'noToday' | 'noPress' | 'none';

export function emptyKind(o: { filtered: boolean; date: DateState; tab: TabId; channelArticles: number }): EmptyKind {
  if (o.filtered) return 'filtered';                              // 날짜 밖의 조건(카테고리·검색·패널 필터)
  if (o.date === 'today' && o.tab === 'all') return 'noToday';    // '오늘'을 직접 고름
  if (o.date !== 'default') return 'filtered';                    // 그 밖에 날짜를 바꿈
  if (o.tab === 'bookmarks') return 'noBookmarks';
  if (!o.channelArticles) return 'noData';          // 채널에 기사가 아직 하나도 없음(새로 연 채널 등)
  if (o.tab === 'new') return 'noNew';
  if (o.tab === 'press') return 'noPress';
  return 'none';
}

export const EMPTY_TEXT: Record<EmptyKind, string> = {
  filtered: '조건에 맞는 기사가 없습니다',
  noData: '아직 모은 기사가 없습니다',
  noNew: '새 기사가 없습니다',
  noBookmarks: '북마크한 기사가 없습니다',
  noToday: '오늘 올라온 기사가 아직 없습니다',
  noPress: '공식 발표가 없습니다',
  none: '기사가 없습니다',
};
