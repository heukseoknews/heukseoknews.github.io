import assert from 'node:assert/strict';
import {
  BODY_MAX, DELETED_TEXT, PENDING_KEY, PENDING_TTL_MS, articleRefOf, bodyLength, bodyProblem, canDelete, chatFailOf, checkArticle, cleanBody,
  dayKey, dayLabel, dropMessages, enterAction, fetchSince, isDeleted, lastId, mergeMessages, nearBottom, savePending, settleOutgoing,
  takePending, timeLabel, toMessage, type ChatMessage, type Outgoing,
  COUNTS_EVERY_MS, MARK_GAP_MS, deleteFailNote, isAdminValue, applyCounts, canFetchCounts, canSend, failNote, markPlan, readCountIds, readLabel, readsAfterFail, sendProblem,
} from '../lib/chat.ts';

// ---------- 글 검사(서버 chat_send 와 같은 기준) ----------
assert.equal(BODY_MAX, 500);
assert.equal(bodyProblem(''), 'empty');
assert.equal(bodyProblem('   \n\t  '), 'empty', '공백·줄바꿈만');
assert.equal(bodyProblem('가'.repeat(500)), null, '500자 허용');
assert.equal(bodyProblem('  ' + '가'.repeat(500) + '\n'), null, '앞뒤 공백을 지우면 500자');
assert.equal(bodyProblem('가'.repeat(501)), 'tooLong');
assert.equal(bodyProblem('😀'.repeat(500)), null, '코드 포인트로 셈');
assert.equal(bodyLength('😀a'), 2);
assert.equal(bodyProblem('줄\n바꿈'), null, '줄바꿈 허용');
assert.equal(bodyProblem('a\u0007b'), 'invalid', '제어 문자');
assert.equal(bodyProblem('a\u0000b'), 'invalid', 'NUL');
assert.equal(bodyProblem('a\u0085b'), 'invalid', 'C1');
assert.equal(bodyProblem('a‮b'), 'invalid', '글자 방향 바꾸기');
assert.equal(bodyProblem('a\tb'), null, '탭은 공백으로 바꿔 보냄');
assert.equal(cleanBody(' a\r\nb\rc\td '), 'a\nb\nc  d');
assert.equal(bodyProblem('<script>alert(1)</script>'), null, 'HTML 처럼 보여도 글자 그대로(화면은 텍스트로만 그림)');

// ---------- 기사 첨부 모양(서버 private.chat_article_ok 와 같은 기준) ----------
const art = { id: 'ins-2026-001', cluster_id: 'c12', channel: 'insurance', title: '보험 제목', source: '흑석신문', url: 'https://example.com/a?b=1', published_at: '2026-11-13T09:00:00+09:00' };
assert.ok(checkArticle(art));
assert.ok(checkArticle({ id: 'x', channel: 'ai', title: 't', url: 'HTTP://e.com' }), '필수만');
assert.ok(!checkArticle({ ...art, url: 'javascript:alert(1)' }), 'javascript:');
assert.ok(!checkArticle({ ...art, url: 'data:text/html,x' }));
assert.ok(!checkArticle({ ...art, url: 'https://e .com' }), '주소 안 공백');
assert.ok(!checkArticle({ ...art, url: 'https://e.com/' + 'a'.repeat(2040) }), '2048자 초과');
assert.ok(!checkArticle({ ...art, memo: '내 메모' }), '허용 안 한 키(메모)');
assert.ok(!checkArticle({ ...art, lists: ['f1'] }), '허용 안 한 키(목록)');
assert.ok(!checkArticle({ ...art, title: '가'.repeat(201) }), '제목 201자');
assert.ok(checkArticle({ ...art, title: '가'.repeat(200) }));
assert.ok(!checkArticle({ ...art, title: '  ' }), '빈 제목');
assert.ok(!checkArticle({ ...art, source: '가'.repeat(61) }), '매체 61자');
assert.ok(!checkArticle({ ...art, channel: 'sports' }), '잘못된 channel');
assert.ok(!checkArticle({ ...art, title: 123 }), '문자열 아닌 값');
assert.ok(!checkArticle({ ...art, id: 'a b' }), 'id 형식');
assert.ok(!checkArticle({ ...art, published_at: 'yesterday' }));
assert.ok(!checkArticle([art]) && !checkArticle(null) && !checkArticle('x'));
const { url: _u, ...noUrl } = art; assert.ok(!checkArticle(noUrl), 'url 없음');

