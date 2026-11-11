'use client';
import { useEffect, useState } from 'react';
import { Status, loadStatus } from './news';

// 헤더 배지·지연 배너·푸터가 같은 파일을 한 번만 읽도록 모듈 단위로 캐시한다(status 는 채널별).
const statusP = new Map<string, Promise<Status | null>>();
const getStatus = (channel: string) => {
  let p = statusP.get(channel);
  if (!p) { p = loadStatus(channel).catch(() => null); statusP.set(channel, p); }
  return p;
};

/** 채널의 마지막 수집 완료 시각(status.json last_run.finished_at). 로딩 중·읽기 실패 시 null. */
export function useLastCollected(channel: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { getStatus(channel).then(s => setV(s?.last_run.finished_at ?? null)); }, [channel]);
  return v;
}
