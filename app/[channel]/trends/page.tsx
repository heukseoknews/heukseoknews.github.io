'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { todayKst } from '../../../lib/dates';
import { loadTrends } from '../../../lib/news';
import { Trends, lastWeeks, niceMax } from '../../../lib/trends';
import { useChannel } from '../../../lib/channelContext';

const WEEKS = 12;
// 선 색 = CSS 토큰(--chart-1 은 채널 색, 나머지는 흰 바탕 대비 4.9:1 이상)
const COLORS = [1, 2, 3, 4, 5, 6, 7].map(i => `var(--chart-${i})`);
const W = 640, H = 280, L = 36, R = 12, T = 12, B = 34;

export default function TrendsPage() {
  const ch = useChannel();
  const [trends, setTrends] = useState<Trends | null>(null);
  const [failure, setFailure] = useState('');
  const [off, setOff] = useState<string[]>([]);
  useEffect(() => { loadTrends(ch.slug).then(setTrends).catch(() => setFailure('추이 자료를 불러오지 못했습니다.')); }, [ch.slug]);
  const today = todayKst();
  const weeks = useMemo(() => trends ? lastWeeks(trends, today, WEEKS) : [], [trends, today]);
  const shown = trends?.keywords.filter(k => !off.includes(k)) ?? [];
  const max = niceMax(Math.max(0, ...weeks.flatMap(w => shown.map(k => w.counts[k] ?? 0))));
  const x = (i: number) => weeks.length < 2 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (weeks.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

  return <>
    <h1 className="srOnly">키워드 추이</h1>
    <div className="notice"><div><b>키워드 주별 언급 수 (최근 {WEEKS}주)</b><p>제목에 키워드가 나온 기사 수(주 단위, 월~일)</p></div></div>
    {!trends && !failure && <div className="articles"><div className="empty">불러오는 중…</div></div>}
    {failure && <div className="error"><AlertCircle size={17} /> {failure}</div>}
    {trends && <section className="articles chartBox">
      <div className="legend">{trends.keywords.map((k, i) => <label key={k} className={off.includes(k) ? 'off' : ''}>
        <input type="checkbox" checked={!off.includes(k)} onChange={() => setOff(o => o.includes(k) ? o.filter(v => v !== k) : [...o, k])} />
        <i style={{ background: COLORS[i % COLORS.length] }} />{k}</label>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="키워드별 주간 언급 수 추이" className="chart">
        {[0, 1, 2, 3, 4].map(g => { const v = (max * g) / 4; return <g key={g}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text className="axis" x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10">{Math.round(v)}</text></g>; })}
        {weeks.map((w, i) => <text key={w.week_start} className="axis" x={x(i)} y={H - 12} textAnchor="middle" fontSize="10">{md(w.week_start)}</text>)}
        {trends.keywords.map((k, ki) => off.includes(k) ? null : <g key={k}>
          <polyline fill="none" style={{ stroke: COLORS[ki % COLORS.length] }} strokeWidth="2" points={weeks.map((w, i) => `${x(i)},${y(w.counts[k] ?? 0)}`).join(' ')} />
          {weeks.map((w, i) => <circle key={i} cx={x(i)} cy={y(w.counts[k] ?? 0)} r="3" style={{ fill: COLORS[ki % COLORS.length] }}><title>{`${k} · ${md(w.week_start)}주 · ${w.counts[k] ?? 0}건`}</title></circle>)}
        </g>)}
      </svg>
      <div className="tableWrap"><table className="statusTable"><thead><tr><th>주 시작(월)</th>{trends.keywords.map(k => <th key={k}>{k}</th>)}<th>전체 기사</th></tr></thead>
        <tbody>{[...weeks].reverse().map(w => <tr key={w.week_start}><td data-label="주 시작(월)">{w.week_start}{w.week_start === weeks[weeks.length - 1].week_start ? ' (진행 중)' : ''}</td>{trends.keywords.map(k => <td key={k} data-label={k}>{w.counts[k] ?? 0}</td>)}<td data-label="전체 기사">{w.total}</td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
