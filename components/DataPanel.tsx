'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Upload } from 'lucide-react';
import { useChannel } from '../lib/channelContext';
import { useSaved } from '../lib/useSaved';
import { decodePayload, readImportHash } from '../lib/transfer';
import { type ImportResult, type Summary, mergeStates, parseImport, summarize, toExportFile } from '../lib/userState';
import { deviceItems, runClaim } from '../lib/claimRun';

type Pending = ImportResult & { from: 'file' | 'link'; name?: string };
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 내 데이터: 북마크(목록·태그·메모 포함)·읽음·새 뉴스 확인 시각·선택한 보험사를 JSON 파일로 백업·복원한다(채널별).
 *  로그인 중이면 계정 사본이 대상이고, 로그인 전 이 기기 북마크가 남아 있으면 '내 계정에 합치기'를 둔다(처음 물을 때 '나중에'를 고른 경우).
 *  #import=… 해시(옛 사이트 이전 링크)로 들어오면 같은 가져오기 미리보기를 연다. 해시는 서버로 전송되지 않는다.
 *  마이페이지(/me/data/)가 쓴다. 옛 주소 /<채널>/settings/ 는 그리로 보낸다. */
export default function DataPanel() {
  const ch = useChannel();
  const { fmt } = ch;
  const legacy = ch.storage?.legacy_keys;
  const { saved, ready, update, userId } = useSaved();
  const [claimN, setClaimN] = useState(0);   // 로그인 전 이 기기 북마크(이 채널, 아직 이 계정에 합치지 않음)
  useEffect(() => { setClaimN(userId ? deviceItems(userId, [ch.slug])[0]?.count ?? 0 : 0); }, [userId, ch.slug]);
  const claim = async () => {
    if (!userId) return;
    const r = await runClaim(userId, [ch.slug]);
    setClaimN(0);
    if (r.refused.length) setError('합치면 저장 한도를 넘어 합치지 않았습니다. 북마크를 줄인 뒤 다시 해 주세요.');
    else setDone(['이 기기의 북마크를 내 계정에 합쳤습니다.', ...r.notes].join(' '));
  };
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const code = readImportHash(window.location.hash);
    if (!code) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);  // 데이터가 주소창·방문 기록에 남지 않게
    decodePayload(code)
      .then(raw => setPending({ ...parseImport(raw, ch.slug, legacy), from: 'link' }))
      .catch(e => { console.error('import link', e); setError('링크를 읽지 못했습니다. 파일로 가져오세요.'); });
  }, [ch.slug, legacy]);

  const current = summarize(saved);
  const incoming = pending ? summarize(pending.state) : null;
  const merged = useMemo(() => (pending && ready ? summarize(mergeStates(saved, pending.state)) : null), [pending, ready, saved]);

  const download = () => {
    const blob = new Blob([JSON.stringify(toExportFile(ch.slug, saved), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `heukseok-${ch.slug}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (f: File | undefined) => {
    setError(''); setDone(''); setPending(null);
    if (!f) return;
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error('파일이 너무 큽니다(10MB 초과).');
      const raw = JSON.parse(await f.text());
      setPending({ ...parseImport(raw, ch.slug, legacy), from: 'file', name: f.name });
    } catch (e) {
      if (!(e instanceof Error) || e instanceof SyntaxError) console.error('import file', e);
      setError(`가져오지 못했습니다: ${e instanceof SyntaxError || !(e instanceof Error) ? '백업 파일이 아닙니다.' : e.message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = () => {
    if (!pending || !ready || !merged) return;
    const before = current;
    update(s => mergeStates(s, pending.state));
    setDone(`가져왔습니다. 북마크 ${before.bookmarks.toLocaleString()} → ${merged.bookmarks.toLocaleString()}건, 읽음 ${before.reads.toLocaleString()} → ${merged.reads.toLocaleString()}건.`);
    setPending(null);
  };

  const row = (label: string, s: Summary | null) => s && <tr><td data-label="구분"><b>{label}</b></td>
    <td data-label="북마크">{s.bookmarks.toLocaleString()}건</td><td data-label="읽음">{s.reads.toLocaleString()}건</td>
    <td data-label="목록·태그·메모">{s.folders} · {s.tags} · {s.memos.toLocaleString()}</td>
    <td data-label="마지막 확인">{s.lastConfirmed ? fmt(s.lastConfirmed) : '없음'}</td><td data-label={`선택한 ${ch.filters.companies}`}>{s.companies.toLocaleString()}곳</td></tr>;

  return <>
    {!userId && <p className="meNote">북마크·목록·태그·메모·읽음 기록·선택한 {ch.filters.companies}는 이 브라우저에만 저장됩니다. 다른 기기로 옮길 때는 파일로 내려받아 가져오세요(기존 기록과 합쳐집니다).</p>}
    {claimN > 0 && <div className="notice"><div><b>로그인 전 이 기기에 저장한 북마크 {claimN.toLocaleString()}개가 있습니다.</b></div><button type="button" className="confirm" onClick={claim}>내 계정에 합치기</button></div>}
    {error && <div className="error" role="alert"><AlertCircle size={17} /> {error}</div>}
    {done && <div className="notice" role="status"><div><b><CheckCircle2 size={14} /> {done}</b></div></div>}

    {pending && <section className="articles dataPanel" aria-labelledby="import-title">
      <h2 id="import-title">가져오기 미리보기 <small>{pending.from === 'link' ? '이전 링크' : pending.name}{pending.kind === 'legacy' ? ' · 이전 사이트 기록' : ''}</small></h2>
      <div className="tableWrap"><table className="statusTable"><thead><tr><th>구분</th><th>북마크</th><th>읽음</th><th>목록·태그·메모</th><th>마지막 확인</th><th>선택한 {ch.filters.companies}</th></tr></thead>
        <tbody>{row('가져올 데이터', incoming)}{row(userId ? '지금 내 계정' : '지금 이 브라우저', current)}{row('합친 뒤', merged)}</tbody></table></div>
      <p className="dataNote">겹치는 기록은 하나로 합칩니다. 같은 북마크는 나중에 고친 쪽을 남깁니다.</p>
      <div className="dataActions">
        <button type="button" className="confirm" disabled={!ready} onClick={apply}>확인하고 가져오기</button>
        <button type="button" className="readToggle" onClick={() => setPending(null)}>취소</button>
      </div>
    </section>}

    <section className="articles dataPanel" aria-labelledby="current-title">
      <h2 id="current-title">지금 저장된 데이터</h2>
      {!ready ? <div className="empty">불러오는 중입니다…</div> : <div className="tableWrap"><table className="statusTable"><thead><tr><th>구분</th><th>북마크</th><th>읽음</th><th>목록·태그·메모</th><th>마지막 확인</th><th>선택한 {ch.filters.companies}</th></tr></thead>
        <tbody>{row(userId ? '내 계정' : '이 브라우저', current)}</tbody></table></div>}
      <div className="dataActions">
        <button type="button" className="confirm" disabled={!ready} onClick={download}><Download size={15} /> 파일로 내려받기(백업)</button>
        <label className="readToggle fileBtn"><Upload size={14} /> 파일에서 가져오기(복원)
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={e => onFile(e.target.files?.[0])} /></label>
      </div>
    </section>
  </>;
}
