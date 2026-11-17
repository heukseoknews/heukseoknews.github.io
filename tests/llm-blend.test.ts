import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLEND_NOTE, baseStars, blendStars, isBlended, stars } from '../lib/stars.ts';
import { WEEKLY_USES_LLM, evMapOf, fetchLlmMonth, llmSettings, monthsToFetch, pickEv, withLlm } from '../lib/llmScore.ts';
import { clusterIndex, collapse } from '../lib/clusters.ts';
import { importance, rankItems } from '../lib/rank.ts';
import { weeklyHighlights } from '../lib/highlights.ts';
import { snapshotOf } from '../lib/bookmarks.ts';
import type { Article } from '../lib/news.ts';

// ───── 블렌드 공식: 1 + 4 × (w × EV/5 + (1−w) × (★−1)/4), 1~5, 소수 한 자리 ─────
assert.equal(blendStars(3, 4, 0.5), 3.6);            // 1 + 4 × (0.4 + 0.25)
assert.equal(blendStars(4, 2.5, 0.8), 3.2);          // 1 + 4 × (0.4 + 0.15)
assert.equal(blendStars(2, 3.284, 0.3), 2.5);        // 1 + 4 × (0.19704 + 0.175) = 2.488 → 2.5
assert.equal(blendStars(5, 5, 1), 5);
assert.equal(blendStars(1, 0, 1), 1);
assert.equal(blendStars(4, 0, 0), 4, 'w=0 이면 기존 ★');
for (const b of [1, 2, 3, 4, 5]) for (const ev of [0, 1.7, 5]) for (const w of [0, 0.3, 1]) {
  const v = blendStars(b, ev, w);
  assert.ok(v >= 1 && v <= 5 && Math.round(v * 10) === v * 10, `${b},${ev},${w} → ${v}`);
}

// ───── stars(): 섞이지 않으면 지금과 같은 정수 ★ ─────
const base = { score: 2, score_v2: 4 };
assert.equal(stars(base), 4);
assert.equal(stars({ ...base, llm_ev: 5, llm_w: 0 }), 4, 'w=0');
assert.equal(stars({ ...base, llm_w: 0.5 }), 4, '기대값 없음');
assert.equal(stars({ ...base, llm_ev: Number.NaN, llm_w: 0.5 }), 4);
assert.equal(stars({ ...base, llm_ev: 6, llm_w: 0.5 }), 4, '범위 밖 기대값');
assert.equal(stars({ ...base, llm_ev: 1, llm_w: 0.5 }), blendStars(4, 1, 0.5));
assert.equal(stars({ score: 3, llm_ev: 4, llm_w: 0.5 }), 3.6, 'score_v2 없으면 score 기준');
for (const score of [0, 1, 2, 3, 4, 5]) for (const v2 of [undefined, 1, 2, 3, 4, 5])
  assert.equal(stars({ score, score_v2: v2 }), baseStars({ score, score_v2: v2 }));
assert.equal(isBlended({ llm_ev: 3, llm_w: 0.5 }), true);
assert.equal(isBlended({ llm_ev: 3 }), false);
assert.equal(BLEND_NOTE, '키워드·매체 수와 AI 추정 점수를 섞은 값');

// ───── 설정(킬 스위치): channel.json llm.w 0·없음·잘못된 값이면 끔 ─────
for (const m of [{}, { llm: {} }, { llm: { w: 0, prompt_version: 'v' } }, { llm: { w: -1, prompt_version: 'v' } }, { llm: { w: '0.5', prompt_version: 'v' } },
  { llm: { w: Number.NaN, prompt_version: 'v' } }, { llm: { w: 0.5 } }, { llm: { w: 0.5, prompt_version: '' } }])
  assert.equal(llmSettings(m as never), null, JSON.stringify(m));
