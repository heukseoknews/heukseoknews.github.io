/** 마이페이지 북마크 목록의 순수 로직: 걸러내기(카테고리·검색·출처·보험사·기관·기간·읽음·폴더·태그), 정렬, 카테고리별 묶기. */
import { type Bookmark, type BookmarkData, folderOf } from './bookmarks.ts';
import { UNCATEGORIZED } from './news.ts';

export type Period = 'all' | '7' | '30' | '90' | '365';
export type ReadFilter = 'all' | 'unread' | 'read';
export type SortKey = 'saved' | 'published';
/** 폴더 선택: 전체, 폴더 없음, 폴더 id */
export type FolderPick = 'all' | 'none' | string;
export type MyFilters = {
  category: string; q: string; sources: string[]; companies: string[]; orgs: string[];
  period: Period; read: ReadFilter; folder: FolderPick; tags: string[];
};
export const EMPTY_FILTERS: MyFilters = { category: '전체', q: '', sources: [], companies: [], orgs: [], period: 'all', read: 'all', folder: 'all', tags: [] };
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: '전체 기간' }, { id: '7', label: '최근 1주' }, { id: '30', label: '최근 1개월' }, { id: '90', label: '최근 3개월' }, { id: '365', label: '최근 1년' },
];

/** 발행 시각(모르면 저장 시각) */
export const whenPublished = (b: Bookmark) => b.published_at || b.savedAt;

type Ctx = { data: BookmarkData; read: Set<string>; now: number };
export type Skip = 'category' | 'sources' | 'companies' | 'orgs' | 'folder' | 'tags';

/** 모든 조건을 AND 로. 다중 선택(출처·보험사·기관·태그)은 하나라도 일치(OR). skip 으로 한 조건만 빼고(건수 계산용) 거른다. */
export function matches(b: Bookmark, f: MyFilters, ctx: Ctx, skip?: Skip): boolean {
  if (skip !== 'category' && f.category !== '전체' && (b.category || UNCATEGORIZED) !== f.category) return false;
  if (skip !== 'sources' && f.sources.length && !f.sources.includes(b.source)) return false;
  if (skip !== 'companies' && f.companies.length && !b.companies.some(c => f.companies.includes(c))) return false;
  if (skip !== 'orgs' && f.orgs.length && !b.orgs.some(o => f.orgs.includes(o))) return false;
  if (f.period !== 'all' && Date.parse(whenPublished(b)) < ctx.now - Number(f.period) * 86_400_000) return false;
  if (f.read === 'unread' && ctx.read.has(b.id)) return false;
  if (f.read === 'read' && !ctx.read.has(b.id)) return false;
  if (skip !== 'folder' && f.folder !== 'all') {
    const fid = folderOf(ctx.data, b)?.id;
    if (f.folder === 'none' ? !!fid : fid !== f.folder) return false;
  }
  if (skip !== 'tags' && f.tags.length && !b.tags.some(t => f.tags.includes(t) && ctx.data.tags[t] && !ctx.data.tags[t].deletedAt)) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${b.title}\n${b.memo}`.toLowerCase().includes(q)) return false;
  return true;
}

export function sortBookmarks(list: Bookmark[], key: SortKey): Bookmark[] {
  const k = key === 'saved' ? (b: Bookmark) => b.savedAt : whenPublished;
  return [...list].sort((a, b) => k(b).localeCompare(k(a)) || a.id.localeCompare(b.id));
}

/** 카테고리별로 묶는다: 채널 카테고리 순서, 그 밖(미분류 등)은 뒤에 이름순. 묶음 안은 받은 순서 그대로. */
export function groupByCategory(list: Bookmark[], order: string[]): { category: string; items: Bookmark[] }[] {
  const m = new Map<string, Bookmark[]>();
  for (const b of list) { const c = b.category || UNCATEGORIZED; if (!m.has(c)) m.set(c, []); m.get(c)!.push(b); }
  const known = order.filter(c => m.has(c));
  const rest = [...m.keys()].filter(c => !order.includes(c)).sort((a, b) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b, 'ko')));
  return [...known, ...rest].map(category => ({ category, items: m.get(category)! }));
}

/** 켜진 조건 수(카테고리·검색 제외 — 필터 버튼 배지) */
export const activeCount = (f: MyFilters) =>
  f.sources.length + f.companies.length + f.orgs.length + (f.period !== 'all' ? 1 : 0) + (f.read !== 'all' ? 1 : 0);
