'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type LlmSettings, fetchLlmMonth, monthsToFetch } from './llmScore';

const EMPTY = new Map<string, number>();

/** 기사로 불러온 달(months)의 LLM 점수 파일을 같이 불러와 기사 id → 기대값으로 합친다.
 *  settings 가 null(channel.json llm.w 가 0·없음)이면 아무것도 불러오지 않는다(킬 스위치). 실패한 달은 조용히 빈 값(기존 ★).
 *  채널·라벨 페이지 공용 훅(useNews)과 분리돼 있어 라벨 페이지는 점수 파일을 불러오지 않는다. */
export function useLlmScores(channel: string, months: string[], settings: LlmSettings | null): Map<string, number> {
  const pv = settings?.promptVersion ?? '';
  const on = settings !== null;
  const [byMonth, setByMonth] = useState<Record<string, Map<string, number>>>({});
  const tried = useRef(new Set<string>());
  const gen = useRef(0);
  useEffect(() => { gen.current += 1; tried.current = new Set(); setByMonth({}); }, [channel, pv]);
  const key = months.join(',');
  useEffect(() => {
    const todo = monthsToFetch(settings, months, tried.current);
    const g = gen.current;
    for (const m of todo) {
      tried.current.add(m);
      fetchLlmMonth(channel, m, pv).then(map => { if (g === gen.current && map.size) setByMonth(p => ({ ...p, [m]: map })); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, pv, key, on]);
  return useMemo(() => {
    const maps = Object.values(byMonth);
    if (!on || !maps.length) return EMPTY;
    const out = new Map<string, number>();
    for (const m of maps) for (const [k, v] of m) out.set(k, v);
    return out;
  }, [byMonth, on]);
}
