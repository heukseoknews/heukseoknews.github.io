import assert from 'node:assert/strict';
import { EMPTY_STATE, FORMAT, SCHEMA_VERSION, fromStored, mergeStates, parseImport, storageKey, summarize, toExportFile, toStored } from '../lib/userState.ts';
import { localStorageStore } from '../lib/storage.ts';
import { SOFT_LIMIT } from '../lib/readState.ts';
import type { Article } from '../lib/news.ts';

const LEGACY = { saved: 'actuary-news-hub-v3', companies: 'actuary-news-hub-companies-v1' };
const art = (id: string, extra = {}): Article => ({ id, title: `t${id}`, url: `https://x/${id}`, source: 's', source_type: 'media' as const, published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T01:00:00+00:00', category: '손해보험', tags: ['a'], score: 3, feed_name: 'f', ...extra });

// 키: schemaVersion·채널 포함
assert.equal(storageKey('insurance'), 'heukseok-v1:insurance');
assert.equal(SCHEMA_VERSION, 1);

// 옛 형식(readIds 배열) 이전
const old = fromStored({ bookmarks: { a: art('a') }, lastConfirmed: '2026-11-01T00:00:00.000Z', readIds: ['x', 'y'] }, ['삼성생명']);
assert.deepEqual(Object.keys(old.readAt), ['x', 'y']);
assert.deepEqual(old.companies, ['삼성생명']);
assert.deepEqual(fromStored('garbage'), EMPTY_STATE);

// 1) 흑석일보 내보내기 파일 왕복
const st = { bookmarks: { a: art('a') }, lastConfirmed: '2026-11-02T00:00:00.000Z', readAt: { a: '2026-11-01T02:00:00.000Z' }, companies: ['삼성화재'] };
const file = JSON.parse(JSON.stringify(toExportFile('insurance', st, new Date('2026-11-11T00:00:00Z'))));
assert.equal(file.format, FORMAT); assert.equal(file.schemaVersion, 1); assert.equal(file.channel, 'insurance'); assert.equal(file.exported_at, '2026-11-11T00:00:00.000Z');
const r1 = parseImport(file, 'insurance', LEGACY);
assert.equal(r1.kind, 'heukseok');
assert.deepEqual(summarize(r1.state), { bookmarks: 1, reads: 1, lastConfirmed: st.lastConfirmed, companies: 1 });
assert.throws(() => parseImport(file, 'ai', LEGACY), /다른 채널\(보험\)의 백업/);
assert.throws(() => parseImport({ ...file, schemaVersion: 2 }, 'insurance', LEGACY), /새 버전에서 만든 파일/);

// 2) 옛 사이트 localStorage 묶음(값이 JSON 문자열이어도 받음)
const dump = { 'actuary-news-hub-v3': JSON.stringify({ bookmarks: { b: art('b') }, lastConfirmed: null, readAt: { b: '2026-11-03T00:00:00.000Z' } }), 'actuary-news-hub-companies-v1': '["KB손해보험"]' };
const r2 = parseImport(dump, 'insurance', LEGACY);
assert.equal(r2.kind, 'legacy');
assert.deepEqual(summarize(r2.state), { bookmarks: 1, reads: 1, lastConfirmed: null, companies: 1 });
assert.deepEqual(parseImport({ 'actuary-news-hub-v3': { readIds: ['q'] } }, 'insurance', LEGACY).state.companies, []);

// 3) 옛 키 값 그대로 / 잘못된 입력
assert.equal(parseImport({ bookmarks: {}, readIds: ['z'] }, 'insurance', LEGACY).state.readAt.z !== undefined, true);
assert.throws(() => parseImport({ bookmarks: {} }, 'ai', {}), /형식이 아닙니다/);  // 옛 키가 없는 채널은 옛 형식을 받지 않음
assert.throws(() => parseImport([], 'insurance', LEGACY), /백업 파일 형식이 아닙니다/);
assert.throws(() => parseImport({ hello: 1 }, 'insurance', LEGACY), /형식이 아닙니다/);

// 가져온 북마크 정리: 필수 필드 없으면 버리고, 배열 필드는 채움. 잘못된 시각은 버림
const dirty = parseImport({ ...file, bookmarks: { ok: { ...art('ok'), tags: undefined, companies: undefined }, bad: { title: 1 } }, readAt: { a: 'not-a-date', b: '2026-11-01T00:00:00Z' }, lastConfirmed: 'x' }, 'insurance').state;
assert.deepEqual(Object.keys(dirty.bookmarks), ['ok']);
assert.deepEqual(dirty.bookmarks.ok.tags, []); assert.deepEqual(dirty.bookmarks.ok.companies, []); assert.deepEqual(dirty.bookmarks.ok.orgs, []);
assert.deepEqual(Object.keys(dirty.readAt), ['b']); assert.equal(dirty.lastConfirmed, null);

// 병합: 합집합, 읽은 시각은 이른 쪽, 확인 시각은 늦은 쪽, 기존 북마크 유지, 보험사는 기존 순서 + 새 항목
const cur = { bookmarks: { a: art('a', { title: '기존' }) }, lastConfirmed: '2026-11-05T00:00:00.000Z', readAt: { a: '2026-11-04T00:00:00.000Z', c: '2026-11-01T00:00:00.000Z' }, companies: ['삼성화재', '현대해상'] };
const inc = { bookmarks: { a: art('a', { title: '새것' }), b: art('b') }, lastConfirmed: '2026-11-06T00:00:00.000Z', readAt: { a: '2026-11-02T00:00:00.000Z', d: '2026-11-03T00:00:00.000Z' }, companies: ['현대해상', 'DB손해보험'] };
const m = mergeStates(cur, inc);
assert.deepEqual(Object.keys(m.bookmarks).sort(), ['a', 'b']); assert.equal(m.bookmarks.a.title, '기존');
assert.equal(m.readAt.a, '2026-11-02T00:00:00.000Z'); assert.ok(m.readAt.c && m.readAt.d);
assert.equal(m.lastConfirmed, '2026-11-06T00:00:00.000Z');
assert.deepEqual(m.companies, ['삼성화재', '현대해상', 'DB손해보험']);
assert.equal(mergeStates(EMPTY_STATE, EMPTY_STATE).lastConfirmed, null);
assert.deepEqual(mergeStates(cur, cur), { ...cur, readAt: cur.readAt });  // 같은 데이터를 다시 가져와도 그대로(멱등)
// 읽음 한도 적용
const many = (n: number, prefix: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString()]));
const big = mergeStates({ ...EMPTY_STATE, readAt: many(1000, 'x'), lastConfirmed: '2026-12-01T00:00:00.000Z' }, { ...EMPTY_STATE, readAt: many(1000, 'y') });
assert.equal(Object.keys(big.readAt).length, SOFT_LIMIT);

