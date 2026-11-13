/** 사용자 상태 저장소 어댑터. 지금은 이 브라우저의 localStorage 만 쓴다.
 *  나중에 로그인·원격 저장소를 붙일 때는 UserStateStore 를 구현한 다른 어댑터로 userStateStore 를 바꾸면 된다(docs/auth-plan.md 5장). */
import { EMPTY_STATE, type LegacyKeys, type UserState, fromStored, needsDismissMigration, storageKey, toStored } from './userState.ts';

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
