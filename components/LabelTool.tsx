'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getChannel } from '../lib/channels';
import { fmt } from '../lib/format';
import {
  BATCH, LABEL_CHANNELS, LABEL_KEY, type LabelAction, type LabelStore, PURPOSE, SCALE, SCORES,
  applyAction, defaultSession, emptyStore, firstUnlabeled, keyAction, mergeRows, parseImport, parseStore, sampleOrder, seedFor, summary, toExport,
} from '../lib/label';
import { isSafeUrl } from '../lib/news';
import { useNews } from '../lib/useNews';
import s from './LabelTool.module.css';

const readStore = (): LabelStore => { try { return parseStore(localStorage.getItem(LABEL_KEY)); } catch { return emptyStore(); } };
const writeStore = (st: LabelStore) => { try { localStorage.setItem(LABEL_KEY, JSON.stringify(st)); } catch { /* 저장 불가(사생활 보호 모드 등) */ } };
const monthLabel = (m: string) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월`;

export default function LabelTool() {
  const [store, setStore] = useState<LabelStore | null>(null);
  useEffect(() => { setStore(readStore()); }, []);
  useEffect(() => { if (store) writeStore(store); }, [store]);
  if (!store) return <main className={`shell ${s.wrap}`} id="content"><p className={s.note}>불러오는 중…</p></main>;
  const channel = store.channel ?? 'insurance';
  return <main className={`shell ${s.wrap}`} id="content">
    <h1 className={s.title}>기사 라벨링</h1>
    <section className={s.guide} aria-label="점수 기준">
      <ol className={s.scale}>{SCORES.map(n => <li key={n}><b>{n}</b> {SCALE[n]}</li>)}</ol>
      <p className={s.purpose}><b>{getChannel(channel)?.name ?? channel}</b> {PURPOSE[channel]}</p>
    </section>
    <nav className={s.channels} aria-label="채널">
      {LABEL_CHANNELS.map(ch => <button key={ch} type="button" aria-pressed={ch === channel} className={ch === channel ? s.on : ''}
        onClick={() => setStore(p => p && { ...p, channel: ch })}>{getChannel(ch)?.name ?? ch}</button>)}
    </nav>
    {/* 채널을 바꾸면 새로 마운트(useNews 의 월 캐시가 채널별이 아니라서) */}
    <Labeler key={channel} channel={channel} store={store} setStore={setStore} />
  </main>;
}

type Props = { channel: string; store: LabelStore; setStore: React.Dispatch<React.SetStateAction<LabelStore | null>> };

function Labeler({ channel, store, setStore }: Props) {
  const { index, all, loaded, failure } = useNews(channel, 'all');
  const session = store.sessions[channel] ?? defaultSession();
  const labels = store.labels[channel];
  const ready = !!index && index.months.every(m => loaded.includes(m.month));
  const queue = useMemo(() => (ready ? sampleOrder(all, seedFor(channel), session.month, session.size) : []), [ready, all, channel, session.month, session.size]);
  const ids = useMemo(() => queue.map(a => a.id), [queue]);
  const cursor = Math.min(session.cursor, ids.length);
  const art = queue[cursor];
  const sum = summary(ids, labels);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const setSession = (patch: Partial<typeof session>) => setStore(p => p && { ...p, sessions: { ...p.sessions, [channel]: { ...(p.sessions[channel] ?? defaultSession()), ...patch } } });
  const act = (a: LabelAction) => { setMsg(''); setStore(p => p && applyAction(p, channel, ids, a, new Date().toISOString())); };

  // 처음 열 때·기간을 바꿀 때: 첫 미라벨 기사부터
  const startKey = `${session.month}`;
  const started = useRef('');
  useEffect(() => {
    if (!ready || started.current === startKey) return;
    started.current = startKey;
    setSession({ cursor: firstUnlabeled(ids, labels) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, startKey]);

  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, select, textarea, [contenteditable="true"]'))) return;
      const a = keyAction(e.key);
      if (!a) return;
      e.preventDefault();
      actRef.current(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const exportFile = () => {
    const rows = toExport(store);
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `heukseok-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg(`${rows.length}건을 내보냈습니다.`);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { rows, skipped } = parseImport(await f.text());
      const r = mergeRows(store, rows);
      setStore(p => p && mergeRows(p, rows).store);
      setMsg(`가져옴: 새 라벨 ${r.added}건, 바뀐 라벨 ${r.updated}건${skipped ? `, 형식이 맞지 않아 건너뜀 ${skipped}건` : ''}.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : '가져오지 못했습니다.'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const months = index?.months.map(m => m.month) ?? [];
  const mine = labels?.[art?.id ?? ''];
  return <>
    <div className={s.bar}>
      <label className={s.month}>기간{' '}
        <select value={session.month} onChange={e => setSession({ month: e.target.value, size: BATCH })}>
          <option value="all">전체</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </label>
      <span className={s.progress}><b>{sum.done}</b> / {sum.total}{art ? ` · ${cursor + 1}번째` : ''}</span>
      <span className={s.dist} aria-label="점수 분포">{SCORES.map(n => <span key={n}>{n}: {sum.dist[n]}</span>)}</span>
    </div>

    {failure && <p className={s.note} role="alert">{failure}</p>}
    {!ready && !failure && <p className={s.note}>기사를 불러오는 중…</p>}
    {ready && !art && <div className={s.card}>
      <p className={s.done}>{sum.total ? '표본을 끝까지 봤습니다.' : '이 기간에는 기사가 없습니다.'}</p>
      {sum.total > 0 && <button type="button" className={s.small} onClick={() => act({ type: 'prev' })}>← 이전 기사</button>}
    </div>}
    {art && <article className={s.card} aria-live="polite">
      <h2 className={s.headline}>{art.title}</h2>
      <p className={s.meta}>{art.source} · {fmt(art.published_at)}</p>
      {isSafeUrl(art.url) && <a className={s.link} href={art.url} target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>}
      <p className={s.mine}>{mine ? `매긴 점수: ${mine.score}` : '아직 매기지 않음'}</p>
    </article>}

    <div className={s.scores}>
      {SCORES.map(n => <button key={n} type="button" disabled={!art} className={mine?.score === n ? s.picked : ''}
        onClick={() => act({ type: 'score', score: n })}><b>{n}</b><span>{SCALE[n]}</span></button>)}
    </div>
    <div className={s.moves}>
      <button type="button" className={s.small} disabled={cursor === 0} onClick={() => act({ type: 'prev' })}>← 이전</button>
      <button type="button" className={s.small} disabled={!art} onClick={() => act({ type: 'skip' })}>건너뛰기 (S)</button>
    </div>

    <div className={s.tools}>
      <button type="button" className={s.small} disabled={!ready} onClick={() => { setSession({ size: session.size + BATCH, cursor: session.size }); setMsg(''); }}>표본 더 뽑기 (+{BATCH})</button>
      <button type="button" className={s.small} onClick={exportFile}>내보내기</button>
      <button type="button" className={s.small} onClick={() => fileRef.current?.click()}>가져오기</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => importFile(e.target.files?.[0])} />
    </div>
    {msg && <p className={s.note} role="status">{msg}</p>}
    <p className={s.hint}>키보드: 0·1·2·3 점수 후 다음, ← 이전, S 건너뛰기. 라벨은 이 브라우저에만 저장됩니다.</p>
  </>;
}
