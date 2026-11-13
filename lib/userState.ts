/** 사용자 상태(북마크·폴더·태그·읽음·새 뉴스 확인 시각·선택한 보험사)를 채널별 한 덩어리로 다룬다. 저장 위치와 무관한 순수 로직.
 *  저장은 lib/storage.ts 의 어댑터(지금은 localStorage)가 맡는다. 형식 설명: docs/migration-localstorage.md
 *  v2(2026-11): 북마크에 사용자 메타(폴더·태그·메모)와 삭제 표시를 더했다. v1 은 읽을 때 자동으로 바꾼다. */
import { type BookmarkData, type BookmarkEntry, type Group, cleanBookmarkData, liveBookmarks, liveGroups, mergeBookmarkData, migrateV1Bookmarks, purgeTombstones, validIso, withoutTombstones } from './bookmarks.ts';
import { type ReadMap, migrateReads, pruneReads } from './readState.ts';
import { type Dismissed, cleanDismissed, fromReads, mergeDismissed, pruneDismissed } from './dismissed.ts';
import { DIRECTORY } from './directory.ts';

export const SCHEMA_VERSION = 2;
export const FORMAT = 'heukseok-user-state';
/** localStorage 키: heukseok-v2:insurance (v1 키 heukseok-v1:insurance 는 읽기만 하고 지우지 않는다) */
export const storageKey = (channel: string, version = SCHEMA_VERSION) => `heukseok-v${version}:${channel}`;

/** dismissed: 새 뉴스 탭에서 치운 기사(lib/dismissed.ts). 저장값에 이 키가 없으면(이전 버전) 읽을 때 한 번 옛 '읽음=숨김' 기록에서 옮긴다. */
export type UserState = BookmarkData & { lastConfirmed: string | null; readAt: ReadMap; dismissed: Dismissed; companies: string[] };
export type StoredUserState = { schemaVersion: number; channel: string } & UserState;
export type ExportFile = { format: typeof FORMAT; exported_at: string } & StoredUserState;
export type LegacyKeys = { saved?: string; companies?: string };

export const EMPTY_STATE: UserState = { bookmarks: {}, folders: {}, tags: {}, lastConfirmed: null, readAt: {}, dismissed: [], companies: [] };

/** 두 시각 중 늦은 것(시각으로 비교 — Z·+00:00·마이크로초가 섞여도). 잘못된 값은 버린다. 둘 다 없으면 null */
export function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ok = (v: string | null | undefined): v is string => validIso(v);
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** 저장소에서 읽은 값(v2, v1, 옛 actuary-news-hub-v3 형식)을 UserState 로. v1 북마크는 v2 로 바꾸고(정보가 없으면 id 보존),
 *  예전 readIds 배열도 이전한다. companies 를 따로 주면(옛 actuary-news-hub-companies-v1 키) 그 값을 쓴다.
 *  dismissed 키가 없는 저장값(치우기 도입 전)은 그때 새 뉴스에서 숨겨져 있던 읽음 기록을 치운 기사로 옮긴다(목록이 갑자기 늘지 않게).
 *  now 를 주면 기한이 지난 삭제 표시·치운 기록을 정리한다. */
export const needsDismissMigration = (raw: unknown): boolean => !(isObj(raw) && Array.isArray(raw.dismissed));

export function fromStored(raw: unknown, channel: string, companies?: unknown, now?: string): UserState {
  const j = isObj(raw) ? raw : {};
  const v2 = Number(j.schemaVersion) >= 2;
  const data: BookmarkData = v2 ? cleanBookmarkData(j, channel) : { bookmarks: migrateV1Bookmarks(j.bookmarks, channel), folders: {}, tags: {} };
  const lastConfirmed = validIso(j.lastConfirmed) ? j.lastConfirmed : null;
  const readAt = cleanReads(migrateReads(j as { readAt?: unknown; readIds?: unknown }));
  const dismissed = needsDismissMigration(j) ? fromReads(readAt, lastConfirmed) : cleanDismissed(j.dismissed);
  const s: UserState = {
    ...data,
    lastConfirmed,
    readAt,
    dismissed: now ? pruneDismissed(dismissed, now, lastConfirmed) : dismissed,
    companies: [...new Set(strList(companies !== undefined ? companies : j.companies))],
  };
  return now ? purgeTombstones(s, now) : s;
}

const cleanReads = (m: ReadMap): ReadMap => {
  const out: ReadMap = {};
  for (const [id, at] of Object.entries(m)) if (validIso(at)) out[id] = at;
  return out;
};

