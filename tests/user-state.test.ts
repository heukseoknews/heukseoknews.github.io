import assert from 'node:assert/strict';
import { EMPTY_STATE, FORMAT, SCHEMA_VERSION, type UserState, fromStored, mergeStates, parseImport, storageKey, summarize, toExportFile, toStored } from '../lib/userState.ts';
import { localStorageStore } from '../lib/storage.ts';
import { SOFT_LIMIT } from '../lib/readState.ts';
import { type Bookmark, UNKNOWN_TIME, addBookmark, isLive, liveBookmarks } from '../lib/bookmarks.ts';
import type { Article } from '../lib/news.ts';

const LEGACY = { saved: 'actuary-news-hub-v3', companies: 'actuary-news-hub-companies-v1' };
const art = (id: string, extra = {}): Article => ({ id, title: `t${id}`, url: `https://x/${id}`, source: 's', source_type: 'media' as const, published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T01:00:00+00:00', category: '손해보험', tags: ['a'], score: 3, feed_name: 'f', ...extra });
const T = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const bm = (s: UserState, id: string) => s.bookmarks[id] as Bookmark;

// 키: schemaVersion·채널 포함
assert.equal(storageKey('insurance'), 'heukseok-v2:insurance');
assert.equal(storageKey('insurance', 1), 'heukseok-v1:insurance');
assert.equal(SCHEMA_VERSION, 2);

// ---------- v1 → v2 이전 ----------
// 옛 형식(readIds 배열)·보험사 별도 키
const old = fromStored({ bookmarks: { a: art('a') }, lastConfirmed: '2026-11-01T00:00:00.000Z', readIds: ['x', 'y'] }, 'insurance', ['삼성생명']);
assert.deepEqual(Object.keys(old.readAt), ['x', 'y']);
assert.deepEqual(old.companies, ['삼성생명']);
assert.deepEqual(fromStored('garbage', 'insurance'), EMPTY_STATE);
// v1 북마크(기사 객체 전체) → 스냅샷 + 빈 메타. 저장 시각은 수집 시각, 수정 시각은 UNKNOWN_TIME(기기마다 같은 값)
const a1 = bm(old, 'a');
assert.equal(a1.title, 'ta'); assert.equal(a1.url, 'https://x/a'); assert.equal(a1.channel, 'insurance');
assert.deepEqual(a1.keywords, ['a']); assert.deepEqual(a1.tags, []); assert.equal(a1.memo, ''); assert.deepEqual(a1.lists, []);
assert.equal(a1.savedAt, '2026-11-01T01:00:00+00:00'); assert.equal(a1.updatedAt, UNKNOWN_TIME); assert.equal(a1.missing, undefined);
assert.equal(a1.score, 3);
// 기사 정보가 없는 북마크(id 만, 제목 없음, 이상한 값)도 버리지 않고 '정보 없음'으로 보존
const sparse = fromStored({ bookmarks: { b: true, c: { id: 'c' }, d: { title: 1 }, 'bad id!': {} } }, 'insurance');
assert.deepEqual(Object.keys(sparse.bookmarks).sort(), ['b', 'c', 'd']);
for (const id of ['b', 'c', 'd']) { assert.equal(bm(sparse, id).missing, true); assert.equal(bm(sparse, id).title, ''); }
// 옛 형식 bookmarks 가 id 배열이어도
assert.deepEqual(Object.keys(fromStored({ bookmarks: ['p', 'q', 'p'] }, 'insurance').bookmarks), ['p', 'q']);
// v1 북마크 수와 이전 뒤 수가 같다(데이터를 잃지 않음)
const v1Many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`id${i}`, i % 7 ? art(`id${i}`) : { id: `id${i}` }]));
assert.equal(liveBookmarks(fromStored({ schemaVersion: 1, bookmarks: v1Many }, 'insurance')).length, 120);

