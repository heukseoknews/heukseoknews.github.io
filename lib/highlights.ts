import { addDays, kstDate } from './dates.ts';
import type { Article } from './news.ts';
import { isRelevant } from './news.ts';

/** 최근 7일(관련도 낮은 기사 제외)(오늘 포함, 발행일 KST) 중 중요도(score) 높은 순, 동점이면 최신순. */
export function weeklyHighlights(articles: Article[], today: string, limit = 20, category = '전체'): Article[] {
  const from = addDays(today, -6);
  return articles
    .filter(a => isRelevant(a))
    .filter(a => { const d = kstDate(a.published_at); return d >= from && d <= today && (category === '전체' || a.category === category); })
    .sort((a, b) => b.score - a.score || b.published_at.localeCompare(a.published_at))
    .slice(0, limit);
}
