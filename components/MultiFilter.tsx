'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { FacetOption, groupOptions } from '../lib/facets';

type Props = {
  label: string;                       // 버튼·칩 이름(언론사/보험사/유관기관)
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  groups?: string[];                   // 있으면 그룹 제목 아래로 묶어서 보여준다
  persistNote?: string;                // 선택이 이 브라우저에 저장된다는 안내(보험사)
};

/** 다중 선택 드롭다운(기사 수 순, 건수 표시, 옵션이 많으면 안에서 검색). 바깥 클릭·Esc 로 닫힘. 언론사·보험사·유관기관 공용. */
export default function MultiFilter({ label, options, selected, onChange, groups, persistNote }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return t ? options.filter(o => o.name.toLowerCase().includes(t)) : options; }, [options, q]);
  const blocks = useMemo(() => groupOptions(shown, groups), [shown, groups]);
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name]);
  return <div className="sourceFilter" ref={box}>
    <button ref={btn} type="button" className={'sourceBtn' + (selected.length ? ' on' : '')} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {label}{selected.length > 0 && <b>{selected.length}</b>}<ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="sourcePanel" role="group" aria-label={`${label} 선택`}>
      <div className="sourcePanelHead"><span>{label} {options.length}곳 · 기사 수 순</span><button type="button" disabled={!selected.length} onClick={() => onChange([])}>전체 해제</button></div>
      {options.length > 8 && <label className="msSearch"><Search size={14} aria-hidden="true" /><input type="search" aria-label={`${label} 안에서 검색`} placeholder={`${label} 검색`} value={q} onChange={e => setQ(e.target.value)} /></label>}
      <ul>{blocks.map(b => <li key={b.group ?? '_'} className="msGroup">
        {b.group && <div className="msGroupName">{b.group}</div>}
        <ul>{b.options.map(o => <li key={o.name}>
          <label><input type="checkbox" checked={selected.includes(o.name)} onChange={() => toggle(o.name)} /><span className="sname">{o.name}</span><span className="scount">{o.count.toLocaleString()}</span></label>
        </li>)}</ul>
      </li>)}
        {!shown.length && <li className="msNone">일치하는 {label}이(가) 없습니다</li>}
      </ul>
      {persistNote && <div className="msNote">{persistNote}</div>}
    </div>}
  </div>;
}

/** 선택한 항목 칩(어떤 필터인지 이름 표기). 칩의 x 로 하나씩, '전체 해제'로 모두 해제. */
export function FilterChips({ label, selected, onChange }: { label: string; selected: string[]; onChange: (next: string[]) => void }) {
  if (!selected.length) return null;
  return <div className="sourceChips" aria-label={`선택한 ${label}`}>
    {selected.map(s => <span key={s} className="chip"><span className="chipKind">{label}</span>{s}<button type="button" aria-label={`${s} 선택 해제`} onClick={() => onChange(selected.filter(x => x !== s))}><X size={13} aria-hidden="true" /></button></span>)}
    <button type="button" className="chipClear" onClick={() => onChange([])}>{label} 전체 해제</button>
  </div>;
}
