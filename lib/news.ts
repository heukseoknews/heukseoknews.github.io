export const UNCATEGORIZED = '미분류';

export type Article = {
  id: string; title: string; url: string; source: string; source_type: 'media' | 'press';
  published_at: string; collected_at: string; category: string; sub_categories?: string[]; tags: string[]; score: number; feed_name: string;
  companies?: string[];    // 제목에 나온 보험사(정식명, config/companies.json)
  orgs?: string[];         // 제목에 나온/공식 출처인 유관기관(config/orgs.json)
  relevant?: boolean;      // false = 관련도 낮음(수집은 하되 기본 화면에서 숨김). 없으면 true(예전 기사)
  department?: string;     // 게시판 담당부서(내부 메타)
};
export const isRelevant = (a: { relevant?: boolean }) => a.relevant !== false;
export type DataIndex = { updated_at: string | null; months: { month: string; count: number; bytes: number }[] };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/data/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export const loadIndex = () => getJson<DataIndex>('index.json');
export const loadMonth = (m: string) => getJson<Article[]>(`${m}.json`);

export function isSafeUrl(u: string) { return /^https?:\/\//i.test(u); }
export function isGoogleDiscovery(a: Article) { return /(^|\.)news\.google\.com\//.test(a.url.replace(/^https?:\/\//, '')); }

export type SourceStatus = {
  ok: boolean; last_run_at: string; last_success_at: string | null; consecutive_failures: number;
  entries: number; kept: number; skipped: Record<string, number>; error: string | null;
  filtered?: string[]; oldest?: string | null; newest?: string | null; at_limit?: boolean; gap_risk?: boolean;
  needs_split?: boolean; note?: string | null; kind?: 'rss' | 'search' | 'board';
};
export type Status = {
  last_run: { started_at: string; finished_at: string; candidates: number; added: number; failed: string[]; noted?: string[]; blocked?: Record<string, number> };
  sources: Record<string, SourceStatus>;
};
export const loadStatus = () => getJson<Status>('status.json');
export const loadTrends = () => getJson<import('./trends').Trends>('trends.json');
export const loadVersion = () => fetch(`${BASE}/version.json`, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`version.json HTTP ${r.status}`); return r.json() as Promise<import('./version').VersionInfo>; });