// localStorage 어댑터: 새 키 → 옛 키 순서, 저장은 새 키(schemaVersion·channel 포함), 옛 키는 지우지 않음
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
assert.deepEqual(localStorageStore.load('insurance', LEGACY), EMPTY_STATE);
mem.set('actuary-news-hub-v3', JSON.stringify({ bookmarks: { a: art('a') }, lastConfirmed: '2026-11-01T00:00:00.000Z', readAt: { a: '2026-11-01T00:00:00.000Z' } }));
mem.set('actuary-news-hub-companies-v1', JSON.stringify(['삼성생명']));
const fromLegacy = localStorageStore.load('insurance', LEGACY);
assert.equal(Object.keys(fromLegacy.bookmarks).length, 1); assert.deepEqual(fromLegacy.companies, ['삼성생명']);
assert.deepEqual(localStorageStore.load('ai', {}), EMPTY_STATE);  // 다른 채널은 옛 키를 읽지 않음
localStorageStore.save('insurance', { ...fromLegacy, companies: ['삼성화재'] });
const stored = JSON.parse(mem.get('heukseok-v1:insurance')!);
assert.equal(stored.schemaVersion, 1); assert.equal(stored.channel, 'insurance'); assert.deepEqual(stored.companies, ['삼성화재']);
assert.ok(mem.has('actuary-news-hub-v3'));
assert.deepEqual(localStorageStore.load('insurance', LEGACY).companies, ['삼성화재']);  // 새 키가 생기면 새 키 우선
mem.set('heukseok-v1:insurance', '{broken');
assert.deepEqual(localStorageStore.load('insurance', LEGACY), EMPTY_STATE);
assert.deepEqual(toStored('insurance', EMPTY_STATE), { schemaVersion: 1, channel: 'insurance', ...EMPTY_STATE });
console.log('user-state tests passed');
