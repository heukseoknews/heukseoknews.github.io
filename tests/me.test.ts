import assert from 'node:assert/strict';
import { ME_MENU, dataHref, meChannels, meHref, pickChannel } from '../lib/me.ts';
import { EMPTY_FILTERS, activeCount, groupByCategory, matches, sortBookmarks } from '../lib/myBookmarks.ts';
import { type Bookmark, addBookmark, createGroup, deleteGroup, liveBookmarks, updateBookmark } from '../lib/bookmarks.ts';
import { EMPTY_STATE, type UserState } from '../lib/userState.ts';
import type { Article } from '../lib/news.ts';

// ---------- 메뉴·채널 선택 ----------
assert.deepEqual(ME_MENU.map(m => m.href), ['/me/', '/me/data/']);  // 로그인 뒤 '/me/account/' 를 더할 자리
assert.deepEqual(meChannels(['insurance', 'ai']), ['insurance', 'ai']);
assert.deepEqual(meChannels(['insurance', 'ai', 'finance']), ['insurance', 'ai']);  // 준비 중 채널은 빠짐
assert.equal(pickChannel('ai', 'insurance', ['insurance', 'ai']), 'ai');
assert.equal(pickChannel('finance', 'ai', ['insurance', 'ai']), 'ai');       // 목록에 없는 ?ch= 는 무시
assert.equal(pickChannel(null, 'nope', ['insurance', 'ai']), 'insurance');
assert.equal(meHref('/me/', 'ai'), '/me/?ch=ai');
assert.equal(dataHref('insurance'), '/me/data/?ch=insurance');

// ---------- 걸러내기 ----------
const art = (id: string, x: Partial<Article> = {}): Article => ({ id, title: `제목 ${id}`, url: `https://x/${id}`, source: '한국경제', source_type: 'media', published_at: '2026-11-10T00:00:00+00:00', collected_at: '2026-11-10T00:00:00+00:00', category: '손해보험', tags: [], score: 3, feed_name: '', companies: [], orgs: [], ...x });
const T = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
let s: UserState = EMPTY_STATE;
s = addBookmark(s, art('a', { source: '연합', companies: ['삼성화재'] }), 'insurance', T(1));
s = addBookmark(s, art('b', { category: '생명보험', orgs: ['금융위원회'], published_at: '2026-09-01T00:00:00+00:00' }), 'insurance', T(2));
s = addBookmark(s, art('c', { category: '' }), 'insurance', T(3));
s = createGroup(s, 'folders', '공부', T(1), 'f_1').state;
s = createGroup(s, 'tags', 'IFRS17', T(1), 't_1').state;
s = createGroup(s, 'tags', '킥스', T(1), 't_2').state;
s = updateBookmark(s, 'a', { folderId: 'f_1', tags: ['t_1'], memo: '보고서에 인용' }, T(4));
s = updateBookmark(s, 'b', { tags: ['t_2'] }, T(4));
const list = liveBookmarks(s);
const ctx = { data: s, read: new Set(['b']), now: Date.parse('2026-11-12T00:00:00Z') };
const ids = (f: Partial<typeof EMPTY_FILTERS>, c = ctx) => list.filter(b => matches(b, { ...EMPTY_FILTERS, ...f }, c)).map(b => b.id).sort();
assert.deepEqual(ids({}), ['a', 'b', 'c']);
assert.deepEqual(ids({ category: '손해보험' }), ['a']);
assert.deepEqual(ids({ category: '미분류' }), ['c']);          // 분류 없는 기사는 '미분류'
assert.deepEqual(ids({ sources: ['연합'] }), ['a']);
assert.deepEqual(ids({ companies: ['삼성화재'] }), ['a']);
assert.deepEqual(ids({ orgs: ['금융위원회'] }), ['b']);
assert.deepEqual(ids({ period: '30' }), ['a', 'c']);            // 발행일 기준
assert.deepEqual(ids({ read: 'read' }), ['b']);
assert.deepEqual(ids({ read: 'unread' }), ['a', 'c']);
assert.deepEqual(ids({ folder: 'f_1' }), ['a']);
assert.deepEqual(ids({ folder: 'none' }), ['b', 'c']);
assert.deepEqual(ids({ tags: ['t_1', 't_2'] }), ['a', 'b']);    // 태그는 하나라도(OR)
assert.deepEqual(ids({ q: '인용' }), ['a']);                    // 메모 검색
assert.deepEqual(ids({ q: '제목 B' }), ['b']);                  // 제목 검색(대소문자 무시)
assert.deepEqual(ids({ category: '손해보험', tags: ['t_2'] }), []);  // 조건끼리는 AND
// 지운 폴더·태그로는 걸러지지 않는다(폴더 없음으로 보임)
const s2 = deleteGroup(deleteGroup(s, 'folders', 'f_1', T(5)), 'tags', 't_1', T(5));
assert.deepEqual(ids({ folder: 'none' }, { ...ctx, data: s2 }), ['a', 'b', 'c']);
assert.deepEqual(ids({ tags: ['t_1'] }, { ...ctx, data: s2 }), []);
// 건수용: 한 조건만 빼고
assert.equal(matches(list.find(b => b.id === 'b')!, { ...EMPTY_FILTERS, category: '손해보험' }, ctx, 'category'), true);
assert.equal(activeCount({ ...EMPTY_FILTERS, sources: ['x', 'y'], read: 'read', folder: 'f_1', q: 'a' }), 3);

// ---------- 정렬·묶기 ----------
assert.deepEqual(sortBookmarks(list, 'saved').map(b => b.id), ['c', 'b', 'a']);
assert.deepEqual(sortBookmarks(list, 'published').map(b => b.id), ['a', 'c', 'b']);
const g = groupByCategory(sortBookmarks(list, 'saved'), ['생명보험', '손해보험']);
assert.deepEqual(g.map(x => [x.category, x.items.map((b: Bookmark) => b.id)]), [['생명보험', ['b']], ['손해보험', ['a']], ['미분류', ['c']]]);

console.log('me tests passed');
