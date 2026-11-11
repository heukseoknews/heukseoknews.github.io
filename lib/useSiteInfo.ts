'use client';
import { useEffect, useState } from 'react';
import { Status, loadStatus, loadVersion } from './news';
import type { VersionInfo } from './version';

// 헤더 배지·지연 배너·푸터가 같은 파일을 한 번만 읽도록 모듈 단위로 캐시한다.
let statusP: Promise<Status | null> | null = null;
let versionP: Promise<VersionInfo | null> | null = null;
const getStatus = () => (statusP ??= loadStatus().catch(() => null));
const getVersion = () => (versionP ??= loadVersion().catch(() => null));

/** 마지막 수집 완료 시각(status.json last_run.finished_at). 로딩 중·읽기 실패 시 null. */
export function useLastCollected(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { getStatus().then(s => setV(s?.last_run.finished_at ?? null)); }, []);
  return v;
}

export function useVersion(): VersionInfo | null {
  const [v, setV] = useState<VersionInfo | null>(null);
  useEffect(() => { getVersion().then(setV); }, []);
  return v;
}
