/** 기사 피드백(관련 없음 / 도움 됨)의 순수 로직: 상태 전환, 낙관적 업데이트·실패 시 되돌리기, 한 번에 읽기.
 *  서버 표 article_feedback(supabase/migrations/0006, docs/feedback.md). 화면은 components/FeedbackProvider.tsx·ArticleCard.tsx.
 *  기록만 한다: 기사를 숨기거나 순서를 바꾸지 않는다. 표가 없거나 요청이 실패해도 페이지는 그대로(상태만 비거나 되돌림). */

export type FbSignal = 'irrelevant' | 'useful';
export const SIGNALS: FbSignal[] = ['irrelevant', 'useful'];
export const SIGNAL_LABEL: Record<FbSignal, string> = { irrelevant: '관련 없음', useful: '도움 됨' };
/** 버튼 툴팁·로그인 화면 카드 아래 한 줄 */
export const FEEDBACK_NOTE = '북마크·읽음 기록·기사 피드백은 계정에 저장돼요';
export const FAIL_TEXT = '피드백을 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
export const isSignal = (v: unknown): v is FbSignal => v === 'irrelevant' || v === 'useful';

/** 누른 뒤의 상태: 같은 버튼이면 취소(null), 아니면 누른 쪽 */
export const nextSignal = (cur: FbSignal | undefined, pressed: FbSignal): FbSignal | null => (cur === pressed ? null : pressed);

export type FbMap = Readonly<Record<string, FbSignal>>;
const withSignal = (m: FbMap, id: string, s: FbSignal | null | undefined): FbMap => {
  const next = { ...m };
  if (s) next[id] = s; else delete next[id];
  return next;
};

/** 서버 연결(구현: lib/feedbackBackend.ts, 테스트는 가짜) */
export interface FeedbackBackend {
  /** 이 채널의 본인 피드백 전부(기사 id → 신호) */
  load(channel: string): Promise<Record<string, FbSignal>>;
  set(channel: string, id: string, signal: FbSignal): Promise<void>;
  clear(channel: string, id: string): Promise<void>;
}

export type FbState = { map: FbMap; ready: boolean; error: string | null };
export const EMPTY_FB: FbState = { map: {}, ready: false, error: null };

export type FeedbackStore = {
  get(): FbState;
  subscribe(fn: () => void): () => void;
  load(): Promise<void>;
  /** 누르기: 바로 화면에 반영하고 서버에 쓴다. 실패하면(그 뒤에 같은 기사를 다시 누르지 않았을 때) 이전 상태로 되돌리고 안내. 성공 여부 */
  press(id: string, pressed: FbSignal): Promise<boolean>;
  clearError(): void;
};

export function createFeedbackStore(channel: string, backend: FeedbackBackend): FeedbackStore {
  let state: FbState = EMPTY_FB;
  const subs = new Set<() => void>();
  const seq: Record<string, number> = {};      // 기사별 누른 횟수(늦게 끝난 앞 요청이 뒤 상태를 덮지 않게)
  const touched = new Set<string>();           // 읽기가 끝나기 전에 누른 기사(읽은 값이 덮지 않게)
  const emit = (patch: Partial<FbState>) => { state = { ...state, ...patch }; subs.forEach(f => f()); };
  return {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    async load() {
      try {
        const got = await backend.load(channel);
        const merged: Record<string, FbSignal> = {};
        for (const [id, s] of Object.entries(got)) if (isSignal(s) && !touched.has(id)) merged[id] = s;
        for (const id of touched) if (state.map[id]) merged[id] = state.map[id];
        emit({ map: merged, ready: true });
      } catch {
        emit({ ready: true });   // 표가 없거나 실패해도 페이지는 그대로(버튼 상태만 비어 있음)
      }
    },
    async press(id, pressed) {
      const prev = state.map[id];
      const next = nextSignal(prev, pressed);
      const n = (seq[id] = (seq[id] ?? 0) + 1);
      touched.add(id);
      emit({ map: withSignal(state.map, id, next), error: null });
      try {
        if (next) await backend.set(channel, id, next); else await backend.clear(channel, id);
        return true;
      } catch {
        if (seq[id] === n) emit({ map: withSignal(state.map, id, prev), error: FAIL_TEXT });
        return false;
      }
    },
    clearError() { if (state.error) emit({ error: null }); },
  };
}

/** 버튼을 보일지: 로그인을 켠 빌드 + 로그인 + 비밀번호 변경 끝남(uid 있음, lib/useAccount.ts useSyncUser). 로그아웃이면 숨김 */
export const feedbackEnabled = (authMode: 'off' | 'optional' | 'required', uid: string | null) => authMode !== 'off' && !!uid;
