// 기사 월 파일 요청 정리(lib/newsLoad.ts)·데이터 캐시 방식(lib/news.ts)·점수 파일 404 기억(lib/llmScore.ts) 테스트
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOnce, currentMonths, monthRequester, startLoad } from '../lib/newsLoad.ts';
import { DATA_CACHE, loadIndex, loadMonth } from '../lib/news.ts';
import { LLM_MISSING, fetchLlmMonth } from '../lib/llmScore.ts';

const tick = () => new Promise(r => setTimeout(r, 0));
/** 손으로 끝내는 요청(느린 응답 흉내) */
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const p = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }
function fakeLoader<T>() {
  const calls: string[] = [];
  const pend = new Map<string, ReturnType<typeof deferred<T>>[]>();
  const load = (k: string) => { calls.push(k); const d = deferred<T>(); pend.set(k, [...(pend.get(k) ?? []), d]); return d.p; };
  const last = (k: string) => pend.get(k)!.at(-1)!;
  return { calls, load, last };
}

// ───── once: 동시 호출은 요청 하나, 성공은 기억, 실패는 지워서 다시 요청 ─────
{
  const f = fakeLoader<string>();
  const once = createOnce(f.load);
  const a = once.get('2026-11'), b = once.get('2026-11');
  assert.equal(a, b, '진행 중인 같은 달은 같은 요청');
  assert.deepEqual(f.calls, ['2026-11']);
  f.last('2026-11').resolve('rows');
  assert.equal(await a, 'rows');
  once.get('2026-11');
  assert.deepEqual(f.calls, ['2026-11'], '끝난 요청도 다시 보내지 않음');
  const c = once.get('2026-10');
  f.last('2026-10').reject(new TypeError('Failed to fetch'));   // 오프라인
  await assert.rejects(c);
  await tick();
  assert.equal(once.has('2026-10'), false, '실패는 기억하지 않음');
  once.get('2026-10');
  assert.deepEqual(f.calls, ['2026-11', '2026-10', '2026-10'], '실패 후 다시 요청');
}