// ---------- 흑석일보 내보내기 파일 ----------
let st: UserState = { ...EMPTY_STATE, lastConfirmed: '2026-11-02T00:00:00.000Z', readAt: { a: '2026-11-01T02:00:00.000Z' }, companies: ['삼성화재'] };
st = addBookmark(st, art('a'), 'insurance', T(3));
st = { ...st, folders: { f_1: { id: 'f_1', name: '공부', createdAt: T(3), updatedAt: T(3) } }, tags: { t_1: { id: 't_1', name: 'IFRS17', createdAt: T(3), updatedAt: T(3) } } };
st = { ...st, bookmarks: { ...st.bookmarks, a: { ...bm(st, 'a'), lists: ['f_1'], tags: ['t_1'], memo: '다시 읽기' }, z: { id: 'z', channel: 'insurance', savedAt: T(1), updatedAt: T(2), deletedAt: T(2) } } };
const file = JSON.parse(JSON.stringify(toExportFile('insurance', st, new Date('2026-11-11T00:00:00Z'))));
assert.equal(file.format, FORMAT); assert.equal(file.schemaVersion, 2); assert.equal(file.channel, 'insurance'); assert.equal(file.exported_at, '2026-11-11T00:00:00.000Z');
assert.equal(file.bookmarks.z, undefined);  // 삭제 표시는 내보내지 않음
const r1 = parseImport(file, 'insurance', LEGACY);
assert.equal(r1.kind, 'heukseok'); assert.equal(r1.version, 2);
assert.deepEqual(summarize(r1.state), { bookmarks: 1, reads: 1, lastConfirmed: st.lastConfirmed, companies: 1, folders: 1, tags: 1, memos: 1 });
assert.deepEqual(bm(r1.state, 'a'), bm(st, 'a'));  // 왕복해도 같다
assert.throws(() => parseImport(file, 'ai', LEGACY), /다른 채널\(보험\)의 백업/);
assert.throws(() => parseImport({ ...file, schemaVersion: 3 }, 'insurance', LEGACY), /새 버전에서 만든 파일/);
// v1 내보내기 파일도 계속 받는다
const v1File = { format: FORMAT, schemaVersion: 1, channel: 'insurance', exported_at: T(1), bookmarks: { a: art('a'), m: { id: 'm' } }, readAt: { a: T(1) }, lastConfirmed: null, companies: [] };
const r1b = parseImport(v1File, 'insurance', LEGACY);
assert.equal(r1b.version, 1); assert.equal(liveBookmarks(r1b.state).length, 2); assert.equal(bm(r1b.state, 'm').missing, true);

// ---------- 옛 사이트 형식 ----------
const dump = { 'actuary-news-hub-v3': JSON.stringify({ bookmarks: { b: art('b') }, lastConfirmed: null, readAt: { b: '2026-11-03T00:00:00.000Z' } }), 'actuary-news-hub-companies-v1': '["KB손해보험"]' };
const r2 = parseImport(dump, 'insurance', LEGACY);
assert.equal(r2.kind, 'legacy');
assert.deepEqual(summarize(r2.state), { bookmarks: 1, reads: 1, lastConfirmed: null, companies: 1, folders: 0, tags: 0, memos: 0 });
assert.deepEqual(parseImport({ 'actuary-news-hub-v3': { readIds: ['q'] } }, 'insurance', LEGACY).state.companies, []);
assert.equal(parseImport({ bookmarks: {}, readIds: ['z'] }, 'insurance', LEGACY).state.readAt.z !== undefined, true);
assert.throws(() => parseImport({ bookmarks: {} }, 'ai', {}), /형식이 아닙니다/);  // 옛 키가 없는 채널은 옛 형식을 받지 않음
assert.throws(() => parseImport([], 'insurance', LEGACY), /백업 파일 형식이 아닙니다/);
assert.throws(() => parseImport({ hello: 1 }, 'insurance', LEGACY), /형식이 아닙니다/);

// 가져올 때 정리: 배열 필드 채움, 잘못된 시각 버림, 메모 200자, 이상한 폴더·태그 버림
const dirty = parseImport({ ...file, bookmarks: { ok: { ...file.bookmarks.a, keywords: undefined, tags: 'x', companies: undefined, memo: '가'.repeat(300) } },
  folders: { f_1: { name: '  공부  ' }, f_2: { name: '' }, 'bad id': { name: 'x' } }, readAt: { a: 'not-a-date', b: '2026-11-01T00:00:00Z' }, lastConfirmed: 'x' }, 'insurance').state;
const ok = bm(dirty, 'ok');
assert.deepEqual(ok.keywords, []); assert.deepEqual(ok.companies, []); assert.deepEqual(ok.tags, []); assert.equal([...ok.memo].length, 200);
assert.deepEqual(Object.keys(dirty.folders), ['f_1']); assert.equal(dirty.folders.f_1.name, '공부');
assert.deepEqual(Object.keys(dirty.readAt), ['b']); assert.equal(dirty.lastConfirmed, null);

