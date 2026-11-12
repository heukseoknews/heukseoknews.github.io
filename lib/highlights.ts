import { addDays, kstDate } from './dates.ts';
import type { Article } from './news.ts';
import { isRelevant } from './news.ts';
import { isLead } from './clusters.ts';
import { stars } from './stars.ts';

/** 최근 7일(관련도 낮은 기사 제외)(오늘 포함, 발행일 KST) 중 중요도(★, lib/stars.ts) 높은 순, 동점이면 매체 수 → 최신순.
 *  같은 사건 묶음은 대표 기사 하나만(사건 단위). 묶음이 없는 채널은 이전과 같다. */
export function weeklyHighlights(articles: Article[], today: string, limit = 20, category = '전체'): Article[] {
  const from = addDays(today, -6);
  return articles
    .filter(a => isRelevant(a) && isLead(a))
    .filter(a => { const d = kstDate(a.published_at); return d >= from && d <= today && (category === '전체' || a.category === category); })
    .sort((a, b) => stars(b) - stars(a) || (b.cluster_sources ?? 1) - (a.cluster_sources ?? 1) || b.published_at.localeCompare(a.published_at))
    .slice(0, limit);
}
