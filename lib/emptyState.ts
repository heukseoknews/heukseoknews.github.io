/** 뉴스 목록이 비었을 때 보일 한 줄. 필터·검색이 켜져 있으면 '조건에 맞는 기사가 없습니다' + [필터 초기화] 하나,
 *  꺼져 있으면 원인에 맞는 한 줄만(초기화 버튼 없음). 조건별 진단('해제하면 N건')은 두지 않는다. */
import type { TabId } from './channels.ts';

export type EmptyKind = 'filtered' | 'noData' | 'noNew' | 'noBookmarks' | 'noToday' | 'noPress' | 'none';

export function emptyKind(o: { filtered: boolean; tab: TabId; channelArticles: number; todayDefault: boolean }): EmptyKind {
  if (o.filtered) return 'filtered';
  if (o.tab === 'bookmarks') return 'noBookmarks';
  if (!o.channelArticles) return 'noData';          // 채널에 기사가 아직 하나도 없음(새로 연 채널 등)
  if (o.tab === 'new') return 'noNew';
  if (o.tab === 'all' && o.todayDefault) return 'noToday';  // 전체 뉴스 기본(오늘)인데 오늘 기사가 아직 없음
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
