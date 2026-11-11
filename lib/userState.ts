/** 사용자 상태(북마크·읽음·새 뉴스 확인 시각·선택한 보험사)를 한 덩어리로 다룬다. 저장 위치와 무관한 순수 로직.
 *  저장은 lib/storage.ts 의 어댑터(지금은 localStorage)가 맡는다. 형식 설명: docs/migration-localstorage.md */
import type { Article } from './news.ts';
import { type ReadMap, migrateReads, pruneReads } from './readState.ts';

export const SCHEMA_VERSION = 1;
export const FORMAT = 'heukseok-user-state';
/** localStorage 키: heukseok-v1:insurance */
export const storageKey = (channel: string, version = SCHEMA_VERSION) => `heukseok-v${version}:${channel}`;

export type UserState = { bookmarks: Record<string, Article>; lastConfirmed: string | null; readAt: ReadMap; companies: string[] };
export type StoredUserState = { schemaVersion: number; channel: string } & UserState;
export type ExportFile = { format: typeof FORMAT; exported_at: string } & StoredUserState;
export type LegacyKeys = { saved?: string; companies?: string };

export const EMPTY_STATE: UserState = { bookmarks: {}, lastConfirmed: null, readAt: {}, companies: [] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** 저장소에서 읽은 값(새 형식 또는 옛 actuary-news-hub-v3 형식)을 UserState 로. 예전 readIds 배열도 이전한다.
 *  companies 를 따로 주면(옛 actuary-news-hub-companies-v1 키) 그 값을 쓴다. */
export function fromStored(raw: unknown, companies?: unknown): UserState {
  const j = isObj(raw) ? raw : {};
  return {
    bookmarks: (isObj(j.bookmarks) ? j.bookmarks : {}) as Record<string, Article>,
    lastConfirmed: typeof j.lastConfirmed === 'string' ? j.lastConfirmed : null,
    readAt: migrateReads(j as { readAt?: unknown; readIds?: unknown }),
    companies: strList(companies !== undefined ? companies : j.companies),
  };
}

export const toStored = (channel: string, s: UserState): StoredUserState => ({ schemaVersion: SCHEMA_VERSION, channel, ...s });

export const toExportFile = (channel: string, s: UserState, now = new Date()): ExportFile => ({ format: FORMAT, exported_at: now.toISOString(), ...toStored(channel, s) });

// ---------- 가져오기 ----------

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const validIso = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !isNaN(Date.parse(v));

/** 가져온 북마크는 화면이 깨지지 않게 최소 필드를 확인하고(없으면 버림) 배열 필드는 빈 배열로 채운다. */
function cleanBookmarks(v: unknown): Record<string, Article> {
  const out: Record<string, Article> = {};
  if (!isObj(v)) return out;
  for (const [id, a] of Object.entries(v)) {
    if (!isObj(a) || typeof a.title !== 'string' || typeof a.url !== 'string' || typeof a.published_at !== 'string') continue;
    out[id] = { ...a, id, tags: strList(a.tags), companies: strList(a.companies), orgs: strList(a.orgs),
      source: typeof a.source === 'string' ? a.source : '', category: typeof a.category === 'string' ? a.category : '',
      score: typeof a.score === 'number' ? a.score : 2, collected_at: typeof a.collected_at === 'string' ? a.collected_at : a.published_at } as Article;
  }
  return out;
}

function cleanState(s: UserState): UserState {
  const readAt: ReadMap = {};
  for (const [id, at] of Object.entries(s.readAt)) if (validIso(at)) readAt[id] = at;
  return { bookmarks: cleanBookmarks(s.bookmarks), lastConfirmed: validIso(s.lastConfirmed) ? s.lastConfirmed : null, readAt, companies: [...new Set(s.companies)] };
}

const maybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
};

export type ImportResult = { state: UserState; kind: 'heukseok' | 'legacy'; channel: string };

/** 가져오기 파일·해시의 내용을 해석한다. 받는 형식:
 *  1) 흑석일보 내보내기 { format:'heukseok-user-state', schemaVersion, channel, ... }
 *  2) 옛 사이트 localStorage 묶음 { 'actuary-news-hub-v3': 값(객체 또는 JSON 문자열), 'actuary-news-hub-companies-v1': 배열 }
 *  3) 옛 키 값 그대로 { bookmarks, lastConfirmed, readAt | readIds }
 *  형식이 맞지 않으면 Error(사용자에게 보여 줄 문구). */
export function parseImport(raw: unknown, channel: string, legacy: LegacyKeys = {}): ImportResult {
  if (!isObj(raw)) throw new Error('JSON 객체가 아닙니다.');
  if (raw.format === FORMAT) {
    const v = Number(raw.schemaVersion);
    if (!Number.isInteger(v) || v < 1) throw new Error('schemaVersion 이 없습니다.');
    if (v > SCHEMA_VERSION) throw new Error(`더 새로운 형식(v${v})입니다. 사이트를 새로고침한 뒤 다시 시도하세요.`);
    if (raw.channel !== channel) throw new Error(`다른 채널(${String(raw.channel)})의 데이터입니다.`);
    return { state: cleanState(fromStored(raw)), kind: 'heukseok', channel };
  }
  if (legacy.saved && (legacy.saved in raw || (legacy.companies && legacy.companies in raw))) {
    const saved = maybeJson(raw[legacy.saved]);
    const comp = legacy.companies && legacy.companies in raw ? maybeJson(raw[legacy.companies]) : undefined;
    return { state: cleanState(fromStored(saved, comp)), kind: 'legacy', channel };
  }
  if (legacy.saved && ('bookmarks' in raw || 'readAt' in raw || 'readIds' in raw || 'lastConfirmed' in raw)) {
    return { state: cleanState(fromStored(raw)), kind: 'legacy', channel };
  }
  throw new Error('흑석일보 백업 파일 형식이 아닙니다.');
}

/** 기존 데이터와 합집합으로 병합. 북마크·읽음이 겹치면 기존 것을 유지하되 읽은 시각은 더 이른 쪽,
 *  확인 시각은 더 늦은 쪽, 선택한 보험사는 기존 순서 뒤에 새 항목을 붙인다. 읽음 한도 규칙(pruneReads)을 적용한다. */
export function mergeStates(cur: UserState, inc: UserState): UserState {
  const readAt: ReadMap = { ...inc.readAt };
  for (const [id, at] of Object.entries(cur.readAt)) readAt[id] = readAt[id] && readAt[id] < at ? readAt[id] : at;
  const lc = [cur.lastConfirmed, inc.lastConfirmed].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return {
    bookmarks: { ...inc.bookmarks, ...cur.bookmarks },
    lastConfirmed: lc,
    readAt: pruneReads(readAt, lc),
    companies: [...new Set([...cur.companies, ...inc.companies])],
  };
}

export type Summary = { bookmarks: number; reads: number; lastConfirmed: string | null; companies: number };
export const summarize = (s: UserState): Summary => ({ bookmarks: Object.keys(s.bookmarks).length, reads: Object.keys(s.readAt).length, lastConfirmed: s.lastConfirmed, companies: s.companies.length });
