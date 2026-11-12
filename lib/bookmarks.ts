/** 북마크·폴더·태그(v2): 기사 스냅샷과 사용자 메타(폴더 1개·태그 여러 개·메모). 저장 위치와 무관한 순수 로직.
 *  지울 때는 바로 없애지 않고 삭제 표시(deletedAt)를 남긴다 — 다른 기기·서버와 합칠 때 지운 항목이 되살아나지 않게.
 *  형식·병합 규칙: docs/migration-localstorage.md, 서버 행: docs/auth-plan.md 3장. */
import type { Article } from './news.ts';

export const LIMITS = { folders: 20, tags: 50, memo: 200, tagsPerBookmark: 10, groupName: 20 } as const;
/** 삭제 표시를 지우는 기한(일). 이보다 오래 연결되지 않은 기기의 기록은 합칠 때 되살아날 수 있다. */
export const TOMBSTONE_DAYS = 30;
/** 시각을 모르는 옛 기록(v1 이전분·잘못된 값)의 수정 시각. 실제 수정은 항상 이보다 늦으므로 합칠 때 진다. */
export const UNKNOWN_TIME = '2000-01-01T00:00:00.000Z';

/** 기사 스냅샷: 기사 파일에서 사라져도 제목·링크·분류가 보이도록 북마크할 때 복사해 둔다. */
export type Snapshot = {
  title: string; url: string; source: string; source_type: 'media' | 'press';
  category: string; sub_categories: string[];
  /** 기사 분류 키워드(기사 파일의 tags). 사용자 태그(tags)와 구분한다. */
  keywords: string[];
  companies: string[]; orgs: string[];
  published_at: string; collected_at?: string; score?: number;
};
export type Bookmark = Snapshot & {
  id: string; channel: string;
  savedAt: string; updatedAt: string; deletedAt?: undefined;
  folderId?: string; tags: string[]; memo: string;
  /** 기사 정보를 찾지 못한 옛 북마크(id 만 남음). 기사 데이터를 불러오면 채운다. */
  missing?: true;
};
export type BookmarkTombstone = { id: string; channel: string; savedAt: string; updatedAt: string; deletedAt: string };
export type BookmarkEntry = Bookmark | BookmarkTombstone;
export type Group = { id: string; name: string; createdAt: string; updatedAt: string; deletedAt?: string };
export type GroupKind = 'folders' | 'tags';
export type BookmarkData = { bookmarks: Record<string, BookmarkEntry>; folders: Record<string, Group>; tags: Record<string, Group> };

export const isLive = (e: BookmarkEntry | undefined): e is Bookmark => !!e && !e.deletedAt;
const isLiveGroup = (g: Group | undefined): g is Group => !!g && !g.deletedAt;

// ---------- 정리(저장·가져오기 공통) ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const str = (v: unknown, d = '') => typeof v === 'string' ? v : d;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
export const validIso = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !isNaN(Date.parse(v));
const isoOr = (v: unknown, d: string) => validIso(v) ? v : d;
const ID = /^[\w.:-]{1,64}$/;
export const validId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

/** 메모: 앞뒤 공백 제거, 200자(코드 포인트) 초과분은 자른다. */
export const cleanMemo = (v: unknown) => [...str(v).trim()].slice(0, LIMITS.memo).join('');
const cleanName = (v: unknown) => [...str(v).trim().replace(/\s+/g, ' ')].slice(0, LIMITS.groupName).join('');

/** 기사(또는 기사 비슷한 객체)에서 스냅샷을 만든다. 제목·링크가 문자열이 아니면 null. */
export function snapshotOf(a: unknown): Snapshot | null {
  if (!isObj(a) || typeof a.title !== 'string' || typeof a.url !== 'string' || !a.title.trim()) return null;
  const s: Snapshot = {
    title: a.title, url: a.url, source: str(a.source), source_type: a.source_type === 'press' ? 'press' : 'media',
    category: str(a.category), sub_categories: strList(a.sub_categories),
    keywords: strList('keywords' in a ? a.keywords : a.tags), companies: strList(a.companies), orgs: strList(a.orgs),
    published_at: validIso(a.published_at) ? a.published_at : '',
  };
  if (validIso(a.collected_at)) s.collected_at = a.collected_at;
  if (typeof a.score === 'number' && a.score >= 0 && a.score <= 5) s.score = Math.round(a.score);
  return s;
}

const EMPTY_SNAPSHOT: Snapshot = { title: '', url: '', source: '', source_type: 'media', category: '', sub_categories: [], keywords: [], companies: [], orgs: [], published_at: '' };

