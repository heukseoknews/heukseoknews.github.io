import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Bookmark, LIMITS, UNKNOWN_TIME, addBookmark, createGroup, deleteGroup, fillMissing, folderOf, isBookmarked, isLive, liveBookmarks, liveGroups,
  purgeTombstones, removeBookmark, renameGroup, restoreBookmark, snapshotOf, tagsOf, toArticle, toggleBookmark, updateBookmark } from '../lib/bookmarks.ts';
import { EMPTY_STATE, type UserState, fromStored, mergeStates, toExportFile, toStored } from '../lib/userState.ts';
import type { Article } from '../lib/news.ts';

const art = (id: string, extra: Partial<Article> = {}): Article => ({ id, title: `제목 ${id}`, url: `https://x/${id}`, source: '한국경제', source_type: 'media', published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T01:00:00+00:00', category: '손해보험', sub_categories: ['보험경영·판매'], tags: ['인수'], score: 3, feed_name: 'f', companies: ['삼성화재'], orgs: [], ...extra });
const T = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const bm = (s: UserState, id: string) => s.bookmarks[id] as Bookmark;
const CH = 'insurance';

// ---------- 스냅샷·추가·해제 ----------
const snap = snapshotOf(art('a'))!;
assert.deepEqual(snap, { title: '제목 a', url: 'https://x/a', source: '한국경제', source_type: 'media', category: '손해보험', sub_categories: ['보험경영·판매'], keywords: ['인수'], companies: ['삼성화재'], orgs: [], published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T01:00:00+00:00', score: 3 });
assert.equal(snapshotOf({ title: '', url: 'x' }), null);
assert.equal(snapshotOf(null), null);
// B 세션이 기사에 선택 필드를 더해도(또는 빠져도) 스냅샷은 깨지지 않는다
assert.deepEqual(snapshotOf({ title: 't', url: 'u', extra_field: 1 })!.sub_categories, []);

let s: UserState = addBookmark(EMPTY_STATE, art('a'), CH, T(1));
const a = bm(s, 'a');
assert.equal(a.savedAt, T(1)); assert.equal(a.updatedAt, T(1)); assert.equal(a.channel, CH); assert.deepEqual(a.tags, []); assert.equal(a.memo, '');
assert.equal(addBookmark(s, art('a'), CH, T(2)), s);  // 이미 있으면 그대로
assert.ok(isBookmarked(s, 'a'));
// 기사 모양으로 되돌리기(북마크 탭·필터용): 분류 키워드는 tags 로
const back = toArticle(a);
assert.deepEqual(back.tags, ['인수']); assert.deepEqual(back.companies, ['삼성화재']); assert.equal(back.published_at, '2026-11-01T00:00:00+00:00'); assert.equal(back.score, 3);

// 해제 = 삭제 표시(바로 지우지 않음). 다시 누르면 새로 저장
const del = removeBookmark(s, 'a', T(2));
assert.equal(isBookmarked(del, 'a'), false);
assert.deepEqual(del.bookmarks.a, { id: 'a', channel: CH, savedAt: T(1), updatedAt: T(2), deletedAt: T(2) });
assert.equal(liveBookmarks(del).length, 0);
const again = toggleBookmark(del, art('a'), CH, T(3));
assert.ok(isBookmarked(again, 'a')); assert.equal(bm(again, 'a').savedAt, T(3));
assert.ok(!isBookmarked(toggleBookmark(again, art('a'), CH, T(4)), 'a'));
// 되돌리기: 지우기 직전 객체(메모 포함)를 그대로
const withMemo = updateBookmark(s, 'a', { memo: '중요' }, T(2));
const undone = restoreBookmark(removeBookmark(withMemo, 'a', T(3)), bm(withMemo, 'a'), T(4));
assert.equal(bm(undone, 'a').memo, '중요'); assert.equal(bm(undone, 'a').updatedAt, T(4));

// ---------- 폴더·태그·메모 ----------
let r = createGroup(s, 'folders', '  공부 자료 ', T(2), 'f_1'); s = r.state;
assert.equal(s.folders.f_1.name, '공부 자료');
assert.throws(() => createGroup(s, 'folders', '공부 자료', T(2)), /같은 이름의 폴더/);
assert.throws(() => createGroup(s, 'folders', '   ', T(2)), /폴더 이름을 입력/);
s = createGroup(s, 'tags', 'IFRS17', T(2), 't_1').state;
s = createGroup(s, 'tags', '킥스', T(2), 't_2').state;
s = updateBookmark(s, 'a', { folderId: 'f_1', tags: ['t_2', 't_1', 't_1', 'nope'], memo: '  다시 읽기  ' }, T(3));
assert.equal(bm(s, 'a').folderId, 'f_1'); assert.deepEqual(bm(s, 'a').tags, ['t_2', 't_1']); assert.equal(bm(s, 'a').memo, '다시 읽기'); assert.equal(bm(s, 'a').updatedAt, T(3));
assert.equal(updateBookmark(s, 'a', { memo: '다시 읽기' }, T(9)), s);  // 바뀐 게 없으면 수정 시각도 그대로
assert.equal(folderOf(s, bm(s, 'a'))!.name, '공부 자료');
assert.deepEqual(tagsOf(s, bm(s, 'a')).map(t => t.name), ['킥스', 'IFRS17']);  // 이름순(ko: 한글 먼저)
// 메모 200자 제한(코드 포인트 기준)
assert.equal([...bm(updateBookmark(s, 'a', { memo: '가'.repeat(250) }, T(4)), 'a').memo].length, LIMITS.memo);
// 이름 바꾸기
s = renameGroup(s, 'folders', 'f_1', '공부', T(4));
assert.equal(s.folders.f_1.name, '공부'); assert.equal(s.folders.f_1.updatedAt, T(4));
assert.throws(() => renameGroup(s, 'tags', 't_1', '킥스', T(4)), /같은 이름의 태그/);
// 지우기 = 삭제 표시. 쓰던 북마크는 '폴더 없음'·태그 없음으로 보인다
const noFolder = deleteGroup(s, 'folders', 'f_1', T(5));
assert.equal(noFolder.folders.f_1.deletedAt, T(5));
assert.equal(folderOf(noFolder, bm(noFolder, 'a')), undefined);
assert.equal(liveGroups(noFolder, 'folders').length, 0);
assert.deepEqual(tagsOf(deleteGroup(s, 'tags', 't_1', T(5)), bm(s, 'a')).map(t => t.name), ['킥스']);
// 지운 폴더에는 넣을 수 없다
assert.equal(bm(updateBookmark(noFolder, 'a', { folderId: 'f_1' }, T(6)), 'a').folderId, undefined);
// 지운 이름으로 다시 만들 수 있다
assert.doesNotThrow(() => createGroup(noFolder, 'folders', '공부', T(6)));

// 한도: 폴더 20, 태그 50, 북마크당 태그 10
let lim: UserState = EMPTY_STATE;
for (let i = 0; i < LIMITS.folders; i++) lim = createGroup(lim, 'folders', `폴더${i}`, T(1), `f_${i}`).state;
assert.throws(() => createGroup(lim, 'folders', '하나 더', T(1)), /폴더는 20개까지/);
lim = deleteGroup(lim, 'folders', 'f_0', T(2));
assert.doesNotThrow(() => createGroup(lim, 'folders', '하나 더', T(2)));  // 지우면 다시 만들 수 있다
for (let i = 0; i < LIMITS.tags; i++) lim = createGroup(lim, 'tags', `태그${i}`, T(1), `t_${i}`).state;
assert.throws(() => createGroup(lim, 'tags', '하나 더', T(1)), /태그는 50개까지/);
lim = updateBookmark(addBookmark(lim, art('x'), CH, T(1)), 'x', { tags: Array.from({ length: 15 }, (_, i) => `t_${i}`) }, T(2));
assert.equal(bm(lim, 'x').tags.length, LIMITS.tagsPerBookmark);

// ---------- 병합: 수정 시각이 늦은 쪽, 삭제 표시도 같은 기준 ----------
const base = s;  // 두 기기가 같은 상태에서 시작
// 1) 충돌: 같은 북마크를 두 기기에서 고침 → 늦게 고친 쪽
const devA = updateBookmark(base, 'a', { memo: 'A 메모' }, T(10, 1));
const devB = updateBookmark(base, 'a', { memo: 'B 메모' }, T(10, 2));
assert.equal(bm(mergeStates(devA, devB), 'a').memo, 'B 메모');
assert.equal(bm(mergeStates(devB, devA), 'a').memo, 'B 메모');  // 순서와 무관
// 2) 삭제가 되살아나지 않음: A 에서 지우고, 옛 사본(B)과 합쳐도 지운 상태
const aDel = removeBookmark(base, 'a', T(11));
assert.equal(isBookmarked(mergeStates(aDel, base), 'a'), false);
assert.equal(isBookmarked(mergeStates(base, aDel), 'a'), false);
// 지운 뒤에 다른 기기에서 고친 것이 더 늦으면 그쪽(늦은 쪽 우선 규칙 그대로)
const bEditLater = updateBookmark(base, 'a', { memo: '나중 수정' }, T(12));
assert.equal(isBookmarked(mergeStates(aDel, bEditLater), 'a'), true);
// 3) 합집합: 서로 다른 북마크·폴더·태그는 모두 남는다
const onlyA = createGroup(addBookmark(base, art('p'), CH, T(13)), 'tags', 'A태그', T(13), 't_a').state;
const onlyB = createGroup(addBookmark(base, art('q'), CH, T(13)), 'folders', 'B폴더', T(13), 'f_b').state;
const both = mergeStates(onlyA, onlyB);
assert.deepEqual(liveBookmarks(both).map(b => b.id).sort(), ['a', 'p', 'q']);
assert.ok(both.tags.t_a && both.folders.f_b && both.folders.f_1);
// 4) 폴더 삭제도 되살아나지 않음, 이름 바꾸기는 늦은 쪽
const fDel = deleteGroup(base, 'folders', 'f_1', T(14));
assert.ok(mergeStates(base, fDel).folders.f_1.deletedAt);
const ren = renameGroup(base, 'folders', 'f_1', '새 이름', T(15));
assert.equal(mergeStates(fDel, ren).folders.f_1.name, '새 이름'); assert.equal(mergeStates(fDel, ren).folders.f_1.deletedAt, undefined);
// 5) 멱등·교환(시각이 다를 때)
assert.deepEqual(mergeStates(both, both), both);
assert.deepEqual(mergeStates(mergeStates(onlyA, onlyB), onlyB), both);
// 6) v1 에서 이전한 같은 북마크(기기마다 따로 이전) — 수정 시각이 같아 한쪽만, 내용은 같다
const v1 = { schemaVersion: 1, bookmarks: { m: art('m') } };
const m1 = fromStored(v1, CH), m2 = fromStored(v1, CH);
assert.deepEqual(mergeStates(m1, m2), m1);
assert.equal(bm(m1, 'm').updatedAt, UNKNOWN_TIME);
// 7) 파일 가져오기(삭제 표시 없음)로도 지운 북마크가 되살아나지 않는다
const exported = fromStored(JSON.parse(JSON.stringify(toExportFile(CH, base))), CH);
assert.equal(isBookmarked(mergeStates(aDel, exported), 'a'), false);

// ---------- 삭제 표시 정리(30일) ----------
let old: UserState = removeBookmark(addBookmark(EMPTY_STATE, art('o'), CH, T(1)), 'o', '2026-10-01T00:00:00.000Z');
old = createGroup(old, 'folders', '옛 폴더', T(1), 'f_o').state;
old = deleteGroup(addBookmark(old, art('k'), CH, T(1)), 'folders', 'f_o', '2026-10-01T00:00:00.000Z');
old = { ...old, bookmarks: { ...old.bookmarks, k: { ...bm(old, 'k'), folderId: 'f_o' } } };
const purged = purgeTombstones(old, '2026-11-12T00:00:00.000Z');
assert.equal(purged.bookmarks.o, undefined); assert.equal(purged.folders.f_o, undefined);
assert.equal(bm(purged, 'k').folderId, undefined);  // 없어진 폴더 참조 정리
assert.equal(purgeTombstones(purged, '2026-11-12T00:00:00.000Z'), purged);  // 정리할 게 없으면 같은 객체
const recent = removeBookmark(addBookmark(EMPTY_STATE, art('r'), CH, T(1)), 'r', T(1));
assert.ok(purgeTombstones(recent, T(12)).bookmarks.r);  // 30일 안이면 남김

// ---------- 정보 없음 채우기 ----------
const sparse = fromStored({ bookmarks: { a: { id: 'a' }, z: { id: 'z' } } }, CH);
const filled = fillMissing(sparse, [art('a')]);
assert.equal(bm(filled, 'a').missing, undefined); assert.equal(bm(filled, 'a').title, '제목 a'); assert.equal(bm(filled, 'a').savedAt, '2026-11-01T01:00:00+00:00');
assert.equal(bm(filled, 'z').missing, true);  // 못 찾으면 그대로 보존
assert.equal(bm(filled, 'a').updatedAt, UNKNOWN_TIME);  // 사용자가 바꾼 것이 아니므로 수정 시각 유지
assert.equal(fillMissing(filled, []), filled);

// ---------- 크기 추정: 10명 · 1인 북마크 수백 건 ----------
// 실제 기사(data/insurance)로 북마크를 만들고 메모·태그·폴더를 한도까지 채운다.
const dataDir = join(import.meta.dirname, '../data/insurance');
const articles: Article[] = existsSync(dataDir) ? readdirSync(dataDir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(join(dataDir, f), 'utf8'))) : [];
const sized = (n: number, memoChars: number, reads: number) => {
  let st: UserState = EMPTY_STATE;
  for (let i = 0; i < LIMITS.folders; i++) st = createGroup(st, 'folders', `폴더 이름 ${i}`.slice(0, 20), T(1), `f_${i.toString(36)}abcdefgh`).state;
  for (let i = 0; i < LIMITS.tags; i++) st = createGroup(st, 'tags', `태그 ${i}`, T(1), `t_${i.toString(36)}abcdefgh`).state;
  const tagIds = Object.keys(st.tags), folderIds = Object.keys(st.folders);
  const src = articles.length ? articles : Array.from({ length: n }, (_, i) => art(`a${i}`));
  for (let i = 0; i < n; i++) {
    const a = src[i % src.length];
    const id = i < src.length ? a.id : `${a.id.slice(0, 12)}${(i).toString(16).padStart(4, '0')}`;
    st = addBookmark(st, { ...a, id }, CH, new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString());
    st = updateBookmark(st, id, { folderId: folderIds[i % folderIds.length], tags: tagIds.slice(i % 40, i % 40 + 3), memo: '메모'.repeat(memoChars / 2) }, new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString());
  }
  st = { ...st, readAt: Object.fromEntries(Array.from({ length: reads }, (_, i) => [`${(i * 2654435761 % 2 ** 32).toString(16).padStart(8, '0')}${(i * 40503).toString(16).padStart(8, '0')}`, new Date(Date.UTC(2026, 9, 1) + i * 137_123).toISOString()])) };
  return Buffer.byteLength(JSON.stringify(toStored(CH, st)));
};
const sizes = { light: sized(50, 20, 300), normal: sized(300, 60, 1500), max: sized(1000, 200, 5000) };
console.log(`  크기(채널 1개): 가벼움(북마크 50·메모 20자·읽음 300) ${(sizes.light / 1024).toFixed(0)}KB, 보통(300·60자·1,500) ${(sizes.normal / 1024).toFixed(0)}KB, 많음(1,000·200자·5,000) ${(sizes.max / 1024).toFixed(0)}KB` + (articles.length ? '' : ' (기사 데이터 없음: 가짜 기사)'));
// 서버 한 행 상한(docs/auth-plan.md 3.1: 2MB) 안에 들어와야 한다. 많음 = 1인 북마크 1,000건에 모든 메모 200자.
assert.ok(sizes.max < 2_000_000, `많음 ${sizes.max}바이트`);
assert.ok(sizes.normal < 600_000);

console.log('bookmarks tests passed');