assert.deepEqual(llmSettings({ llm: { w: 0.5, prompt_version: 'v1' } }), { w: 0.5, promptVersion: 'v1' });
assert.deepEqual(llmSettings({ llm: { w: 2, prompt_version: 'v1' } }), { w: 1, promptVersion: 'v1' });
assert.deepEqual(monthsToFetch(null, ['2026-11', '2026-10'], new Set()), [], '끄면 점수 파일을 하나도 불러오지 않음');
assert.deepEqual(monthsToFetch({ w: 0.5, promptVersion: 'v' }, ['2026-11', '2026-10', 'x'], new Set(['2026-10'])), ['2026-11']);
// 채널별 w 는 channel.json 한 곳, prompt_version 은 점수 스크립트 설정과 같아야 한다
for (const [ch, w] of [['insurance', 0.5], ['ai', 0.8], ['finance', 0.3]] as const) {
  const meta = JSON.parse(readFileSync(`channels/${ch}/channel.json`, 'utf8'));
  const prompt = JSON.parse(readFileSync(`scripts/local/prompts/${ch}.json`, 'utf8'));
  assert.equal(meta.llm.w, w, ch);
  assert.equal(meta.llm.prompt_version, prompt.prompt_version, `${ch}: prompt_version 일치`);
}

// ───── 기록 고르기: 같은 prompt_version 중 scored_at 가장 늦은 것 ─────
const rec = (pv: string, at: string, ev?: number) => ({ model: 'm', prompt_version: pv, scored_at: at, score_int: 3, ...(ev === undefined ? {} : { score_ev: ev }) });
assert.equal(pickEv([rec('v1', '2026-11-17T01:00:00Z', 2), rec('v1', '2026-11-18T01:00:00Z', 4), rec('v2', '2026-11-19T01:00:00Z', 5)], 'v1'), 4);
assert.equal(pickEv([rec('v2', '2026-11-19T01:00:00Z', 5)], 'v1'), undefined, '다른 버전만 있음');
assert.equal(pickEv([rec('v1', '2026-11-17T01:00:00Z', 2), rec('v1', '2026-11-18T01:00:00Z')], 'v1'), undefined, '가장 늦은 기록에 기대값 없음 → 기존 ★');
assert.equal(pickEv([rec('v1', '2026-11-17T01:00:00Z', 7)], 'v1'), undefined);
assert.equal(pickEv('x', 'v1'), undefined);
const file = { a: [rec('v1', '2026-11-17T01:00:00Z', 3.284)], b: [rec('v0', '2026-11-17T01:00:00Z', 1)], c: 'bad' };
assert.deepEqual([...evMapOf(file, 'v1')], [['a', 3.284]]);
for (const bad of [null, [], 'x', 3]) assert.equal(evMapOf(bad, 'v1').size, 0);

// ───── 폴백: 점수 파일이 없거나 실패·형식 오류면 조용히 빈 값 ─────
const res = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body }) as Response;
const urls: string[] = [];
assert.equal((await fetchLlmMonth('insurance', '2026-11', 'v1', async u => { urls.push(u); return res(404, null); })).size, 0);
assert.equal((await fetchLlmMonth('insurance', '2026-11', 'v1', async () => { throw new Error('offline'); })).size, 0);
assert.equal((await fetchLlmMonth('insurance', '2026-11', 'v1', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) as unknown as Response)).size, 0);
assert.equal((await fetchLlmMonth('insurance', '2026-11', 'v1', async () => res(200, file))).get('a'), 3.284);
assert.equal(urls[0], '/data/insurance/llm/2026-11.json');

// ───── withLlm: 끄거나 점수가 없으면 같은 배열(지금과 완전히 같음), 원본은 바꾸지 않음 ─────
const H = 3_600_000, NOW = Date.parse('2026-11-17T03:00:00Z');
const ago = (h: number) => new Date(NOW - h * H).toISOString();
const art = (id: string, x: Partial<Article> = {}): Article => ({ id, title: id, url: `https://x/${id}`, source: 's', source_type: 'media', published_at: ago(0), collected_at: ago(0), category: '손해보험', tags: [], score: 3, feed_name: '', companies: [], orgs: [], ...x });
const rows: Article[] = [
  art('a', { score_v2: 4, published_at: ago(5) }), art('b', { score_v2: 3, published_at: ago(1) }), art('c', { score_v2: 2, published_at: ago(2) }),
  art('d', { score_v2: 5, published_at: ago(30), cluster_id: 'd', cluster_lead: true, cluster_sources: 4, cluster_size: 4 }), art('e', { score_v2: 3, published_at: ago(10) }),
];
const evs = new Map([['a', 0.5], ['b', 5], ['c', 4.9], ['e', 4]]);
assert.equal(withLlm(rows, evs, 0), rows, 'w=0');
assert.equal(withLlm(rows, new Map(), 0.5), rows, '점수 없음');
assert.equal(withLlm(rows, new Map([['zz', 3]]), 0.5), rows, '맞는 기사 없음');
const mixed = withLlm(rows, evs, 0.5);
assert.notEqual(mixed, rows);
assert.equal(rows[0].llm_ev, undefined, '원본 불변');
assert.equal(mixed.find(x => x.id === 'd'), rows[3], '점수 없는 기사는 그대로(기존 ★)');
assert.equal(stars(mixed[1]), blendStars(3, 5, 0.5));

