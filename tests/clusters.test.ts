import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterIndex, collapse, countLabel, isLead, single, sortItems } from '../lib/clusters.ts';
import { STAR_SOURCE, stars } from '../lib/stars.ts';
import { weeklyHighlights } from '../lib/highlights.ts';
import { snapshotOf, toArticle, addBookmark } from '../lib/bookmarks.ts';
import { EMPTY_STATE, fromStored, parseImport, toExportFile } from '../lib/userState.ts';
import type { Article } from '../lib/news.ts';

const T = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const art = (id: string, x: Partial<Article> = {}): Article => ({ id, title: `제목 ${id}`, url: `https://x/${id}`, source: '연합뉴스', source_type: 'media', published_at: T(10), collected_at: T(10), category: '손해보험', tags: [], score: 3, feed_name: '', companies: [], orgs: [], ...x });

// ---------- ★ 출처: score_v2 우선, 없으면 score. 롤백은 STAR_SOURCE 한 줄 ----------
assert.equal(STAR_SOURCE, 'score_v2');
assert.equal(stars(art('a', { score: 2, score_v2: 4 })), 4);
assert.equal(stars(art('a', { score: 3 })), 3);                       // 필드 없는 기사(금융 등)
assert.equal(stars(art('a', { score: 2, score_v2: 4 }), 'score'), 2);  // 롤백하면 기존 ★
assert.equal(stars(art('a', { score: 2, score_v2: 1 })), 1);           // 관련도 낮은 기사의 v2=1
assert.match(readFileSync('lib/stars.ts', 'utf8'), /^export const STAR_SOURCE: StarSource = 'score_v2';$/m, '롤백 상수는 한 줄');
// 화면 코드에서 a.score 를 직접 읽지 않는다(stars() 로만)
for (const f of ['components/ArticleCard.tsx', 'app/[channel]/page.tsx', 'lib/highlights.ts'])
  assert.ok(!/\b(a|b)\.score\b(?!_)/.test(readFileSync(f, 'utf8')), `${f}: ★은 stars() 로`);

// ---------- 필드 없는 기사: 묶이지 않고 그대로 ----------
const plain = [art('p1'), art('p2', { published_at: T(11) })];
assert.ok(plain.every(isLead));
const pi = collapse(plain, clusterIndex(plain));
assert.deepEqual(pi.map(i => [i.lead.id, i.others.length, i.size, i.sources, i.clusterId]), [['p1', 0, 1, 1, undefined], ['p2', 0, 1, 1, undefined]]);
assert.deepEqual(sortItems(pi, 'latest').map(i => i.lead.id), ['p2', 'p1']);

// ---------- 묶음: 대표 하나, 펼침은 불러온 같은 묶음, 건수는 데이터 값 ----------
const L = art('lead', { cluster_id: 'c1', cluster_lead: true, cluster_size: 4, cluster_sources: 3, score: 2, score_v2: 5, published_at: T(10, 1), source: '한국경제' });
const m1 = art('m1', { cluster_id: 'c1', cluster_size: 4, cluster_sources: 3, score_v2: 5, published_at: T(10, 3), source: '매일경제' });
const m2 = art('m2', { cluster_id: 'c1', cluster_size: 4, cluster_sources: 3, score_v2: 5, published_at: T(10, 2), source: '연합뉴스' });
const solo = art('solo', { published_at: T(10, 5), score: 4 });
const pool = [L, m1, m2, solo];
const idx = clusterIndex(pool);
assert.deepEqual([...idx.keys()], ['c1']);
let items = collapse(pool, idx);
assert.equal(items.length, 2);
const g = items.find(i => i.clusterId === 'c1')!;
assert.equal(g.lead.id, 'lead');
assert.deepEqual(g.others.map(a => a.id), ['m2', 'm1']);  // 발행 순
assert.equal(g.size, 4); assert.equal(g.sources, 3);       // 월 경계로 3건만 불러와도 표시는 데이터 값
assert.deepEqual([...g.matched].sort(), ['lead', 'm1', 'm2']);

