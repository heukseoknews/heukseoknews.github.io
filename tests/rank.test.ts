import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterIndex, collapse, single } from '../lib/clusters.ts';
import { DEFAULT_HALF_LIFE_H, defaultSort, importance, latestItems, newestMs, parseSortPrefs, rankItems, rankReference, rankScore, sortFor } from '../lib/rank.ts';
import type { Article } from '../lib/news.ts';

const H = 3_600_000;
const NOW = Date.parse('2026-11-16T03:00:00Z');                 // 한국 시각 11-16 12:00
const ago = (h: number) => new Date(NOW - h * H).toISOString();
const art = (id: string, x: Partial<Article> = {}): Article => ({ id, title: id, url: `https://x/${id}`, source: '연합뉴스', source_type: 'media', published_at: ago(0), collected_at: ago(0), category: '손해보험', tags: [], score: 3, feed_name: '', companies: [], orgs: [], ...x });
const order = (rows: Article[], refMs = NOW, halfLifeH = 36) => rankItems(collapse(rows, clusterIndex(rows)), { refMs, halfLifeH }).map(i => i.lead.id);

// ---------- 중요도: ★(score_v2 우선) + 매체 수 보정(★ 한 단계 이내) ----------
assert.equal(importance({ score: 2, score_v2: 4 }), 4);
assert.equal(importance({ score: 3 }), 3);                               // score_v2 없는 채널(금융)
assert.equal(importance({ score: 3, score_v2: 3 }, 2), 3.25);
assert.equal(importance({ score: 3, score_v2: 3 }, 16), 4);
assert.equal(importance({ score: 3, score_v2: 3 }, 200), 4);             // 상한 +1
assert.ok(Number.isNaN(importance({} as Article)));                      // 점수 없음

// ---------- 감쇠 단조성·반감기 ----------
let prev = Infinity;
for (let h = 0; h <= 240; h += 6) { const s = rankScore(4, h, 36); assert.ok(s < prev, `${h}h`); prev = s; }
assert.equal(rankScore(4, 36, 36), 2);                                   // 반감기에 절반
assert.equal(rankScore(4, -5, 36), 4);                                   // 미래 시각(음수 나이)은 0
assert.equal(rankScore(4, 36, 0), rankScore(4, 36, DEFAULT_HALF_LIFE_H)); // 잘못된 반감기는 기본값
// 같은 중요도면 최근 기사가 위, 오래된 높은 ★은 새 낮은 ★에 밀린다(★4·72h = 1 < ★2·0h = 2)
assert.deepEqual(order([art('old', { score_v2: 3, published_at: ago(30) }), art('new', { score_v2: 3, published_at: ago(1) })]), ['new', 'old']);
assert.deepEqual(order([art('old4', { score_v2: 4, published_at: ago(72) }), art('new2', { score_v2: 2, published_at: ago(0) })]), ['new2', 'old4']);
assert.deepEqual(order([art('hi', { score_v2: 5, published_at: ago(6) }), art('lo', { score_v2: 2, published_at: ago(1) })]), ['hi', 'lo']);

// ---------- 동점: 최신 기사가 위, 그다음 id ----------
// ★4·36h(=2) 와 ★2·0h(=2) 는 점수가 같다 → 최근(0h)이 위
assert.deepEqual(order([art('a4', { score_v2: 4, published_at: ago(36) }), art('b2', { score_v2: 2, published_at: ago(0) })]), ['b2', 'a4']);
assert.deepEqual(order([art('y', { score_v2: 3, published_at: ago(2) }), art('x', { score_v2: 3, published_at: ago(2) })]), ['x', 'y']);

// ---------- 점수 없는 기사는 맨 아래(가장 최신이어도), 그 안에서는 최신순 ----------
const noScore = (id: string, h: number) => ({ ...art(id, { published_at: ago(h) }), score: undefined, score_v2: undefined }) as unknown as Article;
assert.deepEqual(order([noScore('n1', 0), art('s', { score_v2: 2, published_at: ago(200) }), noScore('n2', 0.5)]), ['s', 'n1', 'n2']);

