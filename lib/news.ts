export const UNCATEGORIZED = '미분류';

export type Article = {
  id: string; title: string; url: string; source: string; source_type: 'media' | 'press';
  published_at: string; collected_at: string; category: string; sub_categories?: string[]; tags: string[]; score: number; feed_name: string;
  companies?: string[];    // 제목에 나온 보험사(정식명, channels/<채널>/companies.json)
  orgs?: string[];         // 제목에 나온/공식 출처인 유관기관(channels/<채널>/orgs.json)
  relevant?: boolean;      // false = 관련도 낮음(수집은 하되 기본 화면에서 숨김). 없으면 true(예전 기사)
  department?: string;     // 게시판 담당부서(내부 메타)
  // 기사 품질(선택, docs/data-contract.md 2장). 플래그가 꺼진 채널(금융 등)·백필 전 데이터에는 없다
  cluster_id?: string;     // 같은 사건 묶음 라벨(기사 id 로 해석하지 않음)
  cluster_size?: number;   // 묶음 기사 수(전체 월 합계, 없으면 1)
  cluster_sources?: number; // 묶음 매체 수(없으면 1)
  cluster_lead?: true;     // 묶음 대표(묶음당 1건)
  score_v2?: number;       // 중요도 v2(★1~5). 화면은 lib/stars.ts stars() 로 읽는다
};
export const isRelevant = (a: { relevant?: boolean }) => a.relevant !== false;
export type DataIndex = { updated_at: string | null; months: { month: string; count: number; bytes: number }[] };

/** 채널 데이터: /data/<채널>/<파일>. 사이트는 루트 주소(basePath 없음)에 배포된다. */
async function getJson<T>(channel: string, path: string): Promise<T> {
  const res = await fetch(`/data/${channel}/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
export const loadIndex = (channel: string) => getJson<DataIndex>(channel, 'index.json');
export const loadMonth = (channel: string, m: string) => getJson<Article[]>(channel, `${m}.json`);

export function isSafeUrl(u: string) { return /^https?:\/\//i.test(u); }

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
export const loadStatus = (channel: string) => getJson<Status>(channel, 'status.json');
export const loadTrends = (channel: string) => getJson<import('./trends').Trends>(channel, 'trends.json');
export const loadVersion = () => fetch('/version.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`version.json HTTP ${r.status}`); return r.json() as Promise<import('./version').VersionInfo>; });
