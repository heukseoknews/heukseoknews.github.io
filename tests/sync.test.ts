import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type Bookmark, LIMITS, MERGED_LIMITS, addBookmark, canAddBookmark, createGroup, deleteGroup, fillMissing, isBookmarked, isLive, liveBookmarks, liveGroups, mergeCheck, removeBookmark, updateBookmark } from '../lib/bookmarks.ts';
import { EMPTY_STATE, type UserState, fromStored, toStored } from '../lib/userState.ts';
import { type Row, baseOf, contentHash, fromRow, mergeStates3, sameContent, toRow } from '../lib/syncMerge.ts';
import { type RowBackend, SyncError, accountKeyOf, markDirty, readMeta, syncChannel } from '../lib/sync.ts';
import { claimMerge, claimable, claimedKey, laterKey, markClaimed, promptText, shouldAsk } from '../lib/claim.ts';
import { activeUserId, storeFor, localStorageStore } from '../lib/storage.ts';
import type { KV } from '../lib/auth.ts';
import type { Article } from '../lib/news.ts';

const CH = 'insurance';
const T = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const art = (id: string, extra: Partial<Article> = {}): Article => ({ id, title: `제목 ${id}`, url: `https://x/${id}`, source: '연합뉴스', source_type: 'media', published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T01:00:00+00:00', category: '손해보험', sub_categories: [], tags: [], score: 3, feed_name: 'f', ...extra });
const bm = (s: UserState, id: string) => s.bookmarks[id] as Bookmark;
const kvOf = (init: Record<string, string> = {}): KV & { m: Map<string, string> } => { const m = new Map(Object.entries(init)); return { m, get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } }; };

// ---------- 1) 모델 이전: 옛 폴더 하나(folderId) → 목록 여러 개(lists), 스냅샷(제목·출처·링크·발행 시각·cluster_id) ----------
{
  const old = fromStored({ schemaVersion: 2, bookmarks: { a: { title: 't', url: 'https://x/a', source: 's', published_at: T(1), savedAt: T(2), updatedAt: T(2), folderId: 'f_1', tags: [], memo: '' }, b: { title: 'u', url: 'https://x/b', savedAt: T(2), updatedAt: T(2), lists: ['f_1', 'f_2', 'f_1'], folderId: 'f_2', tags: [], memo: '' } },
    folders: { f_1: { name: '공부', createdAt: T(1), updatedAt: T(1) }, f_2: { name: '나중에', createdAt: T(1), updatedAt: T(1) } } }, CH);
  assert.deepEqual(bm(old, 'a').lists, ['f_1'], '옛 폴더 → 목록 하나');
  assert.deepEqual(bm(old, 'b').lists, ['f_1', 'f_2'], '중복 없이');
  assert.ok(!('folderId' in bm(old, 'a')), '옛 필드는 남기지 않음');
  assert.deepEqual(liveGroups(old, 'folders').map(g => g.name), ['나중에', '공부'].sort((x, y) => x.localeCompare(y, 'ko')));
  // 저장할 때 스냅샷에 cluster_id 도(기준 키는 기사 id)
  const s = addBookmark(EMPTY_STATE, art('c', { cluster_id: 'k1' }), CH, T(3));
  assert.equal(bm(s, 'c').cluster_id, 'k1');
  for (const k of ['id', 'channel', 'savedAt', 'title', 'source', 'url', 'published_at'] as const) assert.ok(bm(s, 'c')[k], `스냅샷 ${k}`);
  // 수집기가 묶음을 다시 계산해도(cluster_id 바뀜) 기사가 데이터에서 빠져도 북마크는 그대로(id 기준, 스냅샷 보존)
  assert.equal(fillMissing(s, [art('c', { cluster_id: 'k9', title: '바뀐 제목' })]), s, '정보가 있는 북마크는 다시 쓰지 않음');
  assert.equal(fillMissing(s, []), s, '기사가 데이터에서 빠져도 그대로');
  const back = fromStored(JSON.parse(JSON.stringify(toStored(CH, s))), CH);
  assert.equal(bm(back, 'c').cluster_id, 'k1'); assert.equal(bm(back, 'c').title, '제목 c');
  assert.equal(bm(fromRow(toRow(s), CH), 'c').title, '제목 c', '서버 행으로 오가도 스냅샷 보존');
}

// ---------- 2) 목록: 직접 만든 목록 3개까지(기본 '북마크'는 항상), 이미 넘은 목록은 지우지 않고 만들기만 막음, 한 기사를 여러 목록에 ----------
{
  let s = addBookmark(EMPTY_STATE, art('a'), CH, T(1));
  for (const n of ['공부', '보고서', '나중에']) s = createGroup(s, 'folders', n, T(1), `f_${n.length}${n.charCodeAt(0)}`).state;
  assert.throws(() => createGroup(s, 'folders', '넷째', T(1)), /목록은 3개까지입니다/);
  const ids = liveGroups(s, 'folders').map(g => g.id);
  s = updateBookmark(s, 'a', { lists: ids }, T(2));
  assert.equal(bm(s, 'a').lists.length, 3, '한 기사를 여러 목록에');
  const five = { ...s, folders: { ...s.folders, f_x: { id: 'f_x', name: '다른 기기 1', createdAt: T(1), updatedAt: T(1) }, f_y: { id: 'f_y', name: '다른 기기 2', createdAt: T(1), updatedAt: T(1) } } };
  assert.equal(liveGroups(fromStored(toStored(CH, five), CH), 'folders').length, 5, '이미 3개를 넘은 목록은 읽을 때 지우지 않음');
  assert.throws(() => createGroup(five, 'folders', '여섯째', T(1)), /3개까지/);
  const cut = deleteGroup(s, 'folders', ids[0], T(3));
  assert.ok(isBookmarked(cut, 'a'), '목록을 지워도 북마크는 기본 북마크에 남음');
  assert.ok(isBookmarked(updateBookmark(s, 'a', { lists: [] }, T(3)), 'a'), '목록에서 모두 빼도 북마크는 남음');
  // 북마크 1,000개 화면 한도
  let many: UserState = EMPTY_STATE;
  for (let i = 0; i < LIMITS.bookmarks; i++) many = { ...many, bookmarks: { ...many.bookmarks, [`a${i}`]: { ...bm(addBookmark(EMPTY_STATE, art(`a${i}`), CH, T(1)), `a${i}`) } } };
  assert.equal(canAddBookmark(many), false); assert.equal(canAddBookmark(s), true);
  const flow = readFileSync('components/BookmarkFlow.tsx', 'utf8');
  assert.match(flow, /if \(!isLive\(cur\) && !canAddBookmark\(saved\)\) \{ show\(\{ kind: 'full'/);
  assert.match(flow, /<span>북마크에 저장했습니다<\/span><button type="button" onClick=\{\(\) => openEditor\(toast\.id\)\}>정리<\/button>/, "한 번 누르면 기본 북마크에, 안내 '저장했습니다 [정리]' 유지");
  const editor = readFileSync('components/BookmarkEditor.tsx', 'utf8');
  assert.match(editor, /<legend>목록<\/legend>/); assert.match(editor, /checked disabled \/>\{DEFAULT_LIST_NAME\}/, "기본 '북마크'는 항상 담김");
}

// ---------- 3) 병합 규칙(두 기기) ----------
{
  const base = addBookmark(EMPTY_STATE, art('a'), CH, T(1));
  const devA = addBookmark(base, art('x'), CH, T(2, 1));                    // A 기기: x 담음
  const devB = removeBookmark(addBookmark(base, art('y'), CH, T(2, 2)), 'a', T(2, 3));  // B 기기: y 담고 a 해제
  const m = mergeStates3(baseOf(base), devA, devB);
  assert.ok(isBookmarked(m, 'x') && isBookmarked(m, 'y'), '서로 다른 북마크는 모두 남음(합집합)');
  assert.equal(isBookmarked(m, 'a'), false, '지운 북마크는 삭제 기록으로 전달(되살아나지 않음)');
  assert.ok(m.bookmarks.a && !isLive(m.bookmarks.a), '삭제 기록 보존');
  // 같은 북마크를 양쪽에서 고치면 늦게 고친 쪽(목록·메모·태그는 북마크 단위로 함께)
  const la = updateBookmark(base, 'a', { memo: 'A' }, T(3, 1)), lb = updateBookmark(base, 'a', { memo: 'B' }, T(3, 2));
  assert.equal(bm(mergeStates3(baseOf(base), la, lb), 'a').memo, 'B'); assert.equal(bm(mergeStates3(baseOf(base), lb, la), 'a').memo, 'B');
  // 읽음·보험사: 기준본과 비교(한쪽에서 지운 것은 지움, 새로 생긴 것은 남김)
  const b0: UserState = { ...EMPTY_STATE, readAt: { r1: T(1), r2: T(1), r5: T(1) }, companies: ['삼성화재', '현대해상', 'KB손해보험'] };
  const loc: UserState = { ...b0, readAt: { r1: T(1), r3: T(2), r5: T(1) }, companies: ['삼성화재', 'KB손해보험'] };          // 이 기기: r2 지움, r3 읽음, 현대해상 해제
  const srv: UserState = { ...b0, readAt: { r1: T(1), r2: T(1), r4: T(2) }, companies: ['삼성화재', '현대해상', 'DB손해보험'] };   // 서버(다른 기기): r5 지움, r4 읽음, KB 해제, DB 선택
  const m2 = mergeStates3(baseOf(b0), loc, srv);
  assert.deepEqual(Object.keys(m2.readAt).sort(), ['r1', 'r3', 'r4']);
  assert.deepEqual(m2.companies, ['삼성화재', 'DB손해보험']);
  // 성질: 서버가 기준본 그대로면 이 기기 내용, 이 기기가 기준본 그대로면 서버 내용, 두 번 합쳐도 같음
  assert.ok(sameContent(mergeStates3(baseOf(b0), loc, b0), loc));
  assert.ok(sameContent(mergeStates3(baseOf(b0), b0, srv), srv));
  assert.ok(sameContent(mergeStates3(baseOf(b0), m2, srv), m2) || sameContent(mergeStates3(baseOf(m2), m2, m2), m2));
  // 기준본이 없으면(처음) 합집합
  assert.deepEqual(Object.keys(mergeStates3(null, loc, srv).readAt).sort(), ['r1', 'r2', 'r3', 'r4', 'r5']);
  // 치운 기사는 서버에 없음 → 이 기기 것 유지
  assert.deepEqual(mergeStates3(null, { ...loc, dismissed: [{ id: 'd', at: T(1) }] }, srv).dismissed, [{ id: 'd', at: T(1) }]);
  assert.ok(!('dismissed' in toRow(loc)), '치운 기사는 서버에 보내지 않음');
  assert.equal(fromRow({ ...toRow(loc), last_confirmed: '2026-11-05T10:00:00+00:00' }, CH).lastConfirmed, '2026-11-05T10:00:00.000Z', '서버 시각 형식 맞춤');
}

// ---------- 4) 동기화 한 번(가짜 서버) ----------
type Srv = { rev: number; row: Row } | null;
function fakeServer(init: Srv = null, opt: { failOn?: 'getRev' | 'getRow' | 'update' | 'insert'; kind?: 'network' | 'auth' | 'limit'; beforeUpdate?: () => void } = {}) {
  const st = { cur: init, calls: [] as string[] };
  const be: RowBackend = {
    async getRev() { st.calls.push('getRev'); if (opt.failOn === 'getRev') throw new SyncError(opt.kind ?? 'network'); return st.cur?.rev ?? null; },
    async getRow() { st.calls.push('getRow'); if (opt.failOn === 'getRow') throw new SyncError(opt.kind ?? 'network'); return st.cur ? { rev: st.cur.rev, row: JSON.parse(JSON.stringify(st.cur.row)) } : null; },
    async update(_c, row, expect) { st.calls.push('update'); opt.beforeUpdate?.(); if (opt.failOn === 'update') throw new SyncError(opt.kind ?? 'network'); if (!st.cur || st.cur.rev !== expect) return null; st.cur = { rev: expect + 1, row: JSON.parse(JSON.stringify(row)) }; return st.cur.rev; },
    async insert(_c, row) { st.calls.push('insert'); if (opt.failOn === 'insert') throw new SyncError(opt.kind ?? 'network'); if (st.cur) return null; st.cur = { rev: 1, row: JSON.parse(JSON.stringify(row)) }; return 1; },
  };
  return { be, st };
}
const U = 'u1';
const put = (kv: KV, s: UserState) => kv.set(accountKeyOf(CH, U), JSON.stringify(toStored(CH, s)));
const got = (kv: KV) => fromStored(JSON.parse(kv.get(accountKeyOf(CH, U))!), CH);
{
  // 처음: 서버에 행이 없으면 만든다
  const kv = kvOf(); const { be, st } = fakeServer();
  put(kv, addBookmark(EMPTY_STATE, art('a'), CH, T(1)));
  assert.deepEqual(await syncChannel(be, kv, U, CH, () => T(5)), { changed: false, pushed: true });
  assert.equal(st.cur!.rev, 1); assert.ok(st.cur!.row.bookmarks.a);
  assert.equal(readMeta(kv, CH, U).rev, 1); assert.equal(readMeta(kv, CH, U).dirty, false); assert.equal(readMeta(kv, CH, U).at, T(5));
  // 바뀐 것이 없으면 rev 만 확인하고 끝(올리지 않음)
  st.calls.length = 0;
  assert.deepEqual(await syncChannel(be, kv, U, CH), { changed: false, pushed: false });
  assert.deepEqual(st.calls, ['getRev']);
  // 다른 기기(B)가 같은 계정으로 다른 북마크를 담음 → 합집합
  const kvB = kvOf();
  put(kvB, addBookmark(EMPTY_STATE, art('b'), CH, T(2)));
  assert.deepEqual(await syncChannel(be, kvB, U, CH), { changed: true, pushed: true });
  assert.ok(isBookmarked(got(kvB), 'a') && isBookmarked(got(kvB), 'b'), 'B 기기: a 받고 b 올림');
  assert.equal(st.cur!.rev, 2);
  // A 기기가 다시 맞추면 b 를 받는다
  assert.equal((await syncChannel(be, kv, U, CH)).changed, true);
  assert.ok(isBookmarked(got(kv), 'b'));
  // 화면에서 바꾸면(보낼 것 있음) 올림
  put(kv, updateBookmark(got(kv), 'a', { memo: '메모' }, T(6))); markDirty(kv, CH, U);
  assert.equal(readMeta(kv, CH, U).dirty, true);
  assert.equal((await syncChannel(be, kv, U, CH)).pushed, true);
  assert.equal((st.cur!.row.bookmarks.a as Bookmark).memo, '메모');
  assert.equal(readMeta(kv, CH, U).dirty, false);
}
{
  // 올리는 사이 다른 기기가 먼저 올림(rev 어긋남) → 받아서 다시 합치고 올림
  const kv = kvOf(); const { be, st } = fakeServer({ rev: 3, row: toRow(addBookmark(EMPTY_STATE, art('s'), CH, T(1))) });
  let raced = false;
  const be2: RowBackend = { ...be, async update(c, row, rev) { if (!raced) { raced = true; st.cur = { rev: 4, row: toRow(addBookmark(fromRow(st.cur!.row, CH), art('t'), CH, T(2))) }; } return be.update(c, row, rev); } };
  put(kv, addBookmark(EMPTY_STATE, art('l'), CH, T(1)));
  await syncChannel(be2, kv, U, CH);
  for (const id of ['s', 't', 'l']) assert.ok(st.cur!.row.bookmarks[id], `서버에 ${id}`);
  for (const id of ['s', 't', 'l']) assert.ok(isBookmarked(got(kv), id), `기기에 ${id}`);
  assert.equal(st.cur!.rev, 5);
}
{
  // 서버를 기다리는 동안 화면에서 바뀌면 덮어쓰지 않고 처음부터
  const kv = kvOf(); const { be, st } = fakeServer({ rev: 1, row: toRow(addBookmark(EMPTY_STATE, art('s'), CH, T(1))) });
  let once = false;
  const be2: RowBackend = { ...be, async getRow(c) { const r = await be.getRow(c); if (!once) { once = true; put(kv, addBookmark(got(kv), art('n'), CH, T(3))); } return r; } };
  put(kv, addBookmark(EMPTY_STATE, art('l'), CH, T(1)));
  await syncChannel(be2, kv, U, CH);
  for (const id of ['s', 'l', 'n']) { assert.ok(isBookmarked(got(kv), id), `기기에 ${id}`); assert.ok(st.cur!.row.bookmarks[id], `서버에 ${id}`); }
}
{
  // 서버 오류(일시 중지·무응답·로그인 끝남·한도): 기기 사본은 그대로, 오류 종류를 알림, 보낼 것 있음 유지
  for (const [failOn, kind] of [['getRev', 'network'], ['getRow', 'network'], ['update', 'auth'], ['update', 'limit']] as const) {
    const kv = kvOf(); const { be } = fakeServer({ rev: 1, row: toRow(EMPTY_STATE) }, { failOn, kind });
    const local = addBookmark(EMPTY_STATE, art('keep'), CH, T(1));
    put(kv, local); markDirty(kv, CH, U);
    const before = kv.get(accountKeyOf(CH, U));
    await assert.rejects(syncChannel(be, kv, U, CH), (e: unknown) => e instanceof SyncError && e.kind === kind, `${failOn}: ${kind}`);
    assert.ok(isBookmarked(got(kv), 'keep'), `${failOn}: 기기 북마크 그대로`);
    if (failOn !== 'update') assert.equal(kv.get(accountKeyOf(CH, U)), before, '기기 사본을 건드리지 않음');
    assert.equal(readMeta(kv, CH, U).dirty, true, '보낼 것 있음 유지 → 다음에 다시');
  }
  // 오류가 풀리면 다음 동기화에서 보낸다
  const kv = kvOf(); const srv = fakeServer();
  put(kv, addBookmark(EMPTY_STATE, art('later'), CH, T(1)));
  await assert.rejects(syncChannel(fakeServer(null, { failOn: 'insert' }).be, kv, U, CH));
  await syncChannel(srv.be, kv, U, CH);
  assert.ok(srv.st.cur!.row.bookmarks.later);
}

// ---------- 5) 처음 로그인: 이 기기 북마크를 합칠까요? ----------
{
  const kv = kvOf();
  const dev = addBookmark(addBookmark(EMPTY_STATE, art('d1'), CH, T(1)), art('d2'), CH, T(1));
  const items = claimable(kv, U, [{ channel: CH, state: dev }, { channel: 'ai', state: EMPTY_STATE }]);
  assert.deepEqual(items, [{ channel: CH, count: 2 }], '북마크가 있는 채널만');
  assert.equal(shouldAsk(kv, U, items), true);
  assert.equal(promptText(items), '이 기기의 북마크 2개를 내 계정에 합칠까요?');
  assert.equal(shouldAsk(kv, U, []), false, '기기에 북마크가 없으면 묻지 않음');
  // 나중에: 다시 자동으로 묻지 않음(내 데이터 화면 버튼으로만)
  const kvLater = kvOf({ [laterKey(U)]: T(1) });
  assert.equal(shouldAsk(kvLater, U, items), false);
  assert.equal(claimable(kvLater, U, [{ channel: CH, state: dev }]).length, 1, '나중에여도 합칠 거리는 남음(버튼)');
  // 합치기: 계정 + 기기 합집합, 기기 기록은 지우지 않음, 이 계정에 합쳤다고 표시 → 다시 묻지 않음
  const acct = addBookmark(EMPTY_STATE, art('s1'), CH, T(1));
  const r = claimMerge(acct, dev);
  assert.equal(r.over, false); assert.deepEqual(r.notes, []);
  assert.deepEqual(liveBookmarks(r.state).map(b => b.id).sort(), ['d1', 'd2', 's1']);
  markClaimed(kv, CH, U, T(2));
  assert.deepEqual(claimable(kv, U, [{ channel: CH, state: dev }]), [], '합친 뒤에는 묻지 않음');
  assert.equal(claimable(kv, 'u2', [{ channel: CH, state: dev }]).length, 1, '다른 계정이면 그 계정이 고르게 다시 물음');
  assert.ok(kv.get(claimedKey(CH)));
  // 한도: 합친 결과가 화면 한도를 넘으면 안내(지우지 않음), 서버 상한을 넘으면 합치지 않음
  const lists = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f_${i}`, { id: `f_${i}`, name: `목록${i}`, createdAt: T(1), updatedAt: T(1) }]));
  const r2 = claimMerge({ ...acct, folders: lists(3) }, { ...dev, folders: { f_9: { id: 'f_9', name: '기기 목록', createdAt: T(1), updatedAt: T(1) } } });
  assert.equal(r2.over, false); assert.equal(liveGroups(r2.state, 'folders').length, 4);
  assert.match(r2.notes.join(), /목록이 3개를 넘어 줄이기 전까지 새 목록을 만들 수 없습니다/);
  const big = (pre: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pre}${i}`, bm(addBookmark(EMPTY_STATE, art(`${pre}${i}`), CH, T(1)), `${pre}${i}`)]));
  const r3 = claimMerge({ ...EMPTY_STATE, bookmarks: big('p', 1600) }, { ...EMPTY_STATE, bookmarks: big('q', 1600) });
  assert.equal(r3.over, true, '3,200개 > 서버 상한 3,000 → 합치지 않음'); assert.equal(liveBookmarks(r3.state).length, 1600, '계정 사본 그대로');
  assert.equal(mergeCheck({ ...EMPTY_STATE, bookmarks: big('p', 1200) }).notes.length, 1);
  assert.ok(MERGED_LIMITS.bookmarks === 2000);
}

// ---------- 6) 로그인 꺼진 빌드·로그인 전: 지금처럼 기기 저장만 ----------
{
  const kv = kvOf({ 'heukseok-auth': JSON.stringify({ refresh_token: 'r', user: { id: U } }), [`heukseok-account-v1:${U}`]: JSON.stringify({ loginId: 'kim01', displayName: null, mustChange: false, checkedAt: T(1) }) });
  assert.equal(activeUserId(kv, 'off'), null, '꺼진 빌드는 계정 사본을 쓰지 않음');
  assert.equal(activeUserId(kv, 'optional'), U);
  assert.equal(activeUserId(kvOf(), 'optional'), null, '로그인 전');
  const must = kvOf({ 'heukseok-auth': JSON.stringify({ refresh_token: 'r', user: { id: U } }), [`heukseok-account-v1:${U}`]: JSON.stringify({ loginId: 'kim01', displayName: null, mustChange: true, checkedAt: T(1) }) });
  assert.equal(activeUserId(must, 'optional'), null, '비밀번호 변경 전에는 동기화 안 함(서버도 막음)');
  assert.equal(storeFor(null), localStorageStore);
  const saved = readFileSync('lib/useSaved.ts', 'utf8');
  assert.match(saved, /const store = useMemo\(\(\) => storeFor\(uid\), \[uid\]\);/);
  assert.match(saved, /import\('\.\/syncManager'\)/, '동기화 실행기는 로그인을 켠 빌드에서 처음 쓸 때만 불러옴');
  // 다른 사람의 북마크를 읽는 경로 없음: 모든 서버 요청에 본인 user_id 조건(RLS 와 이중)
  const be = readFileSync('lib/syncBackend.ts', 'utf8');
  assert.equal((be.match(/from\('user_state'\)/g) ?? []).length, 1);
  for (const op of ['getRev', 'getRow', 'update']) assert.match(be, new RegExp(`async ${op}[\\s\\S]{0,260}\\.eq\\('user_id', userId\\)`), op);
  assert.match(be, /insert\(\{ user_id: userId, channel/);
  assert.ok(!/service_role|sb_secret_/.test(be));
  // 해시는 내용이 같으면 같다(키 순서 무관)
  const s = addBookmark(EMPTY_STATE, art('h'), CH, T(1));
  assert.equal(contentHash(s), contentHash(JSON.parse(JSON.stringify({ ...s, companies: [] }))));
}
console.log('sync tests passed');
