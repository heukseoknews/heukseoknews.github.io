'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Status, loadStatus, loadVersion } from '../../lib/news';
import { VersionInfo, formatBuild, triggerLabel } from '../../lib/version';
import { fmt } from '../../lib/format';

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failure, setFailure] = useState('');
  const [ver, setVer] = useState<VersionInfo | null>(null);
  useEffect(() => { loadVersion().then(setVer).catch(() => {}); }, []);
  useEffect(() => { loadStatus().then(setStatus).catch(() => setFailure('수집 상태 파일(status.json)이 아직 없습니다. 수집을 한 번 실행하면 생성됩니다.')); }, []);
  const entries = status ? Object.entries(status.sources) : [];
  const run = status?.last_run;
  return <>
    {ver && <div className="notice"><div><b>사이트 빌드 {formatBuild(ver.built_at)}</b><p>커밋 {ver.commit}{ver.commit_message ? ` · ${ver.commit_message}` : ''} · {triggerLabel(ver.trigger)}{ver.run_id ? ` · 실행 #${ver.run_id}` : ''}</p></div></div>}
    {run && <div className="notice"><div><b>마지막 수집 {fmt(run.started_at)}</b><p>후보 {run.candidates}건 · 신규 저장 {run.added}건 · 실패 피드 {run.failed.length}개{run.failed.length ? ` (${run.failed.join(', ')})` : ''}{run.noted?.length ? ` · 참고 ${run.noted.length}개(${run.noted.join(', ')}: 게시판으로 대체)` : ''}{run.blocked && Object.keys(run.blocked).length ? ` · 차단 출처 ${Object.entries(run.blocked).map(([k, v]) => `${k} ${v}건`).join(', ')}` : ''}</p></div></div>}
    {!status && !failure && <div className="articles"><div className="empty">수집 상태를 불러오는 중입니다…</div></div>}
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    {status && <section className="articles"><div className="tableWrap"><table className="statusTable">
      <thead><tr><th>소스</th><th>상태</th><th>피드 항목</th><th>저장 후보</th><th>받은 기사 범위(발행)</th><th>마지막 성공</th><th>비고</th></tr></thead>
      <tbody>{entries.map(([name, s]) => <tr key={name}>
        <td data-label="소스"><b>{name}</b></td>
        <td data-label="상태">{s.ok ? <span className="ok"><CheckCircle2 size={14} /> 성공</span> : s.note ? <span className="noteState"><Info size={14} /> 참고</span> : <span className="fail"><XCircle size={14} /> 실패{s.consecutive_failures > 1 ? ` (${s.consecutive_failures}회 연속)` : ''}</span>}</td>
        <td data-label="피드 항목">{s.ok ? s.entries : '—'}</td>
        <td data-label="저장 후보">{s.ok ? s.kept : '—'}</td>
        <td data-label="받은 기사 범위(발행)" className="note">{s.ok && s.oldest && s.newest ? <>{fmt(s.oldest)} ~<br />{fmt(s.newest)}</> : '—'}
          {s.at_limit && <span className="flag" title="피드가 준 항목 수가 50/100건에 닿았습니다. 더 오래된 기사가 잘렸을 수 있습니다.">상한 도달</span>}
          {s.needs_split && <span className="flag warn" title="검색 쿼리가 100건 상한에 닿았습니다. 쿼리를 더 쪼개야 놓치는 기사가 없습니다(config/feeds.json).">쿼리 분할 필요</span>}
          {s.gap_risk && <span className="flag warn" title="받은 기사 중 가장 오래된 것이 직전 수집 시각보다 늦습니다. 그 사이 기사를 놓쳤을 수 있습니다.">누락 위험</span>}</td>
        <td data-label="마지막 성공">{s.last_success_at ? fmt(s.last_success_at) : '없음'}</td>
        <td data-label="비고" className="note">{s.note ? `참고: ${s.note}` : s.error ?? ''}{!s.error && !s.note && (s.skipped.low_relevance ?? s.skipped.irrelevant) ? `관련도 낮음 ${s.skipped.low_relevance ?? s.skipped.irrelevant}건(저장함)` : ''}
          {!!s.filtered?.length && <details><summary>관련도 낮음 제목 샘플 {s.filtered.length}건</summary><ul className="filteredList">{s.filtered.map((t, i) => <li key={i}>{t}</li>)}</ul></details>}</td>
      </tr>)}</tbody></table></div></section>}
  </>;
}