function cleanEntry(id: string, v: unknown, channel: string): BookmarkEntry | null {
  if (!validId(id)) return null;
  const o = isObj(v) ? v : {};
  const updatedAt = isoOr(o.updatedAt, UNKNOWN_TIME);
  const savedAt = isoOr(o.savedAt, updatedAt);
  if (validIso(o.deletedAt)) return { id, channel, savedAt, updatedAt: updatedAt < o.deletedAt ? o.deletedAt : updatedAt, deletedAt: o.deletedAt };
  const snap = snapshotOf(o);
  const b: Bookmark = { ...(snap ?? EMPTY_SNAPSHOT), id, channel, savedAt, updatedAt, tags: [...new Set(strList(o.tags).filter(validId))].slice(0, LIMITS.tagsPerBookmark), memo: cleanMemo(o.memo) };
  if (validId(o.folderId)) b.folderId = o.folderId;
  if (!snap) b.missing = true;
  return b;
}

function cleanGroups(v: unknown): Record<string, Group> {
  const out: Record<string, Group> = {};
  if (!isObj(v)) return out;
  for (const [id, g] of Object.entries(v)) {
    if (!validId(id) || !isObj(g)) continue;
    const name = cleanName(g.name);
    const updatedAt = isoOr(g.updatedAt, UNKNOWN_TIME);
    const grp: Group = { id, name, createdAt: isoOr(g.createdAt, updatedAt), updatedAt };
    if (validIso(g.deletedAt)) { grp.deletedAt = g.deletedAt; if (grp.updatedAt < g.deletedAt) grp.updatedAt = g.deletedAt; }
    else if (!name) continue;
    out[id] = grp;
  }
  return out;
}

/** v2 저장값의 북마크·폴더·태그를 정리한다(잘못된 항목은 고치거나 버림, 제목이 없는 북마크는 '정보 없음'으로 보존). */
export function cleanBookmarkData(raw: { bookmarks?: unknown; folders?: unknown; tags?: unknown }, channel: string): BookmarkData {
  const bookmarks: Record<string, BookmarkEntry> = {};
  if (isObj(raw.bookmarks)) for (const [id, v] of Object.entries(raw.bookmarks)) { const e = cleanEntry(id, v, channel); if (e) bookmarks[id] = e; }
  return { bookmarks, folders: cleanGroups(raw.folders), tags: cleanGroups(raw.tags) };
}

/** v1 북마크(기사 객체 전체, 또는 id 만 있는 옛 형식)를 v2 로. 기사 정보가 없으면 id 와 '정보 없음' 표시로 보존한다.
 *  저장 시각을 모르므로 수집 시각(없으면 발행 시각)을 저장 시각으로 쓰고, 수정 시각은 UNKNOWN_TIME(어느 기기에서 이전해도 같은 값). */
export function migrateV1Bookmarks(raw: unknown, channel: string): Record<string, BookmarkEntry> {
  const out: Record<string, BookmarkEntry> = {};
  const put = (id: unknown, a: unknown) => {
    if (!validId(id) || out[id]) return;
    const snap = snapshotOf(a);
    const savedAt = snap ? (snap.collected_at || snap.published_at || UNKNOWN_TIME) : UNKNOWN_TIME;
    const b: Bookmark = { ...(snap ?? EMPTY_SNAPSHOT), id, channel, savedAt, updatedAt: UNKNOWN_TIME, tags: [], memo: '' };
    if (!snap) b.missing = true;
    out[id] = b;
  };
  if (Array.isArray(raw)) for (const x of raw) { if (typeof x === 'string') put(x, null); else if (isObj(x)) put(x.id, x); }
  else if (isObj(raw)) for (const [id, a] of Object.entries(raw)) put(id, a);
  return out;
}

// ---------- 읽기 ----------

export const liveBookmarks = (d: Pick<BookmarkData, 'bookmarks'>): Bookmark[] => Object.values(d.bookmarks).filter(isLive);
export const isBookmarked = (d: Pick<BookmarkData, 'bookmarks'>, id: string) => isLive(d.bookmarks[id]);
/** 살아 있는 폴더·태그(이름순) */
export const liveGroups = (d: BookmarkData, kind: GroupKind): Group[] => Object.values(d[kind]).filter(isLiveGroup).sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
/** 북마크의 폴더(지워졌거나 없는 폴더면 undefined) */
export const folderOf = (d: BookmarkData, b: Bookmark): Group | undefined => (b.folderId && isLiveGroup(d.folders[b.folderId]) ? d.folders[b.folderId] : undefined);
/** 북마크의 태그(지워진 태그는 빼고 이름순) */
export const tagsOf = (d: BookmarkData, b: Bookmark): Group[] => b.tags.map(t => d.tags[t]).filter(isLiveGroup).sort((a, b2) => a.name.localeCompare(b2.name, 'ko'));

