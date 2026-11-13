/** 사용자 상태 저장소 어댑터. 지금은 이 브라우저의 localStorage 만 쓴다.
 *  나중에 로그인·원격 저장소를 붙일 때는 UserStateStore 를 구현한 다른 어댑터로 userStateStore 를 바꾸면 된다(docs/auth-plan.md 5장). */
import { EMPTY_STATE, type LegacyKeys, type UserState, fromStored, needsDismissMigration, storageKey, toStored } from './userState.ts';
import { type KV, browserKV, readAccount, sessionUser } from './auth.ts';
import { AUTH_MODE } from './authConfig.ts';

export interface UserStateStore {
  load(channel: string, legacy?: LegacyKeys): UserState;
  save(channel: string, state: UserState): void;
}

const parse = (r: string | null): unknown => { if (r === null) return undefined; try { return JSON.parse(r); } catch { return undefined; } };

/** 읽는 순서: v2 키 → v1 키(자동 이전) → 옛 사이트 키. v1·옛 키는 지우지 않는다(되돌릴 때 대비). 저장은 v2 키에만. */
export const localStorageStore: UserStateStore = {
  load(channel, legacy) {
    const now = new Date().toISOString();
    try {
      const cur = localStorage.getItem(storageKey(channel));
      if (cur !== null) {
        const j = parse(cur);
        if (j === undefined) return EMPTY_STATE;
        const st = fromStored(j, channel, undefined, now);
        // 치우기 도입 전 저장값: 옮긴 결과를 바로 저장해 이전을 한 번만 한다(다음부터는 dismissed 키를 그대로 읽음)
        if (needsDismissMigration(j)) localStorage.setItem(storageKey(channel), JSON.stringify(toStored(channel, st)));
        return st;
      }
      const v1 = localStorage.getItem(storageKey(channel, 1));
      if (v1 !== null) { const j = parse(v1); return j === undefined ? EMPTY_STATE : fromStored({ ...(j as object), schemaVersion: 1 }, channel, undefined, now); }
      // 옛 사이트 키(actuary-news-hub-v3 / -companies-v1)
      const saved = legacy?.saved ? localStorage.getItem(legacy.saved) : null;
      const comp = legacy?.companies ? localStorage.getItem(legacy.companies) : null;
      if (saved !== null || comp !== null) {
        const j = parse(saved);
        return fromStored(j && typeof j === 'object' ? { ...(j as object), schemaVersion: 1 } : j, channel, comp !== null ? parse(comp) : [], now);
      }
    } catch { /* 저장소 접근 불가(사생활 보호 모드 등) */ }
    return EMPTY_STATE;
  },
  save(channel, state) {
    try { localStorage.setItem(storageKey(channel), JSON.stringify(toStored(channel, state))); } catch { /* 저장 불가면 이번 방문에만 유지 */ }
  },
};

export const userStateStore: UserStateStore = localStorageStore;

// ───────── 로그인 중: 계정별 기기 사본(docs/auth-plan.md 5.2) ─────────
// 화면은 로그인 중에도 이 기기의 사본을 동기적으로 읽고 쓴다(클릭 즉시 반영, 서버가 멈춰도 동작). 서버와 맞추기는 lib/sync.ts 가 뒤에서.
// 로그인 전 기록(heukseok-v2:<채널>)은 계정 사본과 따로 두고, 사용자가 '합치기'를 고를 때만 합친다(lib/claim.ts).
/** 계정 사본 키: heukseok-v2:<채널>@<사용자 id> */
export const accountStateKey = (channel: string, userId: string) => `${storageKey(channel)}@${userId}`;

export function accountStore(userId: string): UserStateStore {
  return {
    load(channel) {
      try {
        const raw = localStorage.getItem(accountStateKey(channel, userId));
        if (raw !== null) { const j = parse(raw); if (j !== undefined) return fromStored(j, channel, undefined, new Date().toISOString()); }
      } catch { /* 저장소 접근 불가 */ }
      return EMPTY_STATE;   // 처음 로그인: 비어 있음(기기 기록을 묻지 않고 섞지 않는다). 서버에서 받아 채운다
    },
    save(channel, state) {
      try { localStorage.setItem(accountStateKey(channel, userId), JSON.stringify(toStored(channel, state))); } catch { /* 저장 불가면 이번 방문에만 */ }
    },
  };
}
/** 화면이 쓸 저장소: 로그인했고 비밀번호 변경까지 끝난 계정이면 계정 사본, 아니면(로그인 꺼진 빌드 포함) 지금처럼 기기 저장 */
export const storeFor = (userId: string | null): UserStateStore => (userId ? accountStore(userId) : localStorageStore);
/** 지금 계정 사본을 쓸 사용자(로그인을 켠 빌드 + 저장된 세션 + 비밀번호 변경 끝남). 아니면 null(기기 저장) */
export function activeUserId(kv: KV = browserKV, mode = AUTH_MODE): string | null {
  if (mode === 'off') return null;
  const uid = sessionUser(kv);
  return uid && readAccount(kv, uid)?.mustChange === false ? uid : null;
}
