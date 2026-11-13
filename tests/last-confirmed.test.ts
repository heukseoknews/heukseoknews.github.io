// 마지막 확인(lastConfirmed) 보존: 이전 배포의 저장 형식 → 현재 코드의 읽기·이전·동기화 시작 경로를 거쳐도 남는지.
// 로그인 사용자는 동기화 도입(2026-11-13 오후 배포) 전까지 기기 사본(heukseok-v2:<채널>)에 기록했고, 지금은 계정 사본(…@<사용자 id>)을 읽는다.
import assert from 'node:assert/strict';
import { EMPTY_STATE, fromStored, laterIso, mergeStates, toStored } from '../lib/userState.ts';
import { accountStateKey, accountStore, localStorageStore, storeFor } from '../lib/storage.ts';
import { type RowBackend, accountKeyOf, readMeta, syncChannel, syncKey } from '../lib/sync.ts';
import { fromRow, mergeStates3, toRow } from '../lib/syncMerge.ts';
import type { KV } from '../lib/auth.ts';

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
const kv: KV = { get: k => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, remove: k => { mem.delete(k); } };
const CH = 'insurance', U = 'u1', LC = '2026-11-12T12:00:00.000Z';
const DEVICE = 'heukseok-v2:insurance';

function server(init: { rev: number; row: any } | null = null) {
  const st = { cur: init };
  const be: RowBackend = {
    async getRev() { return st.cur?.rev ?? null; },
    async getRow() { return st.cur ? { rev: st.cur.rev, row: JSON.parse(JSON.stringify(st.cur.row)) } : null; },
    async update(_c, row, e) { if (!st.cur || st.cur.rev !== e) return null; st.cur = { rev: e + 1, row: JSON.parse(JSON.stringify(row)) }; return st.cur.rev; },
    async insert(_c, row) { if (st.cur) return null; st.cur = { rev: 1, row: JSON.parse(JSON.stringify(row)) }; return 1; },
  };
  return { be, st };
}
const snap = { title: '제목', url: 'https://x/a', source: '연합뉴스', source_type: 'media', category: '손해보험', published_at: '2026-11-10T00:00:00+00:00' };