/** 북마크를 목록·필터용 기사 모양으로(기존 북마크 탭·필터 로직을 그대로 쓰기 위해). 발행 시각을 모르면 저장 시각. */
export function toArticle(b: Bookmark): Article {
  return {
    id: b.id, title: b.title, url: b.url, source: b.source, source_type: b.source_type,
    published_at: b.published_at || b.savedAt, collected_at: b.collected_at ?? (b.published_at || b.savedAt), category: b.category,
    sub_categories: b.sub_categories, tags: b.keywords, companies: b.companies, orgs: b.orgs,
    score: b.score ?? 2, feed_name: '',
  };
}

// ---------- 바꾸기(모두 새 객체를 돌려준다) ----------

type WithBm = BookmarkData;
const tomb = (b: BookmarkEntry, now: string): BookmarkTombstone => ({ id: b.id, channel: b.channel, savedAt: b.savedAt, updatedAt: now, deletedAt: now });

export function addBookmark<S extends WithBm>(s: S, a: Article, channel: string, now: string): S {
  if (isLive(s.bookmarks[a.id])) return s;
  const snap = snapshotOf(a);
  if (!snap) return s;
  const b: Bookmark = { ...snap, id: a.id, channel, savedAt: now, updatedAt: now, tags: [], memo: '' };
  return { ...s, bookmarks: { ...s.bookmarks, [a.id]: b } };
}

export function removeBookmark<S extends WithBm>(s: S, id: string, now: string): S {
  const cur = s.bookmarks[id];
  if (!isLive(cur)) return s;
  return { ...s, bookmarks: { ...s.bookmarks, [id]: tomb(cur, now) } };
}

/** 지운 북마크를 되돌린다(지우기 직전 객체를 그대로, 수정 시각만 지금으로). */
export function restoreBookmark<S extends WithBm>(s: S, prev: Bookmark, now: string): S {
  if (isLive(s.bookmarks[prev.id])) return s;
  return { ...s, bookmarks: { ...s.bookmarks, [prev.id]: { ...prev, updatedAt: now } } };
}

export const toggleBookmark = <S extends WithBm>(s: S, a: Article, channel: string, now: string): S =>
  isLive(s.bookmarks[a.id]) ? removeBookmark(s, a.id, now) : addBookmark(s, a, channel, now);

export type BookmarkPatch = { folderId?: string | null; tags?: string[]; memo?: string };

/** 폴더·태그·메모 바꾸기. 지워진 폴더·태그는 받지 않고, 메모는 200자, 태그는 10개까지. 바뀐 것이 없으면 그대로. */
export function updateBookmark<S extends WithBm>(s: S, id: string, p: BookmarkPatch, now: string): S {
  const cur = s.bookmarks[id];
  if (!isLive(cur)) return s;
  const n: Bookmark = { ...cur };
  if (p.folderId !== undefined) { if (p.folderId && isLiveGroup(s.folders[p.folderId])) n.folderId = p.folderId; else delete n.folderId; }
  if (p.tags !== undefined) n.tags = [...new Set(p.tags)].filter(t => isLiveGroup(s.tags[t])).slice(0, LIMITS.tagsPerBookmark);
  if (p.memo !== undefined) n.memo = cleanMemo(p.memo);
  if (n.folderId === cur.folderId && n.memo === cur.memo && n.tags.join() === cur.tags.join()) return s;
  n.updatedAt = now;
  return { ...s, bookmarks: { ...s.bookmarks, [id]: n } };
}