// 기사·북마크에서 만들기: 그 기사 한 건의 공개 필드만
const bm = { id: 'ins-2026-001', title: '  보험 제목\n', url: 'https://example.com/a', source: '', published_at: '', cluster_id: 'c12', memo: '비밀 메모', lists: ['f1'], tags: ['t1'], category: '정책' };
const ref = articleRefOf(bm, 'insurance');
assert.deepEqual(ref, { id: 'ins-2026-001', channel: 'insurance', title: '보험 제목', url: 'https://example.com/a', cluster_id: 'c12' }, '빈 매체·날짜는 빼고 메모·목록·태그는 넣지 않음');
assert.equal(articleRefOf({ ...bm, title: '가'.repeat(300) }, 'ai')!.title.length, 200, '제목은 200자로 자름');
assert.equal(articleRefOf({ ...bm, url: 'javascript:x' }, 'ai'), null, '링크가 안전하지 않으면 첨부 불가');
assert.equal(articleRefOf(bm, 'sports'), null);

// ---------- 첨부 대기(sessionStorage) ----------
const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
{
  const st = mem();
  assert.ok(savePending(st, art, 1000));
  assert.ok(st.m.has(PENDING_KEY));
  assert.deepEqual(takePending(st, 2000), art);
  assert.equal(takePending(st, 2000), null, '한 번만 붙는다');
  savePending(st, art, 0);
  assert.equal(takePending(st, PENDING_TTL_MS + 1), null, '30분 지나면 버림');
  assert.ok(!st.m.has(PENDING_KEY), '버려도 지움');
  st.setItem(PENDING_KEY, JSON.stringify({ a: { ...art, url: 'javascript:1' }, at: 0 }));
  assert.equal(takePending(st, 1), null, '모양이 틀리면 버림');
  st.setItem(PENDING_KEY, '{깨진');
  assert.equal(takePending(st, 1), null);
  assert.equal(savePending(st, { ...art, channel: 'x' } as never), false);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
  assert.equal(savePending(broken, art), false, '저장소를 못 써도 오류 없음');
  assert.equal(takePending(broken), null);
}

// ---------- 서버 행 → 메시지, 삭제 표시 ----------
const row = (id: number, o: Partial<ChatMessage> = {}): ChatMessage => ({ id, user_id: 'u1', author_name: '가', body: `글 ${id}`, article: null, created_at: `2026-11-13T0${id % 10}:00:00Z`, deleted_at: null, ...o });
assert.equal(toMessage({ id: '7', user_id: 'u', author_name: 'A', body: 'x', article: null, created_at: '2026-11-13T00:00:00Z', deleted_at: null })!.id, 7, 'bigint 문자열도 숫자로');
assert.equal(toMessage({ id: 1 }), null);
assert.equal(toMessage({ id: -1, user_id: 'u', created_at: 'x' }), null);
{
  const d = toMessage({ id: 3, user_id: 'u', author_name: 'A', body: null, article: null, created_at: '2026-11-13T00:00:00Z', deleted_at: '2026-11-13T01:00:00Z' })!;
  assert.ok(isDeleted(d));
  assert.equal(DELETED_TEXT, '삭제된 글입니다');
  const bad = toMessage({ id: 4, user_id: 'u', author_name: 'A', body: 'x', article: { ...art, url: 'javascript:1' }, created_at: '2026-11-13T00:00:00Z', deleted_at: null })!;
  assert.equal(bad.article, null, '모양이 틀린 첨부는 그리지 않음');
  const ghost = toMessage({ id: 5, user_id: 'u', author_name: 'A', body: 'x', article: art, created_at: '2026-11-13T00:00:00Z', deleted_at: '2026-11-13T01:00:00Z' })!;
  assert.equal(ghost.body, null, '삭제 표시가 있으면 본문이 와도 그리지 않음');
  assert.equal(ghost.article, null);
}
// [삭제]는 관리자에게만(0005). 내 글이라도 관리자가 아니면 없다. 판정을 못 읽으면(null·undefined·다른 값) 숨김
assert.ok(canDelete(row(1), true), '관리자는 모든 글');
assert.ok(!canDelete(row(1, { user_id: 'u1' }), false), '일반 사용자의 내 글에도 [삭제] 없음');
assert.ok(!canDelete(row(1), null), '판정 못 읽음 → 숨김');
assert.ok(!canDelete(row(1), undefined), '판정 전 → 숨김');
assert.ok(!canDelete(row(1, { body: null, deleted_at: 'x' }), true), '지운 글에는 [삭제] 없음');
assert.equal(isAdminValue(true), true);
for (const v of [false, null, undefined, 'true', 1, {}]) assert.equal(isAdminValue(v), false, `관리자 아님: ${JSON.stringify(v)}`);
assert.equal(deleteFailNote(chatFailOf({ status: 403, code: 'PT403', message: 'not_allowed' })), '삭제 권한이 없습니다', 'PT403 → 권한 없음');
assert.equal(deleteFailNote(chatFailOf({ status: 0, message: 'Failed to fetch' })), '지우지 못했습니다. 잠시 후 다시 시도해 주세요');
assert.equal(deleteFailNote(chatFailOf({ status: 404, code: 'PT404', message: 'not_found' })), '지우지 못했습니다. 잠시 후 다시 시도해 주세요');

