/** 사용자 상태 저장소 어댑터. 지금은 이 브라우저의 localStorage 만 쓴다.
 *  나중에 로그인·원격 저장소를 붙일 때는 UserStateStore 를 구현한 다른 어댑터로 userStateStore 를 바꾸면 된다. */
import { EMPTY_STATE, type LegacyKeys, type UserState, fromStored, storageKey, toStored } from './userState.ts';

export interface UserStateStore {
  load(channel: string, legacy?: LegacyKeys): UserState;
  save(channel: string, state: UserState): void;
}

const parse = (r: string | null): unknown => { if (r === null) return undefined; try { return JSON.parse(r); } catch { return undefined; } };

export const localStorageStore: UserStateStore = {
  load(channel, legacy) {
    try {
      const cur = localStorage.getItem(storageKey(channel));
      if (cur !== null) { const j = parse(cur); return j === undefined ? EMPTY_STATE : fromStored(j); }
      // 새 키가 아직 없으면 옛 사이트 키(actuary-news-hub-v3 / -companies-v1)를 읽는다. 옛 키는 지우지 않는다.
      const saved = legacy?.saved ? localStorage.getItem(legacy.saved) : null;
      const comp = legacy?.companies ? localStorage.getItem(legacy.companies) : null;
      if (saved !== null || comp !== null) return fromStored(parse(saved), comp !== null ? parse(comp) : []);
    } catch { /* 저장소 접근 불가(사생활 보호 모드 등) */ }
    return EMPTY_STATE;
  },
  save(channel, state) {
    try { localStorage.setItem(storageKey(channel), JSON.stringify(toStored(channel, state))); } catch { /* 저장 불가면 이번 방문에만 유지 */ }
  },
};

export const userStateStore: UserStateStore = localStorageStore;
