'use client';
import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayHeading, monthGrid, shiftMonth, todayKst, weekRange } from '../lib/dates';

export type DateFilter = { from: string; to: string } | null;
type Props = { filter: DateFilter; onChange: (f: DateFilter) => void; counts: Record<string, number>; month: string; onMonth: (ym: string) => void };

const span = (f: NonNullable<DateFilter>) => Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1;
const label = (f: DateFilter) => !f ? '날짜 전체' : f.from === f.to ? dayHeading(f.from) : `${dayHeading(f.from)} ~ ${dayHeading(f.to)}`;

export default function DateBar({ filter, onChange, counts, month, onMonth }: Props) {
  const [open, setOpen] = useState(false);
  const today = todayKst();
  const yesterday = addDays(today, -1);
  const single = (d: string) => onChange({ from: d, to: d });
  const shift = (dir: 1 | -1) => {
    const f = filter ?? { from: today, to: today };
    const n = span(f) * dir;
    const next = { from: addDays(f.from, n), to: addDays(f.to, n) };
    if (next.from > today) return; // 미래로는 이동하지 않음
    onChange(next); onMonth(next.from.slice(0, 7));
  };
  const week = weekRange(today);
  const is = (a: string, b: string) => filter?.from === a && filter?.to === b;
  return <div className="datebar">
    <div className="dateRow">
      <button className="dnav" aria-label="이전" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button className={'dcur' + (filter ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open}><CalendarDays size={15} /> {label(filter)}</button>
      <button className="dnav" aria-label="다음" disabled={!filter || filter.to >= today} onClick={() => shift(1)}><ChevronRight size={16} /></button>
      <button className={is(today, today) ? 'dq on' : 'dq'} onClick={() => { single(today); onMonth(today.slice(0, 7)); }}>오늘</button>
      <button className={is(yesterday, yesterday) ? 'dq on' : 'dq'} onClick={() => { single(yesterday); onMonth(yesterday.slice(0, 7)); }}>어제</button>
      <button className={is(week[0], week[1]) ? 'dq on' : 'dq'} onClick={() => { onChange({ from: week[0], to: week[1] }); onMonth(week[0].slice(0, 7)); }}>이번 주</button>
      {filter && <button className="dq" onClick={() => onChange(null)}>해제</button>}
    </div>
    {open && <div className="cal" role="dialog" aria-label="날짜 선택">
      <div className="calHead">
        <button className="dnav" aria-label="이전 달" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <b>{month.replace('-', '년 ')}월</b>
        <button className="dnav" aria-label="다음 달" onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="calGrid">
        {['일', '월', '화', '수', '목', '금', '토'].map(w => <span key={w} className="dow">{w}</span>)}
        {monthGrid(month).flat().map((d, i) => d === null ? <span key={i} /> :
          <button key={d} disabled={d > today} className={'day' + (filter && d >= filter.from && d <= filter.to ? ' sel' : '') + (d === today ? ' today' : '')}
            onClick={() => { single(d); setOpen(false); }}>
            <span>{Number(d.slice(8))}</span><small>{counts[d] ?? ''}</small>
          </button>)}
      </div>
    </div>}
  </div>;
}
