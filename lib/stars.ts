/** 화면 ★(중요도) 출처. 카드·정렬·이번 주 핵심·북마크가 모두 stars() 하나로 읽는다.
 *  되돌리기: 아래 STAR_SOURCE 를 'score' 로 바꾸면 모든 화면이 기존 ★(score)로 돌아간다(데이터는 두 값을 모두 가진다).
 *  로컬 LLM 점수 섞기(docs/llm-scoring.md): 채널 channel.json 의 llm.w 가 0 보다 크고 기사에 LLM 기대값이 붙어 있으면(lib/llmScore.ts withLlm)
 *  최종 ★ = 1 + 4 × (w × EV/5 + (1−w) × (★−1)/4), 1~5, 소수 한 자리. 붙어 있지 않으면 지금까지와 같은 정수 ★. */
export type StarSource = 'score_v2' | 'score';
export const STAR_SOURCE: StarSource = 'score_v2';

/** 화면에서만 붙이는 값(데이터 파일에는 없다). llm_ev: 0~5 기대값, llm_w: 채널 가중치(0 초과일 때만 붙는다) */
export type LlmFields = { llm_ev?: number; llm_w?: number };
type Scored = { score: number; score_v2?: number } & LlmFields;

/** 기존 ★: score_v2 가 있으면 그 값, 없으면(금융 등 플래그가 꺼진 채널·되돌린 데이터) 기존 score. 1~5 정수로 자른다. */
export function baseStars(a: { score: number; score_v2?: number }, source: StarSource = STAR_SOURCE): number {
  const v = source === 'score_v2' && typeof a.score_v2 === 'number' ? a.score_v2 : a.score;
  return Math.max(1, Math.min(5, Math.round(v)));
}

/** 섞은 ★(1~5, 소수 한 자리). base: 기존 ★(1~5), ev: LLM 기대값(0~5), w: 0~1 */
export function blendStars(base: number, ev: number, w: number): number {
  const v = 1 + 4 * (w * (ev / 5) + (1 - w) * ((base - 1) / 4));
  return Math.round(Math.max(1, Math.min(5, v)) * 10) / 10;
}

/** 이 기사에 LLM 점수가 섞이는가(w > 0 이고 기대값이 있음) */
export const isBlended = (a: LlmFields): boolean =>
  typeof a.llm_w === 'number' && a.llm_w > 0 && a.llm_w <= 1 && typeof a.llm_ev === 'number' && Number.isFinite(a.llm_ev) && a.llm_ev >= 0 && a.llm_ev <= 5;

/** 화면 ★. 섞이지 않는 기사는 baseStars 와 같은 정수 */
export function stars(a: Scored, source: StarSource = STAR_SOURCE): number {
  const b = baseStars(a, source);
  return isBlended(a) ? blendStars(b, a.llm_ev as number, a.llm_w as number) : b;
}

/** 섞은 ★일 때 보여 줄 짧은 설명(섞이지 않으면 설명 없음) */
export const BLEND_NOTE = '키워드·매체 수와 AI 추정 점수를 섞은 값';