// ---------- 목록 병합(중복 제거·순서·삭제 우선·보충) ----------
{
  const a = [row(1), row(2), row(4)];
  const m = mergeMessages(a, [row(3), row(2), row(5), null]);
  assert.deepEqual(m.map(x => x.id), [1, 2, 3, 4, 5], 'id 오름차순, 중복 없음');
  assert.equal(mergeMessages(m, [row(3), row(5)]), m, '바뀐 것이 없으면 같은 배열(다시 그리지 않음)');
  const del = mergeMessages(m, [row(2, { body: null, deleted_at: '2026-11-13T05:00:00Z' })]);
  assert.ok(isDeleted(del.find(x => x.id === 2)!), '삭제 반영');
  const back = mergeMessages(del, [row(2)]);
  assert.ok(isDeleted(back.find(x => x.id === 2)!), '옛 페이지가 늦게 와도 지운 글이 살아나지 않음');
  assert.deepEqual(dropMessages(m, [3, 9]).map(x => x.id), [1, 2, 4, 5], '행이 지워진 경우(DELETE 이벤트)');
  assert.equal(dropMessages(m, [9]), m);
  assert.equal(lastId(m), 5); assert.equal(lastId([]), 0);
}
// 재연결 뒤 보충: 최근 페이지부터 거꾸로 마지막으로 받은 id 에 닿을 때까지
{
  const server = Array.from({ length: 650 }, (_, i) => row(i + 1));
  const calls: (number | null)[] = [];
  const list = async (before: number | null, limit: number) => { calls.push(before); return server.filter(m => before === null || m.id < before).sort((x, y) => y.id - x.id).slice(0, limit); };
  const r1 = await fetchSince(list, 640);
  assert.ok(r1.complete); assert.deepEqual(calls, [null], '빈틈이 작으면 한 번');
  const have = mergeMessages(server.slice(0, 640), r1.rows);
  assert.deepEqual(have.map(x => x.id), server.map(x => x.id), '빠진 글 없이 채워짐, 중복 없음');
  calls.length = 0;
  const r2 = await fetchSince(list, 300);
  assert.ok(r2.complete); assert.deepEqual(calls, [null, 451], '200건씩 거꾸로');
  assert.ok(r2.rows.some(m => m.id === 301) && r2.rows.some(m => m.id === 650));
  const r3 = await fetchSince(list, 10, 2);
  assert.equal(r3.complete, false, '빈틈이 너무 크면 다 채우지 못했다고 알림');
  const r4 = await fetchSince(async () => [row(1), row(2)], 0);
  assert.ok(r4.complete, '마지막 페이지(200건 미만)면 끝');
}

// ---------- 낙관적 표시: 내 글이 들어오면 '보내는 중' 하나만 지움 ----------
{
  const o = (key: string, body: string, state: Outgoing['state'] = 'sending', article = null): Outgoing => ({ key, body, article, state, at: 0 });
  const out = [o('k1', '같은 글'), o('k2', '같은 글'), o('k3', '실패한 글', 'failed')];
  const r = settleOutgoing(out, row(9, { user_id: 'me', body: '같은 글' }), 'me');
  assert.deepEqual(r.map(x => x.key), ['k2', 'k3'], '같은 내용 두 번 보냈으면 하나씩');
  assert.equal(settleOutgoing(out, row(9, { user_id: 'other', body: '같은 글' }), 'me'), out, '남의 글은 무관');
  assert.equal(settleOutgoing(out, row(9, { user_id: 'me', body: '실패한 글' }), 'me'), out, '실패 줄은 그대로');
}

