/** 목록 정렬: 순위순(중요도 × 시간 감쇠) / 최신순. 순수 로직(화면은 app/[channel]/page.tsx).
 *
 *  순위 점수 = 중요도 × 2^(−나이(시간) / 반감기)
 *  - 중요도: ★(stars: score_v2, 없으면 score) + 매체 수 보정 min(1, 0.25·log2(매체 수)).
 *    score_v2 의 연속 값(★로 자르기 전 raw)은 데이터에 저장하지 않으므로 ★과 매체 수(cluster_sources)로 대신한다.
 *    보정은 같은 ★ 안에서 여러 매체가 다룬 사건을 위로 올리되 ★ 한 단계를 넘지 않는다(2곳 +0.25, 4곳 +0.5, 16곳 이상 +1).
 *  - 나이: 묶음에서 가장 최근 기사 시각부터 기준 시각까지. 기준 시각은 '지금', 단 달력으로 고른 기간이 오늘 전에 끝나면
 *    그 기간의 끝(마지막 날 24:00, 한국 시각) — 과거 기간도 그날 보던 것처럼 감쇠한다. 음수 나이는 0.
 *  - 반감기: 채널 channel.json 의 rank_half_life_hours(없으면 DEFAULT_HALF_LIFE_H).
 *  - 같은 점수면 최신(묶음 최근 시각)이 위, 그다음 id. 점수가 없는 기사(★ 값 없음)는 맨 아래(그 안에서 최신순). */
import type { Item } from './clusters.ts';
import type { Article } from './news.ts';
import type { TabId } from './channels.ts';
import { stars } from './stars.ts';
import { addDays } from './dates.ts';

export type SortMode = 'rank' | 'latest';
export const SORT_LABEL: Record<SortMode, string> = { rank: '순위순', latest: '최신순' };
export const DEFAULT_HALF_LIFE_H = 36;
/** 기본 정렬: 새 뉴스 탭은 순위순, 나머지는 최신순 */
export const defaultSort = (tab: TabId): SortMode => (tab === 'new' ? 'rank' : 'latest');

const HOUR = 3_600_000;
type Scored = Pick<Article, 'score' | 'score_v2'>;

/** 중요도(★ + 매체 수 보정). ★ 값이 없으면 NaN(점수 없음) */
export function importance(a: Scored, sources = 1): number {
  const has = (typeof a.score_v2 === 'number' && Number.isFinite(a.score_v2)) || (typeof a.score === 'number' && Number.isFinite(a.score));
  if (!has) return NaN;
  return stars(a as { score: number; score_v2?: number }) + Math.min(1, 0.25 * Math.log2(Math.max(1, sources)));
}

/** 순위 점수. importance 가 NaN 이면 NaN */
export const rankScore = (imp: number, ageHours: number, halfLifeH: number): number =>
  imp * 2 ** (-Math.max(0, ageHours) / (halfLifeH > 0 ? halfLifeH : DEFAULT_HALF_LIFE_H));

/** 나이 기준 시각(ms). range.to 가 오늘(한국 시각) 전이면 그 날의 끝, 아니면 now */
export function rankReference(range: { from: string; to: string } | null, nowMs: number, todayKst: string): number {
  if (range && range.to < todayKst) return Date.parse(`${addDays(range.to, 1)}T00:00:00+09:00`);
  return nowMs;
}

/** 묶음(대표 + 불러온 구성원)에서 가장 최근 발행 시각(ms) */
export const newestMs = (it: Item): number => Math.max(...[it.lead, ...it.others].map(a => Date.parse(a.published_at)));

export type RankOptions = { refMs: number; halfLifeH: number };
/** 순위순 정렬. 대표 기사의 ★·묶음 매체 수로 중요도, 묶음 최근 시각으로 나이를 잰다 */
export function rankItems(items: Item[], o: RankOptions): Item[] {
  const keyed = items.map(it => {
    const t = newestMs(it);
    const s = rankScore(importance(it.lead, it.sources), (o.refMs - t) / HOUR, o.halfLifeH);
    return { it, t, s: Number.isFinite(s) ? s : -Infinity };
  });
  keyed.sort((x, y) => (y.s - x.s) || (y.t - x.t) || x.it.lead.id.localeCompare(y.it.lead.id));
  return keyed.map(k => k.it);
}

/** 최신순: 대표 발행 시각(기존 sortItems 'latest' 와 같음) */
export const latestItems = (items: Item[]): Item[] =>
  [...items].sort((x, y) => y.lead.published_at.localeCompare(x.lead.published_at) || x.lead.id.localeCompare(y.lead.id));

// ───────── 브라우저 저장(탭별 선택, 이 브라우저에만) ─────────
export const SORT_KEY = 'heukseok-sort';
export type SortPrefs = Partial<Record<TabId, SortMode>>;
const TABS: TabId[] = ['new', 'all', 'press', 'bookmarks'];
export function parseSortPrefs(raw: string | null): SortPrefs {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: SortPrefs = {};
    for (const t of TABS) if (j && (j[t] === 'rank' || j[t] === 'latest')) out[t] = j[t] as SortMode;
    return out;
  } catch { return {}; }
}
export const sortFor = (prefs: SortPrefs, tab: TabId): SortMode => prefs[tab] ?? defaultSort(tab);