// 세 가지 저장 형식(그때 코드의 toStored 모양 그대로)
const FORMATS: { name: string; key: string; value: unknown }[] = [
  { name: '① 치운 기사 도입 전(기기 사본, dismissed 없음, folderId)', key: DEVICE, value: {
    schemaVersion: 2, channel: CH, folders: {}, tags: {}, lastConfirmed: LC, readAt: { r1: '2026-11-12T13:00:00.000Z' }, companies: [],
    bookmarks: { a: { ...snap, id: 'a', channel: CH, savedAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z', tags: [], memo: '' } } } },
  { name: '② 치운 기사 도입 후·동기화 전(기기 사본, dismissed 있음)', key: DEVICE, value: {
    schemaVersion: 2, channel: CH, bookmarks: {}, folders: {}, tags: {}, lastConfirmed: LC, readAt: {}, companies: [],
    dismissed: [{ id: 'x1', at: '2026-11-12T13:00:00.000Z' }] } },
  { name: '③ 동기화 후(계정 사본, lists)', key: accountStateKey(CH, U), value: {
    schemaVersion: 2, channel: CH, folders: {}, tags: {}, lastConfirmed: LC, readAt: {}, companies: [], dismissed: [],
    bookmarks: { a: { ...snap, id: 'a', channel: CH, savedAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z', lists: [], tags: [], memo: '' } } } },
];

for (const f of FORMATS) {
  mem.clear();
  mem.set(f.key, JSON.stringify(f.value));
  // 1) 정규화·이전(validIso·dismissed 이전)
  assert.equal(fromStored(f.value, CH, undefined, '2026-11-13T00:00:00.000Z').lastConfirmed, LC, `${f.name}: fromStored`);
  // 2) 로그인 전 화면(기기 사본)
  if (f.key === DEVICE) assert.equal(localStorageStore.load(CH).lastConfirmed, LC, `${f.name}: 기기 사본 읽기`);
  // 3) 로그인 중 화면의 첫 로드(useSaved: storeFor(uid).load)
  assert.equal(storeFor(U).load(CH).lastConfirmed, LC, `${f.name}: 로그인 중 첫 로드(계정 사본)`);
  // 4) 동기화 시작(서버 행 없음 → 올림)
  const s = server();
  await syncChannel(s.be, kv, U, CH);
  assert.equal(s.st.cur?.row.last_confirmed, LC, `${f.name}: 서버에 올라간 last_confirmed`);
  assert.equal(accountStore(U).load(CH).lastConfirmed, LC, `${f.name}: 동기화 후 계정 사본`);
}

// 서버 행에 last_confirmed 가 비어 있는(유실된) 상태로 남아 있어도 이 기기 값이 서버를 되살린다
{
  mem.clear();
  mem.set(DEVICE, JSON.stringify(FORMATS[1].value));
  const s = server({ rev: 3, row: toRow(EMPTY_STATE) });
  storeFor(U).load(CH);                 // 화면 첫 로드(useSaved) → 그다음 동기화 시작(같은 순서)
  await syncChannel(s.be, kv, U, CH);
  assert.equal(s.st.cur!.row.last_confirmed, LC, '서버 null + 기기 사본 값 → 서버도 값');
  assert.equal(accountStore(U).load(CH).lastConfirmed, LC);
}

// 로그인 전에 치운 기사: 처음 로그인한 이 기기의 계정 사본에도 남는다(다시 나타나지 않음)
{
  mem.clear();
  mem.set(DEVICE, JSON.stringify(FORMATS[1].value));
  assert.deepEqual(accountStore(U).load(CH).dismissed.map(e => e.id), ['x1'], '처음 로그인: 기기 사본의 치운 기사 이어받기');
  // 계정 사본이 생긴 뒤에는 되돌리기가 기기 사본 때문에 되살아나지 않는다(치운 기사는 처음 한 번만 이어받음)
  accountStore(U).save(CH, { ...accountStore(U).load(CH), dismissed: [] });
  assert.deepEqual(accountStore(U).load(CH).dismissed, [], '되돌린 치우기는 다시 생기지 않음');
}

// 두 사본에 모두 값이 있으면 늦은 쪽(Z·+00:00·마이크로초 섞여도 시각으로 비교)
{
  mem.clear();
  localStorageStore.save(CH, { ...EMPTY_STATE, lastConfirmed: '2026-11-12T12:00:00.000Z' });
  accountStore(U).save(CH, { ...EMPTY_STATE, lastConfirmed: '2026-11-11T12:00:00.000Z' });
  assert.equal(accountStore(U).load(CH).lastConfirmed, '2026-11-12T12:00:00.000Z', '기기 사본이 늦으면 기기 사본');
  localStorageStore.save(CH, { ...EMPTY_STATE, lastConfirmed: '2026-11-10T00:00:00.000Z' });
  assert.equal(accountStore(U).load(CH).lastConfirmed, '2026-11-12T12:00:00.000Z', '계정 사본이 늦으면 계정 사본(위에서 저장된 값)');
  assert.equal(laterIso('2026-11-12T09:00:00.000Z', '2026-11-12T09:00:00.500123+00:00'), '2026-11-12T09:00:00.500123+00:00');
  assert.equal(laterIso('2026-11-12T10:00:00+01:00', '2026-11-12T09:30:00Z'), '2026-11-12T09:30:00Z', '글자로는 앞이지만 시각으로는 늦음');
  assert.equal(laterIso(null, 'x'), null, '잘못된 값은 버림');
  assert.equal(mergeStates({ ...EMPTY_STATE, lastConfirmed: '2026-11-12T10:00:00+01:00' }, { ...EMPTY_STATE, lastConfirmed: '2026-11-12T09:30:00Z' }).lastConfirmed, '2026-11-12T09:30:00Z');
  assert.equal(mergeStates3(null, { ...EMPTY_STATE, lastConfirmed: '2026-11-12T10:00:00+01:00' }, fromRow({ last_confirmed: '2026-11-12T09:30:00.123456+00:00' }, CH)).lastConfirmed, '2026-11-12T09:30:00.123Z');
}

// 옛 상태를 들고 있던 다른 탭이 저장해도 확인 시각은 뒤로 가지 않는다(서버에도 옛 값을 올리지 않음)
{
  mem.clear();
  const s = server();
  const old = { ...EMPTY_STATE, lastConfirmed: '2026-11-10T00:00:00.000Z' };
  accountStore(U).save(CH, old); await syncChannel(s.be, kv, U, CH);
  accountStore(U).save(CH, { ...old, lastConfirmed: '2026-11-13T09:00:00.000Z' }); await syncChannel(s.be, kv, U, CH);   // 탭 A: 모두 확인
  const wrote = accountStore(U).save(CH, { ...old, readAt: { r: '2026-11-13T09:10:00.000Z' } });                           // 탭 B: 옛 상태로 읽음 표시
  assert.equal(wrote.lastConfirmed, '2026-11-13T09:00:00.000Z', '저장 결과에 늦은 값');
  await syncChannel(s.be, kv, U, CH);
  assert.equal(accountStore(U).load(CH).lastConfirmed, '2026-11-13T09:00:00.000Z');
  assert.equal(s.st.cur!.row.last_confirmed, '2026-11-13T09:00:00.000Z', '서버도 늦은 값 유지');
  assert.ok(readMeta(kv, CH, U).rev! >= 2 && mem.has(syncKey(CH, U)) && mem.has(accountKeyOf(CH, U)));
  // 로그인 전(기기 사본)도 같은 규칙
  localStorageStore.save(CH, { ...EMPTY_STATE, lastConfirmed: '2026-11-13T09:00:00.000Z' });
  assert.equal(localStorageStore.save(CH, { ...EMPTY_STATE }).lastConfirmed, '2026-11-13T09:00:00.000Z');
  assert.equal(JSON.parse(mem.get(DEVICE)!).lastConfirmed, '2026-11-13T09:00:00.000Z');
}

// 서버가 응답하지 않아도(실패) 계정 사본의 값은 그대로, 다음 동기화 때 올라간다
{
  mem.clear();
  accountStore(U).save(CH, { ...EMPTY_STATE, lastConfirmed: LC });
  const fail: RowBackend = { getRev: async () => { throw new Error('network'); }, getRow: async () => null, update: async () => null, insert: async () => null };
  await assert.rejects(syncChannel(fail, kv, U, CH));
  assert.equal(accountStore(U).load(CH).lastConfirmed, LC, '실패해도 기기에 남음');
  const s = server();
  await syncChannel(s.be, kv, U, CH);
  assert.equal(s.st.cur!.row.last_confirmed, LC, '다음 동기화 때 올라감');
}

// 저장 형식 확인: toStored 를 거친 값은 다시 읽어도 같다
assert.equal(fromStored(JSON.parse(JSON.stringify(toStored(CH, { ...EMPTY_STATE, lastConfirmed: LC }))), CH).lastConfirmed, LC);
console.log('last-confirmed tests passed');