// ---------- 한글 조합 중 Enter ----------
assert.equal(enterAction({ key: 'Enter', shiftKey: false }), 'send');
assert.equal(enterAction({ key: 'Enter', shiftKey: true }), 'newline');
assert.equal(enterAction({ key: 'Enter', shiftKey: false, isComposing: true }), 'none', '조합 중 Enter 는 보내지 않음');
assert.equal(enterAction({ key: 'Enter', shiftKey: false, keyCode: 229 }), 'none', 'Safari 조합 확정 Enter');
assert.equal(enterAction({ key: 'a', shiftKey: false }), 'none');

// ---------- 스크롤·시각 ----------
assert.ok(nearBottom(920, 1500, 500));
assert.ok(!nearBottom(500, 1500, 500), '위로 올려 읽는 중');
assert.equal(timeLabel('2026-11-13T15:05:00Z'), '00:05', '한국 시간');
assert.equal(dayKey('2026-11-13T15:05:00Z'), '2026-11-14');
assert.equal(dayLabel('2026-11-13T15:05:00Z'), '2026년 11월 14일 (토)');

// ---------- 서버 오류 구분 ----------
assert.equal(chatFailOf({ status: 404, code: 'PGRST202', message: 'Could not find the function' }), 'unavailable', 'SQL 미적용');
assert.equal(chatFailOf({ status: 422, code: 'PT422', message: 'body_length' }), 'length');
assert.equal(chatFailOf({ status: 422, code: 'PT422', message: 'body_format' }), 'format');
assert.equal(chatFailOf({ status: 422, code: 'PT422', message: 'article_format' }), 'article');
assert.equal(chatFailOf({ status: 429, code: 'PT429', message: 'rate_limited' }), 'rate');
assert.equal(chatFailOf({ status: 403, code: 'PT403', message: 'not_allowed' }), 'forbidden');
assert.equal(chatFailOf({ status: 401, code: 'PT401', message: 'not_signed_in' }), 'auth');
assert.equal(chatFailOf({ status: 401, code: 'PGRST301', message: 'JWT expired' }), 'auth');
assert.equal(chatFailOf({ status: 0, message: 'Failed to fetch' }), 'network');
assert.equal(chatFailOf({ status: 503, message: '' }), 'network');

// ---------- 기사만 있는 글(0004) ----------
assert.equal(sendProblem('', true), null, '입력창이 비어 있어도 첨부가 있으면 보냄');
assert.equal(sendProblem('  \n ', true), null, '공백만 + 첨부');
assert.equal(sendProblem('', false), 'empty', '글도 첨부도 없으면 안 됨');
assert.equal(sendProblem('가'.repeat(501), true), 'tooLong', '첨부가 있어도 501자는 안 됨');
assert.equal(sendProblem('a\u0007', true), 'invalid');
assert.ok(canSend('', true) && canSend('글', false) && !canSend('  ', false), '[보내기] 버튼: 글 또는 첨부');
{
  // 저장 구분: 기사만 = body ''(삭제 아님), 삭제 = body null + deleted_at
  const only = toMessage({ id: 9, user_id: 'u', author_name: 'A', body: '', article: art, created_at: '2026-11-13T00:00:00Z', deleted_at: null })!;
  assert.equal(only.body, ''); assert.ok(!isDeleted(only), '기사만 있는 글은 삭제가 아님'); assert.deepEqual(only.article, art);
  assert.ok(canDelete(only, true), '기사만 있는 글도 관리자는 지울 수 있음');
  const del = mergeMessages([only], [toMessage({ id: 9, user_id: 'u', author_name: 'A', body: null, article: null, created_at: '2026-11-13T00:00:00Z', deleted_at: '2026-11-13T01:00:00Z' })]);
  assert.ok(isDeleted(del[0]) && del[0].article === null, '기사만 있는 글을 지우면 삭제 표시');
  // 0004 적용 전: 서버가 본문 길이로 거절 → '글을 함께 적어 주세요'
  assert.equal(failNote({ body: '', article: art, fail: 'length' }), '글을 함께 적어 주세요');
  assert.equal(failNote({ body: '가', article: null, fail: 'length' }), '500자 이하로 써 주세요');
  assert.equal(failNote({ body: '가', article: null, fail: 'network' }), '');
}

