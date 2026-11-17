/** 로컬 LLM 점수 파일(data/<채널>/llm/<YYYY-MM>.json, docs/data-contract.md 3절)을 화면 ★에 섞기 위한 순수 로직.
 *  - 채널 channel.json 의 llm.w 가 0 이하이거나 없으면 끈 상태(킬 스위치): 파일을 불러오지 않고 기사도 그대로 둔다.
 *  - 기사 하나에 기록이 여러 개면 channel.json 의 llm.prompt_version 과 같은 기록 중 scored_at 이 가장 늦은 것의 score_ev 를 쓴다.
 *  - 점수가 없는 기사·파일을 못 불러온 달은 기존 ★ 그대로(lib/stars.ts).
 *  라벨 페이지(/label/)는 이 모듈을 쓰지 않는다(tests/llm-blend.test.ts). */
import type { LlmFields } from './stars.ts';

export type LlmSettings = { w: number; promptVersion: string };

/** 이번 주 핵심(최근 7일 상위 20)에도 섞을지. 2026-11-17 임시로 false: 점수가 최근 3일치뿐이라 점수 있는 기사(후하게 채점)가
 *  점수 없는 기사를 밀어내 선정이 크게 바뀌었다(겹침 보험 9/20·AI 14/20·금융 6/20). 7일 범위가 채점되면 true 로 바꾼다(docs/llm-scoring.md 9절). */
export const WEEKLY_USES_LLM = false;
type MetaLike = { llm?: { w?: unknown; prompt_version?: unknown } };

/** channel.json 의 llm 설정. w 가 (0, 1] 이 아니거나 prompt_version 이 없으면 null(끔) */
export function llmSettings(meta: MetaLike): LlmSettings | null {
  const w = meta.llm?.w, pv = meta.llm?.prompt_version;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || typeof pv !== 'string' || !pv) return null;
  return { w: Math.min(1, w), promptVersion: pv };
}

type Rec = { score_ev?: unknown; prompt_version?: unknown; scored_at?: unknown };

/** 기록 목록 → 이 prompt_version 의 가장 늦은 기록의 score_ev(0~5). 없거나 잘못되면 undefined */
export function pickEv(recs: unknown, promptVersion: string): number | undefined {
  if (!Array.isArray(recs)) return undefined;
  let best: Rec | null = null, bestT = -Infinity;
  for (const r of recs as Rec[]) {
    if (!r || typeof r !== 'object' || r.prompt_version !== promptVersion) continue;
    const t = typeof r.scored_at === 'string' ? Date.parse(r.scored_at) : NaN;
    const tt = Number.isFinite(t) ? t : -Infinity;
    if (best === null || tt > bestT) { best = r; bestT = tt; }
  }
  const ev = best?.score_ev;
  return typeof ev === 'number' && Number.isFinite(ev) && ev >= 0 && ev <= 5 ? ev : undefined;
}

/** 점수 파일 내용 → 기사 id → 기대값 */
export function evMapOf(file: unknown, promptVersion: string): Map<string, number> {
  const m = new Map<string, number>();
  if (!file || typeof file !== 'object' || Array.isArray(file)) return m;
  for (const [id, recs] of Object.entries(file as Record<string, unknown>)) {
    const ev = pickEv(recs, promptVersion);
    if (ev !== undefined) m.set(id, ev);
  }
  return m;
}

/** 기사에 llm_ev·llm_w 를 붙인 새 배열. w ≤ 0 이거나 점수가 하나도 없으면 같은 배열을 그대로 돌려준다(지금과 완전히 같음). */
export function withLlm<T extends { id: string }>(articles: T[], evs: Map<string, number>, w: number): (T & LlmFields)[] {
  if (!(w > 0) || evs.size === 0) return articles;
  let changed = false;
  const out = articles.map(a => {
    const ev = evs.get(a.id);
    if (ev === undefined) return a;
    changed = true;
    return { ...a, llm_ev: ev, llm_w: Math.min(1, w) };
  });
  return changed ? out : articles;
}

/** 불러올 점수 파일의 달: 끈 상태면 없음. 기사로 불러온 달 중 아직 시도하지 않은 달 */
export const monthsToFetch = (settings: LlmSettings | null, months: string[], tried: Set<string>): string[] =>
  settings ? months.filter(m => /^\d{4}-\d{2}$/.test(m) && !tried.has(m)) : [];

/** 한 달 점수 파일. 없거나(404) 실패하거나 형식이 틀리면 조용히 빈 Map(기존 ★로 폴백) */
export async function fetchLlmMonth(channel: string, month: string, promptVersion: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<Map<string, number>> {
  try {
    const res = await fetchImpl(`/data/${channel}/llm/${month}.json`, { cache: 'no-store' });
    if (!res.ok) return new Map();
    return evMapOf(await res.json(), promptVersion);
  } catch {
    return new Map();
  }
}
