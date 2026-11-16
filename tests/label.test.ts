import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BATCH, LABEL_KEY, applyAction, emptyStore, firstUnlabeled, keyAction, mergeRows, parseImport, parseStore, queueFor, sampleOrder, seedFor, summary, toExport,
} from '../lib/label.ts';

const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

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

// ───── 저장값 호환: 옛 형식·닉네임판(2026-11-16, 되돌림) 형식 모두 읽힌다 ─────
{
  const own = { insurance: { i1: { score: 2, labeled_at: '2026-11-14T00:00:00.000Z' } } };
  const newFmt = {
    version: 1, labels: own, sessions: { insurance: { month: 'all', size: BATCH, cursor: 7 } }, channel: 'insurance',
    annotator: 'alice', keep: { insurance: ['i1'] },
    others: { bob: { insurance: { i1: { score: 0, labeled_at: '2026-11-16T09:00:00.000Z' }, i2: { score: 3, labeled_at: '2026-11-16T09:00:00.000Z' } } } },
  };
  const ns = parseStore(JSON.stringify(newFmt));
  assert.equal(ns.labels.insurance.i1.score, 2, '내 라벨은 다른 사람 라벨이 늦어도 그대로');
  assert.equal(ns.labels.insurance.i2.score, 3, '다른 사람 라벨은 내 라벨이 없는 기사에만 더함');
  assert.deepEqual(ns.sessions.insurance, { month: 'all', size: BATCH, cursor: 7 }, '진행 위치 유지');
  assert.deepEqual(Object.keys(ns).sort(), ['channel', 'labels', 'sessions', 'version'], 'annotator·keep·others 는 저장 형식에서 빠짐');
  // 닉네임판이 내보낸 파일(annotator 필드)도 가져올 수 있고, 내보내기는 옛 네 필드
  const imp = parseImport(JSON.stringify([{ channel: 'ai', id: 'z1', score: 1, labeled_at: '2026-11-16T01:00:00.000Z', annotator: 'alice' }]));
  assert.deepEqual(imp.rows, [{ channel: 'ai', id: 'z1', score: 1, labeled_at: '2026-11-16T01:00:00.000Z' }]);
  for (const r of toExport(mergeRows(ns, imp.rows).store)) assert.deepEqual(Object.keys(r), ['channel', 'id', 'score', 'labeled_at']);
}
// 사용자의 실제 라벨(보험 150·AI 89, scripts/audit/labels): 옛 형식·새 형식 저장값 모두 그대로 읽히고, 라벨을 매길 때의 기사 목록에서 보험 진행률 150/150
{
  const real = JSON.parse(readFileSync('scripts/audit/labels/labels-2026-11-15.json', 'utf8')) as { channel: string; id: string; score: 0 | 1 | 2 | 3; labeled_at: string }[];
  const old = mergeRows(emptyStore(), real).store;
  const asStored = { ...old, sessions: { insurance: { month: 'all', size: BATCH, cursor: BATCH }, ai: { month: 'all', size: BATCH, cursor: 89 } } };
  for (const raw of [asStored, { ...asStored, annotator: 'owner', keep: { insurance: Object.keys(old.labels.insurance) } }]) {
    const st2 = parseStore(JSON.stringify(raw));
    assert.equal(Object.keys(st2.labels.insurance).length, 150); assert.equal(Object.keys(st2.labels.ai).length, 89);
    assert.deepEqual(toExport(st2), toExport(old), '내보내기 내용도 같다');
    assert.deepEqual([st2.sessions.insurance.cursor, st2.sessions.ai.cursor], [BATCH, 89]);
    const lastAt = real.filter(r => r.channel === 'insurance').map(r => r.labeled_at).sort().at(-1)!;
    const arts = readdirSync('data/insurance').filter(f => /^\d{4}-\d{2}\.json$/.test(f))
      .flatMap(f => JSON.parse(readFileSync(join('data/insurance', f), 'utf8')) as { id: string; published_at: string; collected_at: string }[]);
    const then = arts.filter(x => x.collected_at <= lastAt);                       // 라벨을 매길 때 있던 기사
    const ids2 = sampleOrder(then, seedFor('insurance')).map(x => x.id);
    assert.deepEqual(summary(ids2, st2.labels.insurance).done, 150, '보험 150건 진행률 유지');
    assert.equal(firstUnlabeled(ids2, st2.labels.insurance), 150);
  }
}

