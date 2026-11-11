'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Upload } from 'lucide-react';
import { useChannel } from '../../../lib/channelContext';
import { useSaved } from '../../../lib/useSaved';
import { decodePayload, readImportHash } from '../../../lib/transfer';
import { type ImportResult, type Summary, mergeStates, parseImport, summarize, toExportFile } from '../../../lib/userState';

type Pending = ImportResult & { from: 'file' | 'link'; name?: string };
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 내 데이터: 이 브라우저의 북마크·읽음·새 뉴스 확인 시각·선택한 보험사를 JSON 파일로 백업·복원한다.
 *  #import=… 해시(옛 사이트 이전 링크)로 들어오면 같은 가져오기 미리보기를 연다. 해시는 서버로 전송되지 않는다. */
export default function SettingsPage() {
  const ch = useChannel();
  const { fmt } = ch;
  const legacy = ch.storage?.legacy_keys;
  const { saved, ready, update } = useSaved();
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
      .catch(e => setError(`링크의 데이터를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)} 파일로 옮기는 방법을 이용하세요.`));
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
      setError(`가져오지 못했습니다: ${e instanceof SyntaxError ? 'JSON 파일이 아닙니다.' : e instanceof Error ? e.message : String(e)}`);
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
    <td data-label="새 뉴스 확인 시각">{s.lastConfirmed ? fmt(s.lastConfirmed) : '없음'}</td><td data-label={`선택한 ${ch.filters.companies}`}>{s.companies.toLocaleString()}곳</td></tr>;

  return <>
    <div className="notice"><div><b>내 데이터 (이 브라우저)</b><p>북마크·읽음 기록·새 뉴스 확인 시각·선택한 {ch.filters.companies}는 이 브라우저에만 저장됩니다. 다른 기기·브라우저로 옮기거나 백업하려면 파일로 내려받아 가져오세요. 가져오기는 지금 데이터를 지우지 않고 합칩니다.</p></div></div>
    {error && <div className="error" role="alert"><AlertCircle size={17} /> {error}</div>}
    {done && <div className="notice" role="status"><div><b><CheckCircle2 size={14} /> {done}</b></div></div>}

    {pending && <section className="articles dataPanel" aria-labelledby="import-title">
      <h3 id="import-title">가져오기 미리보기 <small>{pending.from === 'link' ? '이전 링크' : pending.name}{pending.kind === 'legacy' ? ' · 옛 사이트(actuary-news-hub) 형식' : ''}</small></h3>
      <div className="tableWrap"><table className="statusTable"><thead><tr><th>구분</th><th>북마크</th><th>읽음</th><th>새 뉴스 확인 시각</th><th>선택한 {ch.filters.companies}</th></tr></thead>
        <tbody>{row('가져올 데이터', incoming)}{row('지금 이 브라우저', current)}{row('합친 뒤', merged)}</tbody></table></div>
      <p className="dataNote">겹치는 북마크·읽음은 하나로 합치고, 새 뉴스 확인 시각은 더 늦은 쪽을 씁니다. 읽음 기록이 1,500건을 넘으면 오래된 기록부터 정리됩니다.</p>
      <div className="dataActions">
        <button type="button" className="confirm" disabled={!ready} onClick={apply}>확인하고 가져오기</button>
        <button type="button" className="readToggle" onClick={() => setPending(null)}>취소</button>
      </div>
    </section>}

    <section className="articles dataPanel" aria-labelledby="current-title">
      <h3 id="current-title">지금 저장된 데이터</h3>
      {!ready ? <div className="empty">불러오는 중입니다…</div> : <div className="tableWrap"><table className="statusTable"><thead><tr><th>구분</th><th>북마크</th><th>읽음</th><th>새 뉴스 확인 시각</th><th>선택한 {ch.filters.companies}</th></tr></thead>
        <tbody>{row('이 브라우저', current)}</tbody></table></div>}
      <div className="dataActions">
        <button type="button" className="confirm" disabled={!ready} onClick={download}><Download size={15} /> 파일로 내려받기(백업)</button>
        <label className="readToggle fileBtn"><Upload size={14} /> 파일에서 가져오기(복원)
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={e => onFile(e.target.files?.[0])} /></label>
      </div>
    </section>
  </>;
}
