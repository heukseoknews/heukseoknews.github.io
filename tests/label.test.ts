import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BATCH, LABEL_KEY, applyAction, emptyStore, firstUnlabeled, keyAction, mergeRows, parseImport, parseStore, sampleOrder, seedFor, summary, toExport,
} from '../lib/label.ts';

// ───── 표본 추출: 재현성 ─────
const mk = (i: number, month = '2026-11') => ({ id: (i * 2654435761 % 2 ** 32).toString(16).padStart(8, '0') + i.toString(16).padStart(8, '0'), published_at: `${month}-0${1 + (i % 9)}T00:00:00+00:00` });
const pool = [...Array.from({ length: 400 }, (_, i) => mk(i)), ...Array.from({ length: 100 }, (_, i) => mk(1000 + i, '2026-10'))];
const shuffled = [...pool].reverse().concat(pool.slice(0, 50));   // 순서 바꾸고 중복 섞기
const a = sampleOrder(pool, seedFor('insurance')).map(x => x.id);
const b = sampleOrder(shuffled, seedFor('insurance')).map(x => x.id);
assert.equal(a.length, BATCH, '기본 150건');
assert.equal(new Set(a).size, BATCH, '중복 없음');
assert.deepEqual(a, b, '같은 시드면 입력 순서·중복과 무관하게 같은 순서');
assert.deepEqual(sampleOrder(pool, seedFor('insurance')).map(x => x.id), a, '다시 뽑아도 같다');
assert.notDeepEqual(sampleOrder(pool, seedFor('ai')).map(x => x.id), a, '채널마다 다른 시드');
assert.notDeepEqual(a, pool.slice(0, BATCH).map(x => x.id), '입력 순서 그대로가 아님(무작위)');
// '표본 더 뽑기': 300건의 앞 150건 = 기존 표본, 뒤 150건은 새 기사
const a300 = sampleOrder(pool, seedFor('insurance'), 'all', 2 * BATCH).map(x => x.id);
assert.deepEqual(a300.slice(0, BATCH), a);
assert.equal(new Set(a300).size, 2 * BATCH);
// 기사가 새로 수집돼도 기존 기사끼리의 순서는 유지
const grown = sampleOrder([...pool, ...Array.from({ length: 200 }, (_, i) => mk(5000 + i))], seedFor('insurance'), 'all', 1000).map(x => x.id);
assert.deepEqual(grown.filter(id => a300.includes(id)).slice(0, BATCH), a);
// 기간(월) 선택: 그 달 기사만, 전체 표본 순서의 부분 수열
const oct = sampleOrder(pool, seedFor('insurance'), '2026-10').map(x => x.id);
assert.equal(oct.length, 100, '기사가 150건보다 적으면 있는 만큼');
assert.ok(oct.every(id => pool.find(p => p.id === id)!.published_at.startsWith('2026-10')));
const allOrder = sampleOrder(pool, seedFor('insurance'), 'all', 10_000).map(x => x.id);
assert.deepEqual(allOrder.filter(id => oct.includes(id)), oct);

// ───── 내보내기·가져오기 형식 ─────
let st = emptyStore();
const ids = a.slice(0, 5);
st = applyAction(st, 'insurance', ids, { type: 'score', score: 2 }, '2026-11-14T01:00:00.000Z');
st = applyAction(st, 'insurance', ids, { type: 'score', score: 0 }, '2026-11-14T01:00:05.000Z');
const out = toExport(st);
assert.deepEqual(out, [
  { channel: 'insurance', id: ids[0], score: 2, labeled_at: '2026-11-14T01:00:00.000Z' },
  { channel: 'insurance', id: ids[1], score: 0, labeled_at: '2026-11-14T01:00:05.000Z' },
]);
for (const r of out) assert.deepEqual(Object.keys(r), ['channel', 'id', 'score', 'labeled_at'], '내보내기 행은 네 필드만');
// 왕복
const back = parseImport(JSON.stringify(out));
assert.deepEqual(back, { rows: out, skipped: 0 });
assert.deepEqual(toExport(mergeRows(emptyStore(), back.rows).store), out);
// 병합: 나중 라벨 우선, 새 라벨 추가, 형식 아닌 행은 건너뜀
const incoming = parseImport(JSON.stringify([
  { channel: 'insurance', id: ids[0], score: 3, labeled_at: '2026-11-14T02:00:00.000Z' },   // 더 늦음 → 바뀜
  { channel: 'insurance', id: ids[1], score: 3, labeled_at: '2026-11-13T00:00:00.000Z' },   // 더 이름 → 유지
  { channel: 'ai', id: 'abc', score: 1, labeled_at: '2026-11-14T03:00:00.000Z' },            // 새 라벨
  { channel: 'ai', id: 'bad', score: 4, labeled_at: '2026-11-14T03:00:00.000Z' },            // 점수 범위 밖
  { channel: 'ai', id: 'bad2', score: 1 },                                                    // 시각 없음
  null,
]));
assert.equal(incoming.skipped, 3);
const m = mergeRows(st, incoming.rows);
assert.equal(m.added, 1); assert.equal(m.updated, 1);
assert.equal(m.store.labels.insurance[ids[0]].score, 3);
assert.equal(m.store.labels.insurance[ids[1]].score, 0);
assert.equal(m.store.labels.ai.abc.score, 1);
assert.equal(st.labels.insurance[ids[0]].score, 2, '원본 상태는 바꾸지 않음');
assert.deepEqual(parseImport(JSON.stringify({ labels: out })).rows, out, '{ labels: [...] } 도 받음');
assert.throws(() => parseImport('not json'), /JSON/);
assert.throws(() => parseImport('{"x":1}'), /찾지 못했습니다/);
// 저장값 왕복(localStorage 키·깨진 값)
assert.equal(LABEL_KEY, 'heukseok-label-v1');
assert.deepEqual(parseStore(JSON.stringify(m.store)), m.store);
assert.deepEqual(parseStore('{broken'), emptyStore());
assert.deepEqual(parseStore(null), emptyStore());

