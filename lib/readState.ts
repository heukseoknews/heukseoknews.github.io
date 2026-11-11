/** 읽음 기록: id → 읽은 시각(ISO). 한도(SOFT) 초과 시 '마지막 확인 완료 이전에 읽은 것'부터 오래된 순으로 지운다.
 *  새 뉴스는 마지막 확인 이후에 수집된 기사만 대상이므로, 확인 이후에 읽은 기록은 보호해야 읽은 기사가 새 뉴스로 되돌아오지 않는다.
 *  (확인 이전에 읽은 기사는 확인 이전에 수집된 것이라 새 뉴스 범위 밖이다.) 보호된 기록이 HARD 를 넘으면 가장 오래된 것부터 지운다. */
export type ReadMap = Record<string, string>;
export const SOFT_LIMIT = 1500;
export const HARD_LIMIT = 5000;
const EPOCH = Date.UTC(1970, 0, 1);

/** 저장된 JSON 에서 읽음 맵을 꺼낸다. 예전 형식(readIds 배열)은 epoch+순번 시각으로 이전해 순서를 보존한다. */
export function migrateReads(raw: { readAt?: unknown; readIds?: unknown }): ReadMap {
  if (raw.readAt && typeof raw.readAt === 'object') return { ...(raw.readAt as ReadMap) };
  if (Array.isArray(raw.readIds)) {
    const out: ReadMap = {};
    raw.readIds.forEach((id, i) => { if (typeof id === 'string') out[id] = new Date(EPOCH + i).toISOString(); });
    return out;
  }
  return {};
}

export function addRead(map: ReadMap, id: string, now: string): ReadMap {
  return map[id] ? map : { ...map, [id]: now };
}

export function removeRead(map: ReadMap, id: string): ReadMap {
  if (!(id in map)) return map;
  const { [id]: _drop, ...rest } = map;
  return rest;
}

export function pruneReads(map: ReadMap, baseline: string | null, soft = SOFT_LIMIT, hard = HARD_LIMIT): ReadMap {
  const entries = Object.entries(map);
  if (entries.length <= soft) return map;
  entries.sort((a, b) => a[1].localeCompare(b[1]));
  let drop = entries.length - soft;
  const remove = new Set<string>();
  if (baseline) {  // 1) 확인 이전에 읽은 기록(새 뉴스와 무관)부터 오래된 순
    for (const [id, at] of entries) {
      if (drop <= 0 || at >= baseline) break;
      remove.add(id); drop--;
    }
  }
  const left = entries.length - remove.size;
  if (left > hard) {  // 2) 보호 대상이 HARD 를 넘으면 가장 오래된 것부터(저장 용량 상한)
    for (const [id] of entries) {
      if (entries.length - remove.size <= hard) break;
      remove.add(id);
    }
  }
  if (!remove.size) return map;
  return Object.fromEntries(entries.filter(([id]) => !remove.has(id)));
}