// ───── 순위: w=0 이면 순서가 기존과 같음, 섞으면 importance = 최종 ★ + 매체 수 보정 ─────
const order = (xs: Article[]) => rankItems(collapse(xs, clusterIndex(xs)), { refMs: NOW, halfLifeH: 36 }).map(i => i.lead.id);
assert.deepEqual(order(withLlm(rows, evs, 0)), order(rows));
assert.deepEqual(weeklyHighlights(withLlm(rows, evs, 0), '2026-11-17').map(a => a.id), weeklyHighlights(rows, '2026-11-17').map(a => a.id));
assert.equal(importance({ score: 3, score_v2: 3, llm_ev: 4, llm_w: 0.5 }, 4), 3.6 + 0.5);
assert.equal(importance({ score: 3, score_v2: 3 }, 4), 3 + 0.5);
assert.notDeepEqual(order(mixed), order(rows), '섞으면 순서가 바뀔 수 있다(b·c 가 a 위로)');
assert.ok(order(mixed).indexOf('b') < order(mixed).indexOf('a'));

// ───── 북마크 스냅샷은 기존 정수 ★ 를 저장(동기화 형식 그대로). 북마크 탭은 화면에서 같은 점수를 다시 붙여 섞는다 ─────
assert.equal(snapshotOf({ ...rows[1], llm_ev: 5, llm_w: 1 })?.score, 3);

// ───── 화면 연결(소스) ─────
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(page.includes('llmSettings(ch)') && page.includes('useLlmScores(ch.slug, loaded, llm)') && page.includes('withLlm(rawAll, evs, llm?.w ?? 0)') && page.includes('withLlm(bookmarkRaw, evs, llm?.w ?? 0)'));
const week = readFileSync('app/[channel]/week/page.tsx', 'utf8');
assert.ok(week.includes('withLlm(rawAll, evs, llm?.w ?? 0)') && week.includes('WEEKLY_USES_LLM ? llmSettings(ch) : null'), '이번 주 핵심은 WEEKLY_USES_LLM 로 켜고 끈다');
assert.equal(WEEKLY_USES_LLM, false, '임시: 이번 주 핵심은 기존 ★(7일 범위 채점 뒤 켬)');
const hook = readFileSync('lib/useLlmScores.ts', 'utf8');
assert.ok(hook.includes('monthsToFetch(settings, months, tried.current)'), '끄면(null) 불러오지 않음');
const card = readFileSync('components/ArticleCard.tsx', 'utf8');
assert.ok(card.includes('const blended = isBlended(a)') && card.includes('{blended && tip && <span className="starNote"') && card.includes('title={BLEND_NOTE}'), '설명은 섞인 기사에만');
assert.ok(card.includes("s.toFixed(1)"), '섞은 ★은 소수 한 자리');

// ───── 라벨 페이지(/label/): LLM 점수·섞은 ★을 불러오거나 보여 주지 않는다(블라인드) ─────
for (const f of ['app/label/page.tsx', 'components/LabelTool.tsx', 'lib/label.ts', 'lib/labelFixed.ts', 'lib/useNews.ts', 'lib/news.ts']) {
  const src = readFileSync(f, 'utf8');
  assert.ok(!/useLlmScores|llmScore|withLlm|\/llm\//.test(src), `${f}: LLM 점수 사용 금지`);
}
const label = readFileSync('components/LabelTool.tsx', 'utf8');
assert.ok(!/from '\.\.\/lib\/stars'|stars\(|★|score_v2/.test(label), '라벨 화면은 ★을 보여 주지 않는다(지금과 같음)');
assert.ok(!readFileSync('lib/news.ts', 'utf8').includes('llm/'), '기사 로더는 점수 파일을 읽지 않음');
console.log('llm blend tests passed');
