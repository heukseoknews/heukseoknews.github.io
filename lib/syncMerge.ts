/** 서버 동기화의 순수 로직: 사용자 상태 ↔ 서버 행(user_state) 변환, 3-방향 병합, 내용 비교. 설계: docs/auth-plan.md 3.3·3.4.
 *  병합 규칙
 *  - 북마크·목록·태그: 같은 id 는 updatedAt 이 늦은 쪽(삭제 표시도 같은 기준). 서로 다른 항목은 모두 남는다(합집합) → 두 기기에서 따로 담은 북마크는 사라지지 않는다.
 *    지운 항목은 삭제 표시(30일 보존)로 전달되어 되살아나지 않는다. 목록 소속·태그·메모는 북마크 단위로 함께 고른다.
 *  - 읽음·선택한 보험사: 삭제 표시가 없어 '마지막으로 서버와 맞춘 내용(기준본)'과 비교한다(한쪽에만 있고 기준본에 있었으면 다른 쪽에서 지운 것).
 *  - 마지막 확인 시각: 늦은 쪽. 치운 기사(dismissed): 서버에 저장하지 않으므로 이 기기 것 그대로. */
import { mergeBookmarkData } from './bookmarks.ts';
import { pruneReads } from './readState.ts';
import { type UserState, fromStored } from './userState.ts';

/** 서버 행(user_state)의 내용 열. user_id·channel·rev·시각은 따로 다룬다 */
export type Row = {
  schema_version: number;
  bookmarks: UserState['bookmarks']; folders: UserState['folders']; tags: UserState['tags'];
  read_at: UserState['readAt']; last_confirmed: string | null; companies: string[];
};
/** 3-방향 병합에 쓰는 기준본(크기를 줄이려고 읽음은 id 만) */
export type Base = { readIds: string[]; companies: string[] };

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);   // 서버 timestamptz(+00:00) → 화면과 같은 Z 형식

export const toRow = (s: UserState): Row => ({
  schema_version: 2, bookmarks: s.bookmarks, folders: s.folders, tags: s.tags,
  read_at: s.readAt, last_confirmed: iso(s.lastConfirmed), companies: s.companies,
});
/** 서버 행 → 사용자 상태(정리 규칙은 저장값 읽기와 같다). 치운 기사는 서버에 없으므로 빈 목록(옛 읽음에서 옮기지 않게 명시) */
export const fromRow = (r: Partial<Row> | null | undefined, channel: string): UserState => fromStored({
  schemaVersion: r?.schema_version ?? 2, bookmarks: r?.bookmarks, folders: r?.folders, tags: r?.tags,
  readAt: r?.read_at, lastConfirmed: iso(r?.last_confirmed ?? null), companies: r?.companies, dismissed: [],
}, channel);
export const baseOf = (s: UserState): Base => ({ readIds: Object.keys(s.readAt), companies: [...s.companies] });

/** 키 순서와 무관한 JSON(내용 비교·해시용) */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** 서버에 올리는 내용의 해시(마지막으로 맞춘 내용과 같은지 보는 데만 쓴다. FNV-1a 두 갈래) */
export function contentHash(s: UserState): string {
  const t = stable(toRow(s));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x5bd1e995); }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${t.length}`;
}
export const sameContent = (a: UserState, b: UserState) => stable(toRow(a)) === stable(toRow(b));

/** 3-방향 병합. base 가 없으면(처음 맞출 때) 읽음·보험사는 합집합 */
export function mergeStates3(base: Base | null, local: UserState, server: UserState): UserState {
  const had = new Set(base?.readIds ?? []);
  const readAt: UserState['readAt'] = {};
  for (const [id, at] of Object.entries(local.readAt)) {
    const s = server.readAt[id];
    if (s) readAt[id] = s < at ? s : at;
    else if (!base || !had.has(id)) readAt[id] = at;            // 서버에 없고 기준본에도 없었음 = 이 기기에서 새로 읽음
  }
  for (const [id, at] of Object.entries(server.readAt)) if (!(id in local.readAt) && (!base || !had.has(id))) readAt[id] = at;
  const hadCo = new Set(base?.companies ?? []);
  const companies = [
    ...local.companies.filter(c => server.companies.includes(c) || !base || !hadCo.has(c)),
    ...server.companies.filter(c => !local.companies.includes(c) && (!base || !hadCo.has(c))),
  ];
  const lc = [local.lastConfirmed, server.lastConfirmed].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { ...mergeBookmarkData(local, server), lastConfirmed: lc, readAt: pruneReads(readAt, lc), dismissed: local.dismissed, companies: [...new Set(companies)] };
}
