'use client';
import { useEffect, useReducer, useState } from 'react';
import { AUTH_MODE } from '../lib/authConfig';
import { useSyncUser } from '../lib/useAccount';
import type { Manager, SyncState } from '../lib/syncManager';
import type { SyncFail } from '../lib/sync';

/** 동기화 상태 문구(한 줄). 실패해도 북마크는 이 기기에 저장돼 있다는 것만 쉽게 알린다 */
export const FAIL_TEXT: Record<SyncFail, string> = {
  network: '서버에 연결하지 못해 이 기기에만 저장했습니다. 연결되면 다시 보냅니다.',
  auth: '로그인이 끝나 이 기기에만 저장했습니다. 다시 로그인해 주세요.',
  limit: '저장 한도를 넘어 서버에 보내지 못했습니다. 북마크를 줄여 주세요.',
  other: '서버에 저장하지 못했습니다. 잠시 뒤 다시 보냅니다.',
};
const stamp = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function syncText(s: SyncState): string {
  if (s.state === 'syncing') return '동기화 중…';
  if (s.state === 'error') return FAIL_TEXT[s.fail ?? 'other'];
  return s.at ? `모든 기기에 저장됨 · ${stamp(s.at)}` : '';
}

/** 실행기(lib/syncManager.ts)를 처음 쓸 때 불러와 상태가 바뀌면 다시 그린다 */
function useManager(): Manager | null {
  const { uid } = useSyncUser(AUTH_MODE);
  const [m, setM] = useState<Manager | null>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!uid) { setM(null); return; }
    let off = false;
    import('../lib/syncManager').then(x => { if (!off) setM(x.syncFor(uid)); }).catch(() => {});
    return () => { off = true; };
  }, [uid]);
  useEffect(() => m?.subscribe(redraw), [m]);
  return m;
}

/** 마이페이지 제목 옆 작은 상태 줄(로그인 중에만) */
export default function SyncNote({ channel }: { channel: string }) {
  const m = useManager();
  if (!m) return null;
  const s = m.get(channel);
  const t = syncText(s);
  return t ? <p className={'syncNote' + (s.state === 'error' ? ' bad' : '')} role="status" aria-live="polite">{t}</p> : null;
}

/** 헤더 계정 버튼의 작은 점: 어느 채널이든 서버 저장이 실패하면(자리를 차지하지 않음) */
export function SyncDot() {
  const m = useManager();
  return m?.anyError() ? <span className="syncDot" role="img" aria-label="서버 저장 실패, 이 기기에는 저장됨" title="서버 저장 실패 — 이 기기에는 저장됨" /> : null;
}