// ---------- 읽음 호출 모으기(3초) ----------
{
  assert.equal(MARK_GAP_MS, 3000); assert.equal(COUNTS_EVERY_MS, 20_000);
  const base = { want: 10, sent: 5, lastAt: 0, now: 10_000, visible: true, seeingLatest: true, reads: 'unknown' as const };
  assert.deepEqual(markPlan(base), { send: true, wait: 0 }, '새로 읽은 것이 있고 3초 지남 → 보냄');
  assert.deepEqual(markPlan({ ...base, lastAt: 9_000 }), { send: false, wait: 2000 }, '3초 안이면 남은 시간만큼 모았다가');
  assert.deepEqual(markPlan({ ...base, lastAt: 7_000 }), { send: true, wait: 0 }, '정확히 3초');
  assert.deepEqual(markPlan({ ...base, sent: 10 }), { send: false, wait: 0 }, '새로 읽은 것 없음');
  assert.deepEqual(markPlan({ ...base, visible: false }), { send: false, wait: 0 }, '탭이 숨겨져 있으면 알리지 않음');
  assert.deepEqual(markPlan({ ...base, seeingLatest: false }), { send: false, wait: 0 }, '위로 읽는 중이면 알리지 않음');
  assert.deepEqual(markPlan({ ...base, reads: 'off' }), { send: false, wait: 0 }, '0004 미적용');
  // 3초 동안 여러 번 불러도 서버 호출은 처음 한 번 + 3초 뒤 한 번
  let sent = 0, lastAt = -1e9, calls = 0, want = 0;
  const timers: number[] = [];
  for (let t = 0; t <= 6000; t += 100) {
    want += 1;   // 0.1초마다 새 글
    const p = markPlan({ want, sent, lastAt, now: t, visible: true, seeingLatest: true, reads: 'on' });
    if (p.send) { calls++; sent = want; lastAt = t; } else if (p.wait) timers.push(p.wait);
  }
  assert.equal(calls, 3, `0·3·6초에만(실제 ${calls}번)`);
}

// ---------- 읽음 수: 탭이 보일 때만, 삭제 글 제외, 0004 미적용이면 숨김 ----------
{
  const ok = { ready: true, visible: true, reads: 'unknown' as const, ids: [1] };
  assert.ok(canFetchCounts(ok));
  assert.ok(!canFetchCounts({ ...ok, visible: false }), '탭이 숨겨진 동안은 가져오지 않음');
  assert.ok(!canFetchCounts({ ...ok, ready: false }));
  assert.ok(!canFetchCounts({ ...ok, ids: [] }), '내 글이 없으면 묻지 않음');
  assert.ok(!canFetchCounts({ ...ok, reads: 'off' }), '0004 미적용');
  const list = [row(1, { user_id: 'me' }), row(2, { user_id: 'x' }), row(3, { user_id: 'me', body: null, deleted_at: 'x' }), row(4, { user_id: 'me', body: '' , article: art as never })];
  assert.deepEqual(readCountIds(list, 'me'), [1, 4], '내 글 중 지우지 않은 것만(기사만 있는 글 포함)');
  assert.equal(readCountIds(Array.from({ length: 250 }, (_, i) => row(i + 1, { user_id: 'me' })), 'me').length, 200, '최근 200개');
  const m1 = applyCounts(new Map([[1, 2], [3, 1]]), [1, 3], [{ id: 1, read_count: 4 }]);
  assert.deepEqual([...m1], [[1, 4]], '답에 없는 id(지운 글)는 뺌');
  assert.deepEqual([...applyCounts(new Map([[7, 1]]), [1], [])], [[7, 1]], '묻지 않은 id 는 그대로');
  assert.equal(readLabel(3, 'on'), '읽음 3');
  assert.equal(readLabel(0, 'on'), '', '0이면 표시 안 함');
  assert.equal(readLabel(undefined, 'on'), '');
  assert.equal(readLabel(3, 'off'), '', '0004 미적용이면 숨김');
  assert.equal(readLabel(3, 'unknown'), '', '확인 전에는 숨김');
  assert.equal(readsAfterFail('unknown', 'unavailable'), 'off', '함수 없음(PGRST202) → 끔');
  assert.equal(readsAfterFail('on', 'network'), 'on', '일시 오류는 그대로');
  assert.equal(readsAfterFail('unknown', 'forbidden'), 'unknown');
}

console.log('chat tests passed');