// ---------- 병합(읽음·확인 시각·보험사: 기존 규칙) ----------
const cur: UserState = { ...EMPTY_STATE, bookmarks: { a: { ...bm(st, 'a'), title: '기존' } }, lastConfirmed: '2026-11-05T00:00:00.000Z', readAt: { a: '2026-11-04T00:00:00.000Z', c: '2026-11-01T00:00:00.000Z' }, companies: ['삼성화재', '현대해상'] };
const inc: UserState = { ...EMPTY_STATE, bookmarks: { a: { ...bm(st, 'a'), title: '새것' }, b: { ...bm(addBookmark(EMPTY_STATE, art('b'), 'insurance', T(4)), 'b') } }, lastConfirmed: '2026-11-06T00:00:00.000Z', readAt: { a: '2026-11-02T00:00:00.000Z', d: '2026-11-03T00:00:00.000Z' }, companies: ['현대해상', 'DB손해보험'] };
const m = mergeStates(cur, inc);
assert.deepEqual(Object.keys(m.bookmarks).sort(), ['a', 'b']); assert.equal(bm(m, 'a').title, '기존');  // 수정 시각이 같으면 기존 것
assert.equal(m.readAt.a, '2026-11-02T00:00:00.000Z'); assert.ok(m.readAt.c && m.readAt.d);
assert.equal(m.lastConfirmed, '2026-11-06T00:00:00.000Z');
assert.deepEqual(m.companies, ['삼성화재', '현대해상', 'DB손해보험']);
assert.equal(mergeStates(EMPTY_STATE, EMPTY_STATE).lastConfirmed, null);
assert.deepEqual(mergeStates(cur, cur), cur);  // 같은 데이터를 다시 가져와도 그대로(멱등)
// 읽음 한도 적용
const many = (n: number, prefix: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()]));
const big = mergeStates({ ...EMPTY_STATE, readAt: many(1000, 'x'), lastConfirmed: '2026-12-01T00:00:00.000Z' }, { ...EMPTY_STATE, readAt: many(1000, 'y') });
assert.equal(Object.keys(big.readAt).length, SOFT_LIMIT);

// ---------- localStorage 어댑터 ----------
// 읽기: v2 키 → v1 키(이전) → 옛 키. 저장은 v2 키. v1·옛 키는 지우지 않음
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
assert.deepEqual(localStorageStore.load('insurance', LEGACY), EMPTY_STATE);
mem.set('actuary-news-hub-v3', JSON.stringify({ bookmarks: { a: art('a') }, lastConfirmed: '2026-11-01T00:00:00.000Z', readAt: { a: '2026-11-01T00:00:00.000Z' } }));
mem.set('actuary-news-hub-companies-v1', JSON.stringify(['삼성생명']));
const fromLegacy = localStorageStore.load('insurance', LEGACY);
assert.equal(liveBookmarks(fromLegacy).length, 1); assert.deepEqual(fromLegacy.companies, ['삼성생명']);
assert.deepEqual(localStorageStore.load('ai', {}), EMPTY_STATE);  // 다른 채널은 옛 키를 읽지 않음
// v1 키가 있으면 옛 키보다 우선, v2 로 이전
mem.set('heukseok-v1:insurance', JSON.stringify({ schemaVersion: 1, channel: 'insurance', bookmarks: { a: art('a'), b: art('b'), gone: { id: 'gone' } }, readAt: { a: T(1) }, lastConfirmed: T(2), companies: ['삼성화재'] }));
const fromV1 = localStorageStore.load('insurance', LEGACY);
assert.equal(liveBookmarks(fromV1).length, 3); assert.equal(bm(fromV1, 'gone').missing, true); assert.deepEqual(fromV1.companies, ['삼성화재']); assert.equal(fromV1.lastConfirmed, T(2));
localStorageStore.save('insurance', { ...fromV1, companies: ['현대해상'] });
const stored = JSON.parse(mem.get('heukseok-v2:insurance')!);
assert.equal(stored.schemaVersion, 2); assert.equal(stored.channel, 'insurance'); assert.deepEqual(stored.companies, ['현대해상']);
assert.ok(mem.has('heukseok-v1:insurance')); assert.ok(mem.has('actuary-news-hub-v3'));
assert.deepEqual(localStorageStore.load('insurance', LEGACY).companies, ['현대해상']);  // v2 키가 생기면 v2 우선
assert.deepEqual(localStorageStore.load('insurance', LEGACY), { ...fromV1, companies: ['현대해상'] });  // 저장 → 다시 읽기 왕복
// 오래된 삭제 표시는 읽을 때 정리(30일)
mem.set('heukseok-v2:insurance', JSON.stringify({ ...stored, bookmarks: { ...stored.bookmarks, old: { id: 'old', savedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' } } }));
assert.equal(localStorageStore.load('insurance', LEGACY).bookmarks.old, undefined);
mem.set('heukseok-v2:insurance', '{broken');
assert.deepEqual(localStorageStore.load('insurance', LEGACY), EMPTY_STATE);
assert.deepEqual(toStored('insurance', EMPTY_STATE), { schemaVersion: 2, channel: 'insurance', ...EMPTY_STATE });
assert.ok(isLive(bm(fromV1, 'a')));

console.log('user-state tests passed');