// ───── 키보드 조작 기본 흐름 ─────
assert.deepEqual(keyAction('0'), { type: 'score', score: 0 });
assert.deepEqual(keyAction('3'), { type: 'score', score: 3 });
assert.equal(keyAction('4'), null);
assert.deepEqual(keyAction('ArrowLeft'), { type: 'prev' });
assert.deepEqual(keyAction('s'), { type: 'skip' });
assert.deepEqual(keyAction('S'), { type: 'skip' });
assert.deepEqual(keyAction('ㄴ'), { type: 'skip' }, '한글 자판 상태의 S');
assert.equal(keyAction('Enter'), null);
const q = ['a1', 'a2', 'a3'];
const press = (s0: ReturnType<typeof emptyStore>, keys: string[]) => keys.reduce((s, k, i) => { const act = keyAction(k); return act ? applyAction(s, 'ai', q, act, `2026-11-14T00:00:0${i}.000Z`) : s; }, s0);
let k = press(emptyStore(), ['2']);
assert.equal(k.sessions.ai.cursor, 1, '점수 → 다음 기사');
assert.equal(k.labels.ai.a1.score, 2);
k = press(k, ['s']);
assert.equal(k.sessions.ai.cursor, 2, 'S → 다음 기사');
assert.equal(k.labels.ai.a2, undefined, '건너뛰면 저장 안 함');
k = press(k, ['ArrowLeft']);
assert.equal(k.sessions.ai.cursor, 1, '← → 이전 기사');
k = press(k, ['1', '3']);
assert.deepEqual([k.labels.ai.a2.score, k.labels.ai.a3.score, k.sessions.ai.cursor], [1, 3, 3], '끝까지 매기면 cursor = 끝');
k = press(k, ['0', 's']);
assert.equal(k.sessions.ai.cursor, 3, '끝에서는 점수·건너뛰기 무시');
assert.equal(Object.keys(k.labels.ai).length, 3);
k = press(k, ['ArrowLeft', '0']);
assert.equal(k.labels.ai.a3.score, 0, '이전으로 돌아가 다시 매기면 덮어씀');
k = press(emptyStore(), ['ArrowLeft', 'x']);
assert.equal(k.sessions.ai.cursor, 0, '처음에서 ←, 모르는 키는 그대로');
assert.equal(firstUnlabeled(q, { a1: { score: 1, labeled_at: '2026-11-14T00:00:00Z' } }), 1);
assert.deepEqual(summary(q, press(emptyStore(), ['2', '2', '0']).labels.ai), { done: 3, total: 3, dist: { 0: 1, 1: 0, 2: 2, 3: 0 } });

// ───── 화면: 색인 제외·메뉴 미노출·눈가림 ─────
const page = readFileSync('app/label/page.tsx', 'utf8');
assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, 'noindex');
const tool = readFileSync('components/LabelTool.tsx', 'utf8');
assert.ok(!/\bart\.(score|score_v2|category|sub_categories|tags|cluster_\w+|relevant|companies|orgs|feed_name|department)\b/.test(tool), '내부 판단값을 화면에 쓰지 않음');
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const linking = [...walk('app'), ...walk('components'), ...walk('lib')].filter(f => /\.(tsx?|css)$/.test(f) && f !== join('app', 'label', 'page.tsx'))
  .filter(f => /['"`]\/label\b/.test(readFileSync(f, 'utf8')));
assert.deepEqual(linking, [], '/label/ 은 어디에도 링크하지 않음');
console.log('label tests passed');