export const toStored = (channel: string, s: UserState): StoredUserState => ({ schemaVersion: SCHEMA_VERSION, channel, ...s });

/** 내보내기 파일: 삭제 표시는 넣지 않는다(지금 가진 것만). */
export const toExportFile = (channel: string, s: UserState, now = new Date()): ExportFile => ({ format: FORMAT, exported_at: now.toISOString(), ...toStored(channel, { ...s, ...withoutTombstones(s) }) });

// ---------- 가져오기 ----------

const maybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
};

export type ImportResult = { state: UserState; kind: 'heukseok' | 'legacy'; channel: string; version: number };

/** 가져오기 파일·해시의 내용을 해석한다. 받는 형식:
 *  1) 흑석일보 내보내기 { format:'heukseok-user-state', schemaVersion: 1 | 2, channel, ... }
 *  2) 옛 사이트 localStorage 묶음 { 'actuary-news-hub-v3': 값(객체 또는 JSON 문자열), 'actuary-news-hub-companies-v1': 배열 }
 *  3) 옛 키 값 그대로 { bookmarks, lastConfirmed, readAt | readIds }
 *  형식이 맞지 않으면 Error(사용자에게 보여 줄 문구). */
export function parseImport(raw: unknown, channel: string, legacy: LegacyKeys = {}): ImportResult {
  if (!isObj(raw)) throw new Error('백업 파일 형식이 아닙니다.');
  if (raw.format === FORMAT) {
    const v = Number(raw.schemaVersion);
    if (!Number.isInteger(v) || v < 1) throw new Error('백업 파일이 손상되었습니다.');
    if (v > SCHEMA_VERSION) throw new Error('새 버전에서 만든 파일입니다. 새로고침 후 다시 시도하세요.');
    if (raw.channel !== channel) throw new Error(`다른 채널(${DIRECTORY.find(d => d.slug === raw.channel)?.name ?? String(raw.channel)})의 백업입니다.`);
    return { state: fromStored(raw, channel), kind: 'heukseok', channel, version: v };
  }
  if (legacy.saved && (legacy.saved in raw || (legacy.companies && legacy.companies in raw))) {
    const saved = maybeJson(raw[legacy.saved]);
    const comp = legacy.companies && legacy.companies in raw ? maybeJson(raw[legacy.companies]) : undefined;
    return { state: fromStored(isObj(saved) ? { ...saved, schemaVersion: 1 } : saved, channel, comp), kind: 'legacy', channel, version: 1 };
  }
  if (legacy.saved && ('bookmarks' in raw || 'readAt' in raw || 'readIds' in raw || 'lastConfirmed' in raw)) {
    return { state: fromStored({ ...raw, schemaVersion: 1 }, channel), kind: 'legacy', channel, version: 1 };
  }
  throw new Error('흑석일보 백업 파일 형식이 아닙니다.');
}

/** 기존 데이터와 병합.
 *  - 북마크·폴더·태그: 같은 항목은 수정 시각이 늦은 쪽(삭제 표시도 같은 기준, 같으면 기존 것). 그래서 지운 항목이 되살아나지 않는다.
 *  - 읽음: 합집합, 같은 기사는 더 이른 읽은 시각. 치운 기사: 합집합, 같은 기사는 늦은 시각. 확인 시각은 더 늦은 쪽. 선택한 보험사는 기존 순서 뒤에 새 항목.
 *  - 그 뒤 읽음 한도 규칙(pruneReads). */
export function mergeStates(cur: UserState, inc: UserState): UserState {
  const readAt: ReadMap = { ...inc.readAt };
  for (const [id, at] of Object.entries(cur.readAt)) readAt[id] = readAt[id] && readAt[id] < at ? readAt[id] : at;
  const lc = laterIso(cur.lastConfirmed, inc.lastConfirmed);
  return {
    ...mergeBookmarkData(cur, inc),
    lastConfirmed: lc,
    readAt: pruneReads(readAt, lc),
    dismissed: mergeDismissed(cur.dismissed, inc.dismissed),
    companies: [...new Set([...cur.companies, ...inc.companies])],
  };
}

export type Summary = { bookmarks: number; reads: number; lastConfirmed: string | null; companies: number; folders: number; tags: number; memos: number };
export const summarize = (s: UserState): Summary => {
  const live = liveBookmarks(s);
  return { bookmarks: live.length, reads: Object.keys(s.readAt).length, lastConfirmed: s.lastConfirmed, companies: s.companies.length,
    folders: liveGroups(s, 'folders').length, tags: liveGroups(s, 'tags').length, memos: live.filter(b => b.memo).length };
};

export type { BookmarkEntry, Group };
