'use client';
import { useEffect, useState } from 'react';
import { AUTH_MODE } from '../lib/authConfig';
import { browserKV } from '../lib/auth';
import { type ClaimItem, laterKey, promptText, shouldAsk } from '../lib/claim';
import { deviceItems, runClaim } from '../lib/claimRun';
import { useSyncUser } from '../lib/useAccount';

/** 처음 로그인했을 때 이 기기에 로그인 전 북마크가 있으면 한 번 묻는다: [합치기] [나중에]. 묻지 않고 합치거나 지우지 않는다.
 *  '나중에'면 다시 자동으로 묻지 않고 내 데이터 화면의 버튼으로 남긴다. 로그인 장벽(AuthGate) 안에서 모든 화면에 붙는다. */
export default function ClaimPrompt() {
  const { uid } = useSyncUser(AUTH_MODE);
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [result, setResult] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setResult(null);
    if (!uid) { setItems([]); return; }
    const it = deviceItems(uid);
    setItems(shouldAsk(browserKV, uid, it) ? it : []);
  }, [uid]);
  if (!uid || (!items.length && !result)) return null;
  const merge = async () => {
    setBusy(true);
    const r = await runClaim(uid, items.map(i => i.channel));
    setBusy(false); setItems([]);
    setResult([
      ...(r.merged ? ['합쳤습니다.'] : []),
      ...(r.refused.length ? [`${r.refused.join('·')}: 합치면 저장 한도를 넘어 합치지 않았습니다.`] : []),
      ...r.notes,
    ]);
  };
  const later = () => { browserKV.set(laterKey(uid), new Date().toISOString()); setItems([]); };
  return <div className="claimBar" role="dialog" aria-label="북마크 합치기" aria-live="polite">
    {result
      ? <><span>{result.join(' ')}</span><button type="button" onClick={() => setResult(null)}>닫기</button></>
      : <><span>{promptText(items)}</span>
        <button type="button" onClick={merge} disabled={busy}>합치기</button>
        <button type="button" onClick={later} disabled={busy}>나중에</button></>}
  </div>;
}
