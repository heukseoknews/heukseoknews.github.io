/** 같은 사건 묶음(docs/data-contract.md 2장)을 목록 카드로 묶는 순수 로직.
 *  - 카드는 대표 기사(`!cluster_id || cluster_lead`) 하나. 대표가 아직 안 불러온 월에 있으면 불러온 구성원 중 ★이 가장 높은 기사를 임시 대표로.
 *  - 필터·검색에 묶음 안 기사가 하나라도 맞으면 묶음 카드가 보이고, 맞은 기사 id 를 matched 로 넘긴다(펼침 안에서 구분).
 *  - 건수 표시는 데이터의 cluster_size·cluster_sources, 펼친 목록은 불러온 같은 cluster_id 기사만. */
import type { Article } from './news.ts';
import { stars } from './stars.ts';

export type Item = {
  /** 카드로 보일 기사(대표 또는 묶음이 없는 기사) */
  lead: Article;
  /** 묶음 라벨(없으면 혼자인 기사) */
  clusterId?: string;
  /** 불러온 같은 묶음 기사(대표 제외, 발행 순). 혼자인 기사는 빈 배열 */
  others: Article[];
  /** 필터·검색에 맞은 기사 id(대표 포함 가능) */
  matched: Set<string>;
  /** 표시 건수: 묶음 기사 수·매체 수(데이터 값, 없으면 1) */
  size: number;
  sources: number;
};

export const isLead = (a: Article) => !a.cluster_id || a.cluster_lead === true;

/** 같은 cluster_id 의 불러온 기사들 */
export function clusterIndex(pool: Article[]): Map<string, Article[]> {
  const m = new Map<string, Article[]>();
  for (const a of pool) if (a.cluster_id) { const l = m.get(a.cluster_id); if (l) l.push(a); else m.set(a.cluster_id, [a]); }
  return m;
}

const byStarsThenNew = (a: Article, b: Article) => stars(b) - stars(a) || b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id);

/** 걸러진 기사(rows)를 묶음 카드로. index 는 펼침·대표 찾기에 쓸 불러온 기사 묶음(탭·관련도 조건만 적용한 pool 로 만든다).
 *  순서는 정렬하지 않는다(sortItems). */
export function collapse(rows: Article[], index: Map<string, Article[]>): Item[] {
  const out: Item[] = [];
  const seen = new Map<string, Item>();
  for (const a of rows) {
    const cid = a.cluster_id;
    if (!cid) { out.push({ lead: a, others: [], matched: new Set([a.id]), size: 1, sources: 1 }); continue; }
    const it = seen.get(cid);
    if (it) { it.matched.add(a.id); continue; }
    const members = index.get(cid) ?? [a];
    const lead = members.find(m => m.cluster_lead === true) ?? [...members].sort(byStarsThenNew)[0];
    const others = members.filter(m => m.id !== lead.id).sort((x, y) => x.published_at.localeCompare(y.published_at) || x.id.localeCompare(y.id));
    const item: Item = { lead, clusterId: cid, others, matched: new Set([a.id]), size: Math.max(lead.cluster_size ?? 1, members.length), sources: lead.cluster_sources ?? 1 };
    seen.set(cid, item);
    out.push(item);
  }
  return out;
}

/** 정렬: 대표 기사 기준. 최신순 = 대표 발행 최신. 중요도순 = ★ → 매체 수 → 최신(docs/data-contract.md 권장). */
export function sortItems(items: Item[], sort: 'latest' | 'important'): Item[] {
  return [...items].sort((x, y) => {
    const a = x.lead, b = y.lead;
    if (sort === 'important') return stars(b) - stars(a) || y.sources - x.sources || b.published_at.localeCompare(a.published_at);
    return b.published_at.localeCompare(a.published_at);
  });
}

/** 목록 머리 건수: 같은 사건 묶음으로 카드 수와 기사 수가 다르면 '사건 N건 · 기사 M건', 같으면 'N건'. */
export const countLabel = (cards: number, articles: number) =>
  cards === articles ? `${cards.toLocaleString()}건` : `사건 ${cards.toLocaleString()}건 · 기사 ${articles.toLocaleString()}건`;

/** 묶지 않고 기사 하나씩(북마크 탭 등) */
export const single = (rows: Article[]): Item[] => rows.map(a => ({ lead: a, others: [], matched: new Set([a.id]), size: 1, sources: 1 }));