// ---------- 묶음: 대표 기사 ★·매체 수, 나이는 묶음에서 가장 최근 기사 ----------
const lead = art('lead', { score_v2: 3, published_at: ago(48), cluster_id: 'c', cluster_lead: true, cluster_sources: 4 });
const late = art('late', { score_v2: 2, published_at: ago(1), cluster_id: 'c' });
const solo = art('solo', { score_v2: 3, published_at: ago(10) });
const items = collapse([lead, late, solo], clusterIndex([lead, late, solo]));
assert.equal(newestMs(items.find(i => i.clusterId === 'c')!), Date.parse(late.published_at));
assert.deepEqual(rankItems(items, { refMs: NOW, halfLifeH: 36 }).map(i => i.lead.id), ['lead', 'solo']);  // 3.5·2^(−1/36) > 3·2^(−10/36)
assert.deepEqual(latestItems(items).map(i => i.lead.id), ['solo', 'lead']);                               // 최신순은 대표 발행 시각
assert.deepEqual(rankItems(single([solo]), { refMs: NOW, halfLifeH: 36 }).map(i => i.lead.id), ['solo']);  // 북마크(묶지 않음)도 동작

// ---------- 기간 선택: 오늘 전에 끝나는 기간이면 기간 끝(그날 24:00 KST) 기준 ----------
assert.equal(rankReference(null, NOW, '2026-11-16'), NOW);
assert.equal(rankReference({ from: '2026-11-10', to: '2026-11-16' }, NOW, '2026-11-16'), NOW);           // 오늘까지 → 지금
assert.equal(rankReference({ from: '2026-11-10', to: '2026-11-12' }, NOW, '2026-11-16'), Date.parse('2026-11-12T15:00:00Z'));
// 11-12 하루를 고르면 그날 저녁 기사(★3)가 그날 아침 기사(★3)보다 위, 지금 기준처럼 나이가 4일씩 붙지 않는다
const ref = rankReference({ from: '2026-11-12', to: '2026-11-12' }, NOW, '2026-11-16');
const morning = art('am', { score_v2: 3, published_at: '2026-11-12T00:00:00Z' }), evening = art('pm', { score_v2: 3, published_at: '2026-11-12T12:00:00Z' });
assert.deepEqual(order([morning, evening], ref), ['pm', 'am']);
const top = rankItems(collapse([evening], clusterIndex([evening])), { refMs: ref, halfLifeH: 36 });
assert.ok(rankScore(importance(evening), (ref - Date.parse(evening.published_at)) / H, 36) > 2.7 && top.length === 1);  // 3시간 나이만큼만 감쇠

// ---------- 기본 정렬·저장 ----------
assert.equal(defaultSort('new'), 'rank');
for (const t of ['all', 'press', 'bookmarks'] as const) assert.equal(defaultSort(t), 'latest');
assert.deepEqual(parseSortPrefs(null), {});
assert.deepEqual(parseSortPrefs('{bad'), {});
assert.deepEqual(parseSortPrefs('{"new":"latest","all":"rank","press":"x","foo":"rank"}'), { new: 'latest', all: 'rank' });
assert.equal(sortFor({ all: 'rank' }, 'all'), 'rank');
assert.equal(sortFor({ all: 'rank' }, 'new'), 'rank');
assert.equal(sortFor({ new: 'latest' }, 'new'), 'latest');
assert.equal(sortFor({}, 'press'), 'latest');

// ---------- 반감기: 채널 channel.json 한 곳 ----------
const hl = (d: string) => JSON.parse(readFileSync(`channels/${d}/channel.json`, 'utf8')).rank_half_life_hours;
assert.deepEqual({ ai: hl('ai'), insurance: hl('insurance'), finance: hl('finance') }, { ai: 36, insurance: 48, finance: 36 });
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(page.includes('ch.rank_half_life_hours ?? DEFAULT_HALF_LIFE_H') && !/halfLifeH:\s*\d/.test(page), '반감기는 채널 설정에서만');
// 새 뉴스 판단·치우기는 정렬과 무관(정렬은 items 단계에서만)
assert.ok(page.includes('visibleInNewTab(a, { baseline, dismissed: dismissedSet, includeDismissed, leaving })'));
console.log('rank tests passed');
