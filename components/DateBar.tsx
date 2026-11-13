'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayHeading, monthGrid, shiftMonth, todayKst } from '../lib/dates';
import { type Bounds, QUICK, moveDay, overlaps, pickDay, quickRange, sameRange, selectable } from '../lib/datePick';

export type DateFilter = { from: string; to: string } | null;
/** bounds: 데이터가 있는 날짜 범위(첫 기사~마지막 기사). 밖의 날짜는 누를 수 없다. */
type Props = { filter: DateFilter; onChange: (f: DateFilter) => void; counts: Record<string, number>; month: string; onMonth: (ym: string) => void; bounds: Bounds | null };

const span = (f: NonNullable<DateFilter>) => Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1;
const label = (f: DateFilter) => !f ? '전체 기간' : f.from === f.to ? dayHeading(f.from) : `${dayHeading(f.from)} ~ ${dayHeading(f.to)}`;

/** 날짜 바: [이전 기간] [달력 열기] [다음 기간] · 빠른 선택(오늘·3일·7일·30일·이번 달) · [기간 해제].
 *  달력: 첫 번째로 누른 날이 그 하루(바로 적용)이자 시작, 두 번째로 누른 날까지가 기간. 방향키·PageUp/Down 이동, Enter 선택, Esc 닫기. */
export default function DateBar({ filter, onChange, counts, month, onMonth, bounds }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);   // 기간의 시작으로 누른 날(끝을 기다리는 중)
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const today = todayKst();
  const clampDay = (d: string) => !bounds ? d : d < bounds.min ? bounds.min : d > bounds.max ? bounds.max : d;
  const openCal = () => {
    const start = clampDay(filter?.to ?? bounds?.max ?? today);
    setAnchor(null); setFocusDay(start); onMonth(start.slice(0, 7)); setOpen(true);
  };
  const close = (refocus: boolean) => { setOpen(false); setAnchor(null); if (refocus) toggle.current?.focus(); };
  // 달력을 열거나 키보드로 옮기면 그 날짜 버튼으로 포커스(마우스로 누른 뒤에는 그대로)
  const moved = useRef(false);
  useEffect(() => {
    if (!open || !focusDay || !moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focusDay}"]`)?.focus();
  }, [open, focusDay, month]);
  const shift = (dir: 1 | -1) => {
    const f = filter ?? { from: today, to: today };
    const n = span(f) * dir;
    const next = { from: addDays(f.from, n), to: addDays(f.to, n) };
    if (bounds && (next.from > bounds.max || next.to < bounds.min)) return;   // 데이터 밖으로는 이동하지 않음
    onChange(next); onMonth(next.from.slice(0, 7));
  };
  const choose = (d: string) => {
    if (!selectable(d, bounds)) return;
    const r = pickDay(anchor, d);
    onChange(r.range); setAnchor(r.anchor); setFocusDay(d);
    if (!r.anchor) close(true);   // 기간을 다 고르면 닫는다
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (!focusDay || !(e.target as HTMLElement).dataset.day) return;
    const n = moveDay(focusDay, e.key, bounds);
    if (n === null) return;
    e.preventDefault();
    moved.current = true;
    setFocusDay(n);
    if (n.slice(0, 7) !== month) onMonth(n.slice(0, 7));
  };
  const minYm = bounds?.min.slice(0, 7), maxYm = bounds?.max.slice(0, 7);
  return <div className="datebar">
    <div className="dateRow">
      <button type="button" className="dnav" aria-label="이전 기간" disabled={!!bounds && !!filter && filter.from <= bounds.min} onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button type="button" ref={toggle} className={'dcur' + (filter ? ' on' : '')} onClick={() => { if (open) close(false); else { moved.current = true; openCal(); } }} aria-expanded={open} aria-controls="dateCal"><CalendarDays size={15} aria-hidden="true" /> {label(filter)}</button>
      <button type="button" className="dnav" aria-label="다음 기간" disabled={!filter || filter.to >= (bounds?.max ?? today)} onClick={() => shift(1)}><ChevronRight size={16} /></button>
      {QUICK.map(q => { const r = quickRange(q.key, today); return <button type="button" key={q.key} aria-label={q.aria} className={sameRange(filter, r) ? 'dq on' : 'dq'} aria-pressed={sameRange(filter, r)} disabled={!overlaps(r, bounds)} onClick={() => { onChange(r); onMonth(r.to.slice(0, 7)); close(false); }}>{q.label}</button>; })}
      {filter && <button type="button" className="dq" onClick={() => { onChange(null); close(false); }}>기간 해제</button>}
    </div>
    {open && <div className="cal" id="dateCal" role="dialog" aria-label="기간 선택" onKeyDown={onKey}>
      <div className="calHead">
        <button type="button" className="dnav" aria-label="이전 달" disabled={!!minYm && month <= minYm} onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <b>{month.replace('-', '년 ')}월</b>
        <button type="button" className="dnav" aria-label="다음 달" disabled={!!maxYm && month >= maxYm} onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="calGrid" ref={grid}>
        {['일', '월', '화', '수', '목', '금', '토'].map(w => <span key={w} className="dow" aria-hidden="true">{w}</span>)}
        {monthGrid(month).flat().map((d, i) => {
          if (d === null) return <span key={i} />;
          const ok = selectable(d, bounds);
          const sel = !!filter && d >= filter.from && d <= filter.to;
          const roving = focusDay && focusDay.slice(0, 7) === month ? d === focusDay : d === clampDay(`${month}-01`);
          return <button type="button" key={d} data-day={d} disabled={!ok} tabIndex={roving ? 0 : -1} aria-pressed={sel}
            aria-label={`${dayHeading(d)}${counts[d] ? ` ${counts[d]}건` : ''}${d === anchor ? ', 기간 시작' : ''}`}
            className={'day' + (sel ? ' sel' : '') + (d === anchor ? ' anchor' : '') + (d === today ? ' today' : '')}
            onClick={() => choose(d)} onFocus={() => setFocusDay(d)}>
            <span>{Number(d.slice(8))}</span><small>{counts[d] ?? ''}</small>
          </button>;
        })}
      </div>
      <p className="calHint" aria-live="polite">{anchor ? '끝 날짜를 누르세요' : ''}</p>
    </div>}
  </div>;
}
