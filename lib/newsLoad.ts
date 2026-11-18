/** 기사 월 파일 요청 정리(순수 로직, 화면 훅은 lib/useNews.ts). 테스트: tests/news-load.test.ts
 *  - once: 같은 달은 한 번만 요청한다. 진행 중이거나 끝난 요청을 달별로 기억하고, 실패하면 기록을 지워 다음 호출이 다시 요청한다.
 *  - monthRequester: 훅이 여러 번 다시 계산돼도(작은 달이 먼저 도착해 상태가 바뀌는 등) 같은 달에 결과 콜백을 한 번만 붙인다.
 *  - startLoad: index.json 과 이번 달 월 파일을 동시에 요청한다(이번 달은 결과를 미리 받아 두기만 하고, 목록에는 index 가 원하는 달일 때만 들어간다). */

export type Once<T> = { get(key: string): Promise<T>; has(key: string): boolean };

export function createOnce<T>(load: (key: string) => Promise<T>): Once<T> {
  const memo = new Map<string, Promise<T>>();
  return {
    get(key) {
      const hit = memo.get(key);
      if (hit) return hit;
      const p = load(key);
      memo.set(key, p);
      p.catch(() => { if (memo.get(key) === p) memo.delete(key); });   // 실패는 기억하지 않는다(다시 요청 가능)
      return p;
    },
    has: key => memo.has(key),
  };
}

/** 데이터 월 파일 이름(YYYY-MM)으로 본 '이번 달'. 한국 시각의 달을 먼저, 월 파일은 발행 시각의 UTC 달로 나뉘므로(collector)
 *  둘이 다른 매달 1일 0~9시(한국)에는 UTC 달도 함께 */
export function currentMonths(nowMs: number): string[] {
  const kst = new Date(nowMs + 9 * 3_600_000).toISOString().slice(0, 7);
  const utc = new Date(nowMs).toISOString().slice(0, 7);
  return kst === utc ? [kst] : [kst, utc];
}

/** index.json 요청과 함께 이번 달 월 파일을 미리 요청한다. 미리 받은 결과는 once 에만 있고, 실패해도 조용히 넘어간다(나중에 다시 요청) */
export function startLoad<I>(loadIndex: () => Promise<I>, once: Once<unknown>, nowMs: number): Promise<I> {
  const ix = loadIndex();
  for (const m of currentMonths(nowMs)) once.get(m).catch(() => { /* 없는 달(404)·오프라인: 목록 쪽 요청이 다시 시도 */ });
  return ix;
}

/** 원하는 달 가운데 아직 결과가 없고(done 아님) 이 화면이 아직 콜백을 붙이지 않은 달만 요청해 콜백을 붙인다.
 *  달마다 결과(성공·실패) 콜백은 한 번 — 결과가 화면 상태에 반영되기 전에 계산이 다시 돌아도 다시 요청하지 않는다.
 *  실패한 달은 once 가 기록을 지우므로, 미리 받기(startLoad)가 실패한 달은 여기서 다시 요청하고, 새 화면(새로고침·채널 이동)도 다시 요청한다. */
export function monthRequester<T>(once: Once<T>, cb: { rows(month: string, rows: T): void; fail(month: string, e: unknown): void }) {
  const attached = new Set<string>();
  return (months: string[], done: (month: string) => boolean): void => {
    for (const m of months) {
      if (done(m) || attached.has(m)) continue;
      attached.add(m);
      once.get(m).then(r => cb.rows(m, r), e => cb.fail(m, e));
    }
  };
}
