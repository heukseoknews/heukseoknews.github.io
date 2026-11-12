/** 화면 ★(중요도) 출처. 카드·정렬·이번 주 핵심·북마크 스냅샷이 모두 stars() 하나로 읽는다.
 *  되돌리기: 아래 STAR_SOURCE 를 'score' 로 바꾸면 모든 화면이 기존 ★(score)로 돌아간다(데이터는 두 값을 모두 가진다). */
export type StarSource = 'score_v2' | 'score';
export const STAR_SOURCE: StarSource = 'score_v2';

type Scored = { score: number; score_v2?: number };

/** score_v2 가 있으면 그 값, 없으면(금융 등 플래그가 꺼진 채널·되돌린 데이터) 기존 score. 1~5 로 자른다. */
export function stars(a: Scored, source: StarSource = STAR_SOURCE): number {
  const v = source === 'score_v2' && typeof a.score_v2 === 'number' ? a.score_v2 : a.score;
  return Math.max(1, Math.min(5, Math.round(v)));
}
