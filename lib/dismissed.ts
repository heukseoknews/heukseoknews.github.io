/** 새 뉴스 탭에서 '치운 기사' 기록: { id, at(치운 시각 ISO) } 의 단순 목록. 읽음(readAt, 링크를 연 기록)과 별개다.
 *  - 치운 기사는 새 뉴스 목록·건수에서 빠진다(읽기만 한 기사는 남는다). 북마크와도 서로 영향이 없다.
 *  - 기록은 채널별 사용자 상태(heukseok-v2:<채널>)의 dismissed 에 저장한다. 나중에 계정에 저장할 때도 이 목록 그대로 옮길 수 있다.
 *  - 정리: 60일 지난 항목 중 '마지막 확인' 이전에 치운 것은 지운다(그 기사는 이미 새 뉴스 범위 밖이라 다시 나타나지 않는다).
 *    마지막 확인 이후에 치운 기록은 기간이 지나도 남긴다(지우면 치운 기사가 새 뉴스에 되살아난다). 그래도 HARD 를 넘으면 오래된 것부터 지운다. */
import type { ReadMap } from './readState.ts';

export type Dismissed = { id: string; at: string }[];
export const KEEP_DAYS = 60;
export const DISMISS_HARD = 3000;
const DAY = 86_400_000;
const validIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** 저장된 값 정리: 형식이 맞는 항목만, 같은 id 는 늦은 시각 하나 */
export function cleanDismissed(raw: unknown): Dismissed {
  if (!Array.isArray(raw)) return [];
  const m = new Map<string, string>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const { id, at } = e as { id?: unknown; at?: unknown };
    if (typeof id !== 'string' || !id || !validIso(at)) continue;
    const prev = m.get(id);
    if (!prev || prev < at) m.set(id, at);
  }
  return [...m].map(([id, at]) => ({ id, at }));
}

/** 옛 동작(읽으면 새 뉴스에서 숨김)에서 이전: 그때 숨겨져 있던 기록 = 마지막 확인 이후에 읽은 것(확인 전이면 전부).
 *  확인 이전에 읽은 기사는 확인 이전에 수집된 것이라 새 뉴스 범위 밖이므로 옮길 필요가 없다. 치운 시각은 읽은 시각. */
export function fromReads(readAt: ReadMap, baseline: string | null): Dismissed {
  return Object.entries(readAt).filter(([, at]) => !baseline || at >= baseline).map(([id, at]) => ({ id, at }));
}

export function addDismissed(list: Dismissed, ids: string[], now: string): Dismissed {
  const add = ids.filter(id => !list.some(e => e.id === id));
  return add.length ? [...list, ...add.map(id => ({ id, at: now }))] : list;
}

export function removeDismissed(list: Dismissed, ids: string[]): Dismissed {
  const drop = new Set(ids);
  return list.some(e => drop.has(e.id)) ? list.filter(e => !drop.has(e.id)) : list;
}

export function pruneDismissed(list: Dismissed, now: string, baseline: string | null, days = KEEP_DAYS, hard = DISMISS_HARD): Dismissed {
  const cutoff = new Date(Date.parse(now) - days * DAY).toISOString();
  let out = list.filter(e => !(e.at < cutoff && baseline && e.at < baseline));
  if (out.length > hard) out = [...out].sort((a, b) => a.at.localeCompare(b.at)).slice(out.length - hard);
  return out.length === list.length ? list : out;
}

/** 두 기기·백업 병합: 합집합, 같은 기사는 늦은 시각 */
export const mergeDismissed = (a: Dismissed, b: Dismissed): Dismissed => cleanDismissed([...a, ...b]);