// ───── 고정 표본(lib/label-fixed/<채널>.json): 목록 먼저, 그 뒤 해시 순 ─────
{
  const fx = pool.slice(0, 5).map(x => x.id).reverse();                        // 목록 순서 그대로 앞에
  const q1 = queueFor(pool, 'insurance', [...fx, 'gone-id-1'], 'all', 20).map(x => x.id);
  assert.deepEqual(q1.slice(0, 5), fx, '고정 목록이 먼저, 목록 순서대로');
  assert.equal(q1.length, 20, '없어진 id 는 건너뛰고 나머지를 해시 순으로 채움');
  assert.ok(!q1.includes('gone-id-1'));
  const restOrder = sampleOrder(pool.filter(x => !fx.includes(x.id)), seedFor('insurance'), 'all', 15).map(x => x.id);
  assert.deepEqual(q1.slice(5), restOrder, '뒤는 목록에 없는 기사의 기존 해시 순');
  assert.equal(new Set(q1).size, 20, '목록 기사는 뒤에서 다시 나오지 않음');
  assert.deepEqual(queueFor(pool, 'insurance', [], 'all', BATCH).map(x => x.id), a, '목록이 비면 예전 표본과 같다');
  const big = pool.slice(0, 160).map(x => x.id);
  assert.equal(queueFor(pool, 'insurance', big, 'all', BATCH).length, 160, '목록이 size 보다 길면 목록 전체');
  assert.deepEqual(queueFor(pool, 'insurance', big, 'all', 2 * BATCH).slice(0, 160).map(x => x.id), big, '표본 더 뽑기는 목록 뒤에 이어 붙음');
  const octIds = new Set(pool.filter(x => x.published_at.startsWith('2026-10')).map(x => x.id));
  const fxMix = [pool[0].id, [...octIds][0]];
  assert.deepEqual(queueFor(pool, 'insurance', fxMix, '2026-10', 3).map(x => x.id)[0], [...octIds][0], '기간을 고르면 목록에서도 그 달 기사만');
}
// 고정 목록 파일: 기사 id 만, 채널별 건수, 사용자 라벨과의 관계
{
  const real = JSON.parse(readFileSync('scripts/audit/labels/labels-2026-11-15.json', 'utf8')) as { channel: string; id: string; score: 0 | 1 | 2 | 3; labeled_at: string }[];
  const lists: Record<string, string[]> = {};
  for (const ch of ['insurance', 'ai', 'finance']) {
    const raw = readFileSync(`lib/label-fixed/${ch}.json`, 'utf8');
    const ids = JSON.parse(raw);
    assert.ok(Array.isArray(ids) && ids.every((x: unknown) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)), `${ch}: 기사 id 문자열만`);
    assert.equal(new Set(ids).size, ids.length, `${ch}: 중복 없음`);
    lists[ch] = ids;
  }
  assert.deepEqual([lists.insurance.length, lists.ai.length, lists.finance.length], [150, 100, 100]);
  const lab = (ch: string) => real.filter(r => r.channel === ch).map(r => r.id);
  assert.deepEqual([...lists.insurance].sort(), lab('insurance').sort(), '보험 = 사용자가 매긴 150건');
  assert.ok(lab('ai').every(id => lists.ai.includes(id)), 'AI 는 매긴 89건을 모두 포함');
  // 지금 데이터로 화면 표본을 만들면: 보험 150/150(새 기사가 끼어들지 않음), AI 89/100 다음부터
  const st = mergeRows(emptyStore(), real).store;
  const arts = (ch: string) => readdirSync(`data/${ch}`).filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .flatMap(f => JSON.parse(readFileSync(join(`data/${ch}`, f), 'utf8')) as { id: string; published_at: string }[]);
  const qi = queueFor(arts('insurance'), 'insurance', lists.insurance).map(x => x.id);
  assert.deepEqual(qi, lists.insurance.filter(id => qi.includes(id)), '보험 표본 = 고정 목록');
  assert.deepEqual([summary(qi, st.labels.insurance).done, qi.length], [150, 150], '보험 150/150');
  assert.equal(firstUnlabeled(qi, st.labels.insurance), 150, '보험은 끝까지 매긴 상태');
  const qa2 = queueFor(arts('ai'), 'ai', lists.ai).map(x => x.id);
  assert.equal(summary(qa2.slice(0, 100), st.labels.ai).done, 89, 'AI 고정 100건 중 매긴 89건');
  // 저장된 진행 위치·라벨은 저장값에서 그대로
  const kept = parseStore(JSON.stringify({ ...st, sessions: { insurance: { month: 'all', size: BATCH, cursor: BATCH }, ai: { month: 'all', size: BATCH, cursor: 89 } } }));
  assert.deepEqual([kept.sessions.insurance.cursor, kept.sessions.ai.cursor, Object.keys(kept.labels.insurance).length], [BATCH, 89, 150]);
  // 화면은 고정 목록 표본을 쓰고, 목록을 다시 만드는 스크립트는 두지 않는다
  const toolSrc = readFileSync('components/LabelTool.tsx', 'utf8');
  assert.ok(toolSrc.includes('queueFor(all, channel, LABEL_FIXED[channel]') && !toolSrc.includes('sampleOrder('));
  const scripts = walk('scripts').filter(f => /\.(m?[jt]s|py|sh)$/.test(f) && readFileSync(f, 'utf8').includes('label-fixed'));
  assert.deepEqual(scripts, [], '고정 목록 갱신 스크립트 없음');
}

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
const linking = [...walk('app'), ...walk('components'), ...walk('lib')].filter(f => /\.(tsx?|css)$/.test(f) && f !== join('app', 'label', 'page.tsx'))
  .filter(f => /['"`]\/label\b/.test(readFileSync(f, 'utf8')));
assert.deepEqual(linking, [], '/label/ 은 어디에도 링크하지 않음');
console.log('label tests passed');
