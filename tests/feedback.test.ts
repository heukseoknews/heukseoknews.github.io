import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAIL_TEXT, FEEDBACK_NOTE, type FbSignal, type FeedbackBackend, createFeedbackStore, feedbackEnabled, nextSignal } from '../lib/feedback.ts';

// ───── 상태 전환: 누름 / 같은 버튼 다시(취소) / 반대쪽(바뀜) ─────
assert.equal(nextSignal(undefined, 'useful'), 'useful');
assert.equal(nextSignal('useful', 'useful'), null);
assert.equal(nextSignal('useful', 'irrelevant'), 'irrelevant');
assert.equal(nextSignal('irrelevant', 'irrelevant'), null);

// 가짜 서버: 호출을 적고, 원하면 실패하거나 끝나는 시점을 늦춘다
type Call = [string, string, FbSignal?];
function fake(init: Record<string, FbSignal> = {}, o: { failLoad?: boolean; failNext?: number } = {}) {
  const calls: Call[] = [];
  const server: Record<string, FbSignal> = { ...init };
  const gates: (() => void)[] = [];
  let failNext = o.failNext ?? 0;
  const op = async (c: Call, apply: () => void) => {
    calls.push(c);
    await new Promise<void>(r => gates.push(r));
    if (failNext > 0) { failNext--; throw new Error('500'); }
    apply();
  };
  const backend: FeedbackBackend = {
    load: async () => { calls.push(['load', '']); if (o.failLoad) throw new Error('404 table'); return { ...server }; },
    set: (_ch, id, s) => op(['set', id, s], () => { server[id] = s; }),
    clear: (_ch, id) => op(['clear', id], () => { delete server[id]; }),
  };
  return { backend, calls, server, release: () => gates.shift()?.(), setFail: (n: number) => { failNext = n; } };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// ───── 한 번에 읽기 + 낙관적 업데이트 ─────
{
  const f = fake({ a1: 'useful' });
  const st = createFeedbackStore('insurance', f.backend);
  let notified = 0; st.subscribe(() => notified++);
  await st.load();
  assert.deepEqual(st.get(), { map: { a1: 'useful' }, ready: true, error: null });
  assert.deepEqual(f.calls, [['load', '']], '채널 피드백을 한 번에 읽음(기사마다 요청하지 않음)');
  // 같은 버튼 → 취소: 서버 응답 전에 이미 화면 반영
  const p1 = st.press('a1', 'useful');
  assert.equal(st.get().map.a1, undefined, '누르자마자 취소 표시');
  f.release(); assert.equal(await p1, true);
  assert.deepEqual(f.calls.at(-1), ['clear', 'a1']); assert.deepEqual(f.server, {});
  // 새로 누름 → 반대쪽 → 바뀜
  const p2 = st.press('a2', 'irrelevant'); assert.equal(st.get().map.a2, 'irrelevant'); f.release(); await p2;
  const p3 = st.press('a2', 'useful'); assert.equal(st.get().map.a2, 'useful'); f.release(); await p3;
  assert.deepEqual(f.calls.slice(-2), [['set', 'a2', 'irrelevant'], ['set', 'a2', 'useful']]);
  assert.deepEqual(f.server, { a2: 'useful' });
  assert.ok(notified >= 4);
}

// ───── 실패하면 되돌리고 안내 ─────
{
  const f = fake({ a1: 'useful' }, { failNext: 1 });
  const st = createFeedbackStore('ai', f.backend);
  await st.load();
  const p = st.press('a1', 'irrelevant');
  assert.equal(st.get().map.a1, 'irrelevant');
  f.release(); assert.equal(await p, false);
  assert.equal(st.get().map.a1, 'useful', '실패하면 이전 상태로');
  assert.equal(st.get().error, FAIL_TEXT);
  st.clearError(); assert.equal(st.get().error, null);
  // 취소 실패도 되돌림
  f.setFail(1);
  const q = st.press('a1', 'useful'); assert.equal(st.get().map.a1, undefined); f.release(); await q;
  assert.equal(st.get().map.a1, 'useful');
  // 앞 요청이 늦게 실패해도, 그 뒤에 다시 누른 상태를 덮지 않는다
  const f2 = fake({}, { failNext: 1 });
  const s2 = createFeedbackStore('ai', f2.backend); await s2.load();
  const first = s2.press('x', 'useful');            // 실패할 요청(대기)
  const second = s2.press('x', 'irrelevant');       // 그 사이 반대쪽
  f2.release(); await first; f2.release(); await second;
  assert.equal(s2.get().map.x, 'irrelevant', '늦게 끝난 앞 요청의 실패가 뒤 상태를 되돌리지 않음');
}

// ───── 실패 허용: 표가 없거나 읽기가 실패해도 정상(상태만 비어 있음), 읽기 전에 누른 것은 유지 ─────
{
  const f = fake({ a1: 'useful' }, { failLoad: true });
  const st = createFeedbackStore('finance', f.backend);
  await st.load();
  assert.deepEqual(st.get(), { map: {}, ready: true, error: null }, '오류 안내 없이 빈 상태');
  const f2 = fake({ a1: 'useful', a2: 'useful' });
  const s2 = createFeedbackStore('finance', f2.backend);
  const pr = s2.press('a2', 'irrelevant');          // 읽기 전에 누름
  await s2.load(); f2.release(); await pr; await tick();
  assert.deepEqual(s2.get().map, { a1: 'useful', a2: 'irrelevant' }, '읽은 값이 방금 누른 상태를 덮지 않음');
}

// ───── 로그아웃·로그인 꺼진 빌드에서는 숨김 ─────
assert.equal(feedbackEnabled('off', 'u1'), false);
assert.equal(feedbackEnabled('required', null), false, '로그아웃(또는 비밀번호 변경 전)이면 버튼 없음');
assert.equal(feedbackEnabled('optional', 'u1'), true);
assert.equal(feedbackEnabled('required', 'u1'), true);

// ───── 화면 연결(소스 확인): 카드는 provider 값이 있을 때만 버튼, 채널 화면 전체에서 한 번 읽기, 안내 문구 ─────
const card = readFileSync('components/ArticleCard.tsx', 'utf8');
assert.match(card, /\{fb && SIGNALS\.map\(/, '피드백 버튼은 fb(로그인 상태)가 있을 때만');
assert.match(card, /fb\.press\(a\.id, sig\)/, '묶음이면 카드에 보이는 대표 기사 id 에 기록');
assert.ok(card.includes('title={`${SIGNAL_LABEL[sig]} — ${FEEDBACK_NOTE}`}'), '버튼 툴팁에 저장 안내');
assert.ok(!/fb\.(press|signalOf)\(o\.id/.test(card), '펼친 묶음 목록(다른 기사)에는 버튼 없음');
const provider = readFileSync('components/FeedbackProvider.tsx', 'utf8');
assert.ok(provider.includes('useSyncUser(AUTH_MODE)') && provider.includes("import('../lib/feedbackBackend')"), '로그인했을 때만 연결 코드를 불러옴');
assert.ok(readFileSync('app/[channel]/layout.tsx', 'utf8').includes('<FeedbackProvider>{children}</FeedbackProvider>'));
assert.ok(readFileSync('components/LoginForm.tsx', 'utf8').includes('<p className="authNote">{FEEDBACK_NOTE}</p>'));
assert.equal(FEEDBACK_NOTE, '북마크·읽음 기록·기사 피드백은 계정에 저장돼요');
// 기록만: 목록 화면의 거르기·정렬 코드는 피드백을 읽지 않는다
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(!/feedback|useFeedback/i.test(page), '기사를 숨기거나 순서를 바꾸지 않음');
console.log('feedback tests passed');