// ───── monthRequester: 예전 중복 버그 재현 — 작은 달이 먼저 도착해 화면이 다시 계산돼도 큰 달을 다시 요청하지 않는다 ─────
{
  const f = fakeLoader<string[]>();
  const byMonth: Record<string, string[]> = {};
  const fails: string[] = [];
  let renders = 0;
  const onceAll = createOnce(f.load);
  const request = monthRequester(onceAll, { rows: (m, r) => { byMonth[m] = r; renders++; }, fail: m => { byMonth[m] = []; fails.push(m); } });
  const run = (months: string[]) => request(months, m => m in byMonth);   // useNews 의 effect 와 같은 호출
  run(['2026-11', '2026-10']);
  f.last('2026-10').resolve(['b']);                // 작은 달이 먼저
  await tick();
  run(['2026-11', '2026-10']);                      // byMonth 가 바뀌어 effect 가 다시 돈다
  run(['2026-11', '2026-10']);
  assert.deepEqual(f.calls, ['2026-11', '2026-10'], '진행 중인 11월을 다시 요청하지 않음');
  f.last('2026-11').resolve(['a']);
  await tick();
  assert.equal(renders, 2, '달마다 결과는 한 번만 반영');
  // 검색: 여러 달을 한꺼번에, 같은 계산이 여러 번 돌아도 달마다 한 번
  for (let i = 0; i < 3; i++) run(['2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
  assert.deepEqual(f.calls, ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
  // 실패(서버 오류·오프라인): 빈 목록으로 두고(로딩이 끝나 안내가 보임) 같은 화면에서 저절로 반복하지 않음
  f.last('2026-09').reject(new Error('09.json HTTP 500'));
  await tick();
  run(['2026-09']);                               // 실패가 화면 상태에 반영되기 전에 계산이 다시 돌아도
  request(['2026-09'], () => false);
  assert.deepEqual(byMonth['2026-09'], []);
  assert.deepEqual(fails, ['2026-09'], '실패 안내는 한 번');
  assert.equal(f.calls.filter(m => m === '2026-09').length, 1, '같은 화면에서 반복하지 않음(오프라인 폭주 방지)');
  // 재시도: 요청 기록(once)은 실패를 지웠으므로 새 화면(새로고침·채널 이동)은 다시 요청한다
  const again = monthRequester(onceAll, { rows: (m, r) => { byMonth[m] = r; }, fail: () => {} });
  delete byMonth['2026-09'];
  again(['2026-09'], m => m in byMonth);
  assert.equal(f.calls.filter(m => m === '2026-09').length, 2, '실패 후 다시 요청 가능');
  f.last('2026-09').resolve(['c']);
  await tick();
  assert.deepEqual(byMonth['2026-09'], ['c']);
}

// ───── 이번 달: 한국 시각의 달, 1일 0~9시(한국)에는 월 파일의 UTC 달도 ─────
assert.deepEqual(currentMonths(Date.parse('2026-11-18T03:00:00Z')), ['2026-11']);
assert.deepEqual(currentMonths(Date.parse('2026-11-30T16:00:00Z')), ['2026-12', '2026-11'], '12월 1일 01시(한국): 데이터는 아직 11월(UTC)');
assert.deepEqual(currentMonths(Date.parse('2026-12-01T00:00:00Z')), ['2026-12']);
assert.deepEqual(currentMonths(Date.parse('2026-12-31T15:30:00Z')), ['2027-01', '2026-12'], '연도 경계');

// ───── startLoad: index.json 과 이번 달을 동시에. 미리 받은 결과는 목록에 바로 넣지 않는다(깜빡임 없음) ─────
{
  const f = fakeLoader<string[]>();
  const once = createOnce(f.load);
  const ix = deferred<{ months: string[] }>();
  let indexCalls = 0;
  const p = startLoad(() => { indexCalls++; return ix.p; }, once, Date.parse('2026-11-18T03:00:00Z'));
  assert.equal(indexCalls, 1);
  assert.deepEqual(f.calls, ['2026-11'], 'index 응답 전에 이번 달 요청이 이미 나감');
  f.last('2026-11').resolve(['a']);                 // 이번 달이 index 보다 먼저 도착(느린 index)
  await tick();
  const byMonth: Record<string, string[]> = {};
  const request = monthRequester(once, { rows: (m, r) => { byMonth[m] = r; }, fail: () => {} });
  assert.deepEqual(byMonth, {}, 'index 전에는 목록에 들어가지 않음');
  ix.resolve({ months: ['2026-11', '2026-10'] });
  request((await p).months, m => m in byMonth);
  assert.deepEqual(f.calls, ['2026-11', '2026-10'], '이번 달은 다시 요청하지 않음');
  await tick();
  assert.deepEqual(byMonth['2026-11'], ['a']);
  // 이번 달 파일이 아직 없거나(404) 오프라인이면 조용히 넘어가고, index 가 원하는 달이면 목록 쪽이 다시 요청
  const g = fakeLoader<string[]>();
  const once2 = createOnce(g.load);
  startLoad(async () => ({ months: [] }), once2, Date.parse('2026-11-18T03:00:00Z'));
  g.last('2026-11').reject(new TypeError('Failed to fetch'));
  await tick();                                     // 처리되지 않은 거부가 없어야 함(있으면 node 가 종료)
  const got: string[] = [];
  monthRequester(once2, { rows: m => got.push(m), fail: () => {} })(['2026-11'], () => false);
  assert.deepEqual(g.calls, ['2026-11', '2026-11'], '미리 받기 실패 후 목록 쪽에서 한 번 더');
}

// ───── 캐시 방식: 데이터는 'no-cache'(ETag 확인), 기사·index·점수 파일 모두 ─────
assert.equal(DATA_CACHE, 'no-cache');
{
  const seen: { url: string; cache?: RequestCache }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push({ url, cache: init?.cache }); return new Response('{"updated_at":null,"months":[]}', { status: 200 }); }) as typeof fetch;
  try {
    await loadIndex('insurance');
    await loadMonth('insurance', '2026-11');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [{ url: '/data/insurance/index.json', cache: 'no-cache' }, { url: '/data/insurance/2026-11.json', cache: 'no-cache' }]);
}
const news = readFileSync('lib/news.ts', 'utf8');
assert.ok(!/cache: 'no-store'[^\n]*\/data\//.test(news) && news.includes("fetch('/version.json', { cache: 'no-store' })"), 'version.json 만 no-store');
assert.ok(readFileSync('app/calendar/page.tsx', 'utf8').includes('{ cache: DATA_CACHE }'), '달력 데이터도 같은 방식');

// ───── 점수 파일: 404 는 기억해 다시 요청하지 않음, 오프라인·서버 오류는 기억하지 않음, 실패해도 빈 값(기존 ★) ─────
{
  const missing = new Set<string>();
  const calls: { url: string; cache?: RequestCache }[] = [];
  const reply = (status: number) => async (url: string, init?: RequestInit) => { calls.push({ url, cache: init?.cache }); return new Response(status === 200 ? '{"a":[{"prompt_version":"v1","scored_at":"2026-11-17T01:00:00Z","score_ev":4}]}' : 'x', { status }); };
  assert.equal((await fetchLlmMonth('ai', '2026-10', 'v1', reply(404), missing)).size, 0);
  assert.equal((await fetchLlmMonth('ai', '2026-10', 'v1', reply(404), missing)).size, 0);
  assert.equal(calls.length, 1, '없는 달(404)은 한 번만 요청');
  assert.equal(calls[0].cache, 'no-cache');
  assert.ok(missing.has('ai/2026-10'));
  assert.equal((await fetchLlmMonth('insurance', '2026-10', 'v1', reply(200), missing)).get('a'), 4, '채널마다 따로 기억');
  await fetchLlmMonth('ai', '2026-11', 'v1', async () => { throw new TypeError('Failed to fetch'); }, missing);
  await fetchLlmMonth('ai', '2026-09', 'v1', reply(500), missing);
  assert.ok(!missing.has('ai/2026-11') && !missing.has('ai/2026-09'), '오프라인·서버 오류는 기억하지 않음(다음에 다시 시도)');
  assert.equal(LLM_MISSING.size, 0, '테스트는 기본 기억 장소를 쓰지 않음');
}

// ───── 화면 연결(소스): 점수 파일은 '요청하는 달' 기준(월 파일과 동시), 목록은 점수를 기다리지 않음 ─────
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(page.includes('[...new Set([...currentMonths(Date.now()), ...requested])]') && page.includes('useLlmScores(ch.slug, llmMonths, llm)'), '채널 화면: 이번 달 점수 파일은 index.json 과 동시에, 나머지는 월 파일과 동시에');
assert.ok(/const listReady = ready && \(tab === 'bookmarks' \|\| !loading\) && \(tab !== 'new' \|\| settled\);/.test(page), '목록 준비 조건에 점수 파일이 끼지 않음(동기화 조건은 그대로)');
const hook = readFileSync('lib/useNews.ts', 'utf8');
assert.ok(hook.includes('startLoad(() => loadIndex(channel), once, Date.now())') && hook.includes('request(wanted, m => m in byMonth)'));
assert.ok(hook.includes("const loading = !failure && (!index || baseMonths.some(m => !(m in byMonth)));"), '로딩 판정은 그대로(최근 2개월이 끝날 때까지)');
const week = readFileSync('app/[channel]/week/page.tsx', 'utf8');
assert.ok(week.includes('useLlmScores(ch.slug, loaded, llm)'), '이번 주 핵심은 바꾸지 않음');
console.log('news load tests passed');