/** 폴더·태그 id: 기기 사이에서 겹치지 않게 무작위 */
export const newId = (kind: GroupKind) => `${kind === 'folders' ? 'f' : 't'}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

const KIND_LABEL: Record<GroupKind, string> = { folders: '폴더', tags: '태그' };
function checkName(s: WithBm, kind: GroupKind, name: string, except?: string): string {
  const n = cleanName(name);
  if (!n) throw new Error(`${KIND_LABEL[kind]} 이름을 입력해 주세요.`);
  if (liveGroups(s, kind).some(g => g.id !== except && g.name.toLowerCase() === n.toLowerCase())) throw new Error(`같은 이름의 ${KIND_LABEL[kind]}가 있습니다.`);
  return n;
}

/** 폴더·태그 만들기. 한도(폴더 20·태그 50)·빈 이름·같은 이름이면 Error(화면 문구). */
export function createGroup<S extends WithBm>(s: S, kind: GroupKind, name: string, now: string, id = newId(kind)): { state: S; id: string } {
  const n = checkName(s, kind, name);
  if (liveGroups(s, kind).length >= LIMITS[kind]) throw new Error(`${KIND_LABEL[kind]}는 ${LIMITS[kind]}개까지 만들 수 있습니다.`);
  return { state: { ...s, [kind]: { ...s[kind], [id]: { id, name: n, createdAt: now, updatedAt: now } } }, id };
}

export function renameGroup<S extends WithBm>(s: S, kind: GroupKind, id: string, name: string, now: string): S {
  const g = s[kind][id];
  if (!isLiveGroup(g)) return s;
  const n = checkName(s, kind, name, id);
  if (n === g.name) return s;
  return { ...s, [kind]: { ...s[kind], [id]: { ...g, name: n, updatedAt: now } } };
}

/** 폴더·태그 지우기: 삭제 표시만 남긴다. 그 폴더·태그를 쓰던 북마크는 그대로 두고, 화면에서는 '폴더 없음'·태그 없음으로 보인다. */
export function deleteGroup<S extends WithBm>(s: S, kind: GroupKind, id: string, now: string): S {
  const g = s[kind][id];
  if (!isLiveGroup(g)) return s;
  return { ...s, [kind]: { ...s[kind], [id]: { ...g, updatedAt: now, deletedAt: now } } };
}

/** 기사 데이터에서 '정보 없음' 북마크의 스냅샷을 채운다(사용자가 바꾼 것이 아니므로 수정 시각은 그대로). */
export function fillMissing<S extends WithBm>(s: S, articles: Article[]): S {
  const need = liveBookmarks(s).filter(b => b.missing);
  if (!need.length) return s;
  const byId = new Map(articles.map(a => [a.id, a]));
  let changed = false;
  const bookmarks = { ...s.bookmarks };
  for (const b of need) {
    const snap = snapshotOf(byId.get(b.id));
    if (!snap) continue;
    const { missing: _m, ...rest } = b;
    bookmarks[b.id] = { ...rest, ...snap, savedAt: b.savedAt === UNKNOWN_TIME ? (snap.collected_at || snap.published_at || UNKNOWN_TIME) : b.savedAt };
    changed = true;
  }
  return changed ? { ...s, bookmarks } : s;
}

/** 기한(30일)이 지난 삭제 표시를 지우고, 없어진 폴더·태그를 가리키는 참조를 정리한다. */
export function purgeTombstones<S extends WithBm>(s: S, now: string, days = TOMBSTONE_DAYS): S {
  const cut = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  let changed = false;
  const keep = <T extends { deletedAt?: string }>(m: Record<string, T>) => {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(m)) { if (v.deletedAt && v.deletedAt < cut) changed = true; else out[k] = v; }
    return out;
  };
  const folders = keep(s.folders), tags = keep(s.tags), bookmarks = keep(s.bookmarks);
  for (const [id, b] of Object.entries(bookmarks)) {
    if (!isLive(b)) continue;
    const fid = b.folderId && !folders[b.folderId] ? undefined : b.folderId;
    const tg = b.tags.filter(t => tags[t]);
    if (fid !== b.folderId || tg.length !== b.tags.length) {
      const n: Bookmark = { ...b, tags: tg };
      if (fid === undefined) delete n.folderId;
      bookmarks[id] = n; changed = true;
    }
  }
  return changed ? { ...s, bookmarks, folders, tags } : s;
}

// ---------- 병합 ----------

/** 같은 항목은 수정 시각(updatedAt)이 늦은 쪽을 쓴다(삭제 표시도 같은 기준). 같으면 cur(지금 이 기기). */
function lww<T extends { updatedAt: string }>(cur: Record<string, T>, inc: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...inc };
  for (const [k, v] of Object.entries(cur)) { const o = out[k]; out[k] = o && o.updatedAt > v.updatedAt ? o : v; }
  return out;
}

export function mergeBookmarkData(cur: BookmarkData, inc: BookmarkData): BookmarkData {
  return { bookmarks: lww(cur.bookmarks, inc.bookmarks), folders: lww(cur.folders, inc.folders), tags: lww(cur.tags, inc.tags) };
}

/** 내보내기·요약용: 삭제 표시를 뺀 북마크·폴더·태그 */
export function withoutTombstones(d: BookmarkData): BookmarkData {
  const live = <T extends { deletedAt?: string }>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([, v]) => !v.deletedAt));
  return { bookmarks: live(d.bookmarks), folders: live(d.folders), tags: live(d.tags) };
}