// ---------- 필터: 묶음 안 기사 하나만 맞아도 묶음이 보이고, 맞은 기사를 구분 ----------
items = collapse([m1], idx);   // 예: 출처=매일경제 필터에 m1 만 맞음
assert.equal(items.length, 1);
assert.equal(items[0].lead.id, 'lead');                   // 카드는 대표
assert.deepEqual([...items[0].matched], ['m1']);         // 펼침에서 m1 만 '일치'
assert.equal(collapse([], idx).length, 0);

// 대표가 불러온 기사에 없으면(다른 월·탭 조건) ★ 높은 구성원이 임시 대표
const idx2 = clusterIndex([m1, m2, art('m3', { cluster_id: 'c1', score_v2: 2, published_at: T(10, 4) })]);
assert.equal(collapse([m2], idx2)[0].lead.id, 'm1');      // ★5 동점이면 최신(m1 03시 > m2 02시)

// ---------- 정렬: 대표 기준. 중요도순은 ★ → 매체 수 → 최신 ----------
const imp = sortItems(collapse(pool, idx), 'important');
assert.deepEqual(imp.map(i => i.lead.id), ['lead', 'solo']);  // 대표 v2=5 > solo 4
const tieA = art('ta', { score: 4, cluster_id: 'ca', cluster_lead: true, cluster_sources: 2, published_at: T(9) });
const tieB = art('tb', { score: 4, cluster_id: 'cb', cluster_lead: true, cluster_sources: 5, published_at: T(8) });
assert.deepEqual(sortItems(collapse([tieA, tieB], clusterIndex([tieA, tieB])), 'important').map(i => i.lead.id), ['tb', 'ta']);
assert.deepEqual(sortItems(collapse(pool, idx), 'latest').map(i => i.lead.id), ['solo', 'lead']);  // 대표 발행 시각 기준
assert.deepEqual(single(pool).map(i => i.lead.id), ['lead', 'm1', 'm2', 'solo']);  // 북마크 탭은 묶지 않음

// ---------- 이번 주 핵심: 사건 단위(대표만), ★ = stars ----------
const wk = weeklyHighlights(pool, '2026-11-12');
assert.deepEqual(wk.map(a => a.id), ['lead', 'solo']);

// ---------- 북마크 회귀: 기사 단위 스냅샷, ★은 화면과 같은 값, 스키마 v2 그대로 ----------
assert.equal(snapshotOf(m1)!.score, 5);                  // score_v2 반영
assert.equal(snapshotOf(art('f', { score: 3 }))!.score, 3);
assert.equal(snapshotOf(L)!.cluster_id, L.cluster_id);   // 묶음 번호는 참고로만 저장(기준 키는 기사 id, 2026-11-13)
for (const k of ['cluster_size', 'cluster_sources', 'cluster_lead']) assert.ok(!(k in snapshotOf(L)!), `${k}: 다른 묶음 필드는 넣지 않음`);
let st = addBookmark(EMPTY_STATE, m1, 'insurance', T(12));
st = addBookmark(st, m2, 'insurance', T(12));            // 같은 묶음의 다른 기사도 각각
assert.deepEqual(Object.keys(st.bookmarks).sort(), ['m1', 'm2']);
assert.equal(toArticle(st.bookmarks.m1 as any).score, 5);
const file = JSON.parse(JSON.stringify(toExportFile('insurance', st)));
assert.equal(file.schemaVersion, 2);
assert.deepEqual(Object.keys(parseImport(file, 'insurance').state.bookmarks).sort(), ['m1', 'm2']);
assert.equal(Object.keys(fromStored({ schemaVersion: 1, bookmarks: { m1 } }, 'insurance').bookmarks).length, 1);

// 목록 머리: 묶음이 있으면 '사건 N건 · 기사 M건', 없으면 'N건'
assert.equal(countLabel(721, 1561), '사건 721건 · 기사 1,561건');
assert.equal(countLabel(734, 734), '734건');
assert.ok(readFileSync('app/[channel]/page.tsx', 'utf8').includes('countLabel(items.length, rows.length)'));

console.log('clusters tests passed');
