/** 사용자 상태 저장소 어댑터. 모두 이 브라우저의 localStorage 에 저장한다.
 *  로그인 안 함: localStorageStore, 로그인 중: 계정별 기기 사본 accountStore(storeFor 가 고른다).
 *  계정 사본과 서버의 동기화는 lib/sync*.ts 가 맡는다(docs/auth-plan.md 5장). */
import { EMPTY_STATE, type LegacyKeys, type UserState, fromStored, laterIso, needsDismissMigration, storageKey, toStored } from './userState.ts';
import { type KV, browserKV, readAccount, sessionUser } from './auth.ts';
import { AUTH_MODE } from './authConfig.ts';

export interface UserStateStore {
  load(channel: string, legacy?: LegacyKeys): UserState;
  /** 저장하고 실제로 저장한 상태를 돌려준다(마지막 확인 시각은 저장된 값보다 앞으로 돌아가지 않는다) */
  save(channel: string, state: UserState): UserState;
  /** 이 채널 상태가 저장되는 localStorage 키(다른 탭의 변경 감지용) */
  key(channel: string): string;
}

const parse = (r: string | null): unknown => { if (r === null) return undefined; try { return JSON.parse(r); } catch { return undefined; } };
/** 저장: 이미 저장된 확인 시각이 더 늦으면 그것을 지킨다(옛 상태를 들고 있던 다른 탭·화면이 덮어써도 '모두 확인'이 되돌아가지 않게) */
function saveKeepingConfirmed(key: string, channel: string, state: UserState): UserState {
  let out = state;
  try {
    const prev = parse(localStorage.getItem(key)) as { lastConfirmed?: unknown } | undefined;
    const lc = laterIso(typeof prev?.lastConfirmed === 'string' ? prev.lastConfirmed : null, state.lastConfirmed);
    if (lc !== state.lastConfirmed) out = { ...state, lastConfirmed: lc };
    localStorage.setItem(key, JSON.stringify(toStored(channel, out)));
  } catch { /* 저장 불가면 이번 방문에만 유지 */ }
  return out;
}

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
  save(channel, state) { return saveKeepingConfirmed(storageKey(channel), channel, state); },
  key: channel => storageKey(channel),
};

// ───────── 로그인 중: 계정별 기기 사본(docs/auth-plan.md 5.2) ─────────
// 화면은 로그인 중에도 이 기기의 사본을 동기적으로 읽고 쓴다(클릭 즉시 반영, 서버가 멈춰도 동작). 서버와 맞추기는 lib/sync.ts 가 뒤에서.
// 로그인 전 기록(heukseok-v2:<채널>)은 계정 사본과 따로 두고, 사용자가 '합치기'를 고를 때만 합친다(lib/claim.ts).
/** 계정 사본 키: heukseok-v2:<채널>@<사용자 id> */
export const accountStateKey = (channel: string, userId: string) => `${storageKey(channel)}@${userId}`;

export function accountStore(userId: string): UserStateStore {
  const store: UserStateStore = {
    /** 계정 사본을 읽는다. 기기 사본(로그인 전·동기화 도입 전 기록)과 함께 본다:
     *  - 마지막 확인 시각: 두 사본 중 늦은 쪽(값만 보는 시각이라 섞여도 북마크처럼 남의 기록이 드러나지 않는다)
     *  - 계정 사본이 아직 없으면(이 기기에서 처음 로그인·동기화 도입 직후) 치운 기사도 기기 사본에서 한 번 이어받는다.
     *    북마크·읽음은 섞지 않는다(합치기 질문, lib/claim.ts). 서버 내용은 동기화가 뒤에서 합친다. */
    load(channel, legacy) {
      const key = accountStateKey(channel, userId);
      let acc: UserState | null = null;
      try {
        const j = parse(localStorage.getItem(key));
        if (j !== undefined) acc = fromStored(j, channel, undefined, new Date().toISOString());
      } catch { /* 저장소 접근 불가 */ }
      const device = localStorageStore.load(channel, legacy);
      if (!acc) {
        const seed: UserState = { ...EMPTY_STATE, lastConfirmed: device.lastConfirmed, dismissed: device.dismissed };
        return seed.lastConfirmed || seed.dismissed.length ? store.save(channel, seed) : EMPTY_STATE;
      }
      const lc = laterIso(acc.lastConfirmed, device.lastConfirmed);
      return lc === acc.lastConfirmed ? acc : store.save(channel, { ...acc, lastConfirmed: lc });
    },
    save(channel, state) { return saveKeepingConfirmed(accountStateKey(channel, userId), channel, state); },
    key: channel => accountStateKey(channel, userId),
  };
  return store;
}
/** 화면이 쓸 저장소: 로그인했고 비밀번호 변경까지 끝난 계정이면 계정 사본, 아니면(로그인 꺼진 빌드 포함) 지금처럼 기기 저장 */
export const storeFor = (userId: string | null): UserStateStore => (userId ? accountStore(userId) : localStorageStore);
/** 지금 계정 사본을 쓸 사용자(로그인을 켠 빌드 + 저장된 세션 + 비밀번호 변경 끝남). 아니면 null(기기 저장) */
export function activeUserId(kv: KV = browserKV, mode = AUTH_MODE): string | null {
  if (mode === 'off') return null;
  const uid = sessionUser(kv);
  return uid && readAccount(kv, uid)?.mustChange === false ? uid : null;
}
