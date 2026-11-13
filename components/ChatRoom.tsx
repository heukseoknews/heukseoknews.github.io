'use client';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ExternalLink, Newspaper, RotateCcw, Send, X } from 'lucide-react';
import { AUTH_MODE } from '../lib/authConfig';
import { loginHref } from '../lib/auth';
import { useAccount, useSyncUser } from '../lib/useAccount';
import { getChannel } from '../lib/channels';
import {
  BODY_MAX, BODY_NOTE, COUNT_FROM, COUNTS_EVERY_MS, DELETED_TEXT, NOT_READY, PAGE, SEND_GAP_MS,
  type ChatArticle, type ChatBackend, ChatError, type ChatEvent, type ChatMessage, type LinkState, type Outgoing, type ReadsState,
  applyCounts, articleDate, bodyLength, canDelete, canFetchCounts, canSend, cleanBody, dayKey, dayLabel, dropMessages, enterAction, failNote, fetchSince,
  firstId, isDeleted, isHttpUrl, lastId, markPlan, mergeMessages, nearBottom, readCountIds, readLabel, readsAfterFail, sendProblem, settleOutgoing, takePending, timeLabel,
} from '../lib/chat';
import { supabaseChat } from '../lib/chatBackend';
import { channelColors } from './channelLook';
import ChatAttach from './ChatAttach';

/** /chat/ 화면의 상태 분기: 로그인 꺼진 빌드·로그아웃·확인 전 → 방(Room). 실제 방은 로그인 + 비밀번호 변경 끝난 사용자만. */
export default function ChatRoom() {
  const acc = useAccount();
  const { uid, waiting } = useSyncUser(AUTH_MODE);
  if (AUTH_MODE === 'off') return <div className="chatShell"><p className="chatDown">{NOT_READY}</p></div>;
  if (acc.state === 'out') return <div className="chatShell"><p className="chatDown">로그인한 뒤 볼 수 있습니다. <Link href={loginHref('/chat/')}>로그인</Link></p></div>;
  if (waiting || !uid) return <div className="chatShell"><p className="chatDown">불러오는 중입니다…</p></div>;
  return <Room me={uid} be={supabaseChat} />;
}

const keyOf = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const session = () => { try { return sessionStorage; } catch { return null; } };

/** 메시지의 기사 카드: 제목, 매체 · 날짜, 채널 색 칩. 원문을 새 탭으로(http/https 만) */
function ArticleChip({ a }: { a: ChatArticle }) {
  const ch = getChannel(a.channel);
  const meta = [a.source, articleDate(a.published_at)].filter(Boolean).join(' · ');
  const inner = <><span className="chatArtTop"><span className="chatArtCh">{ch?.name ?? a.channel}</span>{meta && <span className="chatArtMeta">{meta}</span>}</span><span className="chatArtTitle">{a.title}</span></>;
  return isHttpUrl(a.url)
    ? <a className="chatArt" style={channelColors(a.channel)} href={a.url} target="_blank" rel="noopener noreferrer">{inner}<ExternalLink size={14} aria-hidden="true" className="chatArtGo" /></a>
    : <span className="chatArt" style={channelColors(a.channel)}>{inner}</span>;
}

export function Room({ me, be }: { me: string; be: ChatBackend }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'down'>('loading');
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [older, setOlder] = useState(false);
  const [out, setOut] = useState<Outgoing[]>([]);
  const [link, setLink] = useState<LinkState>('connecting');
  const [unseen, setUnseen] = useState(0);
  const [admin, setAdmin] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [attach, setAttach] = useState<ChatArticle | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [delNote, setDelNote] = useState<{ id: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const stick = useRef(true);              // 맨 아래를 보고 있음 → 새 글이 오면 따라 내려간다
  const anchor = useRef<number | null>(null);   // 이전 글을 앞에 붙일 때 보던 자리 유지(아래에서 잰 거리)
  const lastSend = useRef(0);
  const catching = useRef(false);
  // 읽음(0004): 서버에 함수가 없으면 off → 읽음 표시를 숨기고 더 부르지 않는다(채팅은 그대로)
  const [reads, setReads] = useState<ReadsState>('unknown');
  const [counts, setCounts] = useState<Map<number, number>>(() => new Map());
  const [newTick, setNewTick] = useState(0);   // 새 글이 들어옴 → 잠시 뒤 읽음 수 다시 가져오기
  const readsRef = useRef(reads); readsRef.current = reads;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const mark = useRef<{ sent: number; at: number; timer: ReturnType<typeof setTimeout> | null }>({ sent: 0, at: 0, timer: null });

  // 첨부 대기: 기사 카드 [채팅에 올리기]에서 온 기사(한 번만)
  useEffect(() => { const st = session(); const a = st && takePending(st); if (a) setAttach(a); }, []);

  // 처음: 최근 100건 → 맨 아래
  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const rows = await be.list(null, PAGE);
      stick.current = true;
      setMsgs(mergeMessages([], rows));
      setHasMore(rows.length >= PAGE);
      setPhase('ready');
    } catch { setPhase('down'); }
  }, [be]);
  useEffect(() => { load(); be.isAdmin(me).then(setAdmin).catch(() => {}); }, [load, be, me]);

  // 새로 들어온 글 중 남의 글 수(위로 읽는 중일 때 '새 글 N건')
  const countNew = (rows: ChatMessage[]) => {
    const since = lastId(msgsRef.current);
    return rows.filter(m => m.id > since && m.user_id !== me && !isDeleted(m)).length;
  };
  const absorb = useCallback((rows: ChatMessage[]) => {
    if (!rows.length) return;
    const n = countNew(rows);
    if (n && !stick.current) setUnseen(u => u + n);
    if (rows.some(m => m.id > lastId(msgsRef.current))) setNewTick(t => t + 1);
    setMsgs(cur => mergeMessages(cur, rows));
    setOut(o => rows.reduce((acc, m) => settleOutgoing(acc, m, me), o));
  }, [me]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 빠진 글 보충: 마지막으로 받은 id 이후(최근 페이지에 든 삭제도 함께 반영)
  const catchUp = useCallback(async () => {
    if (catching.current || phase !== 'ready') return;
    catching.current = true;
    try {
      const r = await fetchSince((b, l) => be.list(b, l), lastId(msgsRef.current));
      const from = firstId(msgsRef.current);   // 지금 보이는 범위보다 옛 글은 '이전 글 더 보기'로만 붙인다
      if (r.complete) absorb(from ? r.rows.filter(m => m.id >= from) : r.rows);
      else { stick.current = true; setUnseen(0); setMsgs(mergeMessages([], r.rows.slice(0, PAGE))); setHasMore(true); }   // 빈틈이 너무 크면 최근 글부터 새로
    } catch { /* 다음 기회(다시 연결·탭 복귀·주기 확인) */ }
    finally { catching.current = false; }
  }, [be, phase, absorb]);

  // 실시간: 이 화면을 열고 있는 동안만 연결, 떠나면 닫는다. 다시 연결되면 보충
  useEffect(() => {
    if (phase !== 'ready') return;
    const onEvent = (e: ChatEvent) => { if (e.type === 'drop') setMsgs(cur => dropMessages(cur, [e.id])); else absorb([e.row]); };
    return be.subscribe(onEvent, s => { setLink(s); if (s === 'live') { catchUp(); fetchCounts(); } });
  }, [phase, be]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 탭이 다시 보일 때·네트워크가 돌아올 때 보충, 끊겨 있는 동안은 20초마다 확인
  useEffect(() => {
    if (phase !== 'ready') return;
    const onVis = () => { if (document.visibilityState === 'visible') catchUp(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('online', catchUp);
    const t = link === 'live' ? null : setInterval(catchUp, 20_000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', catchUp); if (t) clearInterval(t); };
  }, [phase, link, catchUp]);

  // ───── 읽음 ─────
  const visible = () => document.visibilityState === 'visible';
  // 내 읽은 위치 알리기: 탭이 보이고 최신 글 쪽이 화면에 있을 때만, 3초 이상 간격으로 모아서(markPlan)
  const flushMark = useCallback(function flush() {
    const m = mark.current;
    if (m.timer) return;   // 이미 모으는 중 — 그 타이머가 다시 판단한다
    const want = lastId(msgsRef.current);
    const plan = markPlan({ want, sent: m.sent, lastAt: m.at, now: Date.now(), visible: visible(), seeingLatest: stick.current, reads: readsRef.current });
    if (plan.wait > 0) { m.timer = setTimeout(() => { m.timer = null; flush(); }, plan.wait); return; }
    if (!plan.send) return;
    const prev = m.sent;
    m.sent = want; m.at = Date.now();
    be.markRead(want)
      .then(v => { m.sent = Math.max(m.sent, v); setReads(r => r === 'unknown' ? 'on' : r); })
      .catch(e => { m.sent = prev; setReads(r => readsAfterFail(r, e instanceof ChatError ? e.kind : 'network')); });
  }, [be]);
  // 읽음 수: 내가 보낸 글만, 탭이 보일 때만
  const fetchCounts = useCallback(async () => {
    const ids = readCountIds(msgsRef.current, me);
    if (!canFetchCounts({ ready: phaseRef.current === 'ready', visible: visible(), reads: readsRef.current, ids })) return;
    try {
      const rows = await be.readCounts(ids);
      setCounts(c => applyCounts(c, ids, rows));
      setReads(r => r === 'unknown' ? 'on' : r);
    } catch (e) { setReads(r => readsAfterFail(r, e instanceof ChatError ? e.kind : 'network')); }
  }, [be, me]);
  useEffect(() => { if (phase === 'ready') flushMark(); }, [phase, msgs, flushMark]);
  useEffect(() => {
    if (phase !== 'ready') return;
    fetchCounts();
    const t = setInterval(fetchCounts, COUNTS_EVERY_MS);
    const onVis = () => { if (visible()) { fetchCounts(); flushMark(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [phase, fetchCounts, flushMark]);
  useEffect(() => {
    if (!newTick) return;
    const t = setTimeout(fetchCounts, 1000);   // 새 글이 몰려와도 한 번만
    return () => clearTimeout(t);
  }, [newTick, fetchCounts]);
  useEffect(() => () => { if (mark.current.timer) clearTimeout(mark.current.timer); }, []);

  // 스크롤: 맨 아래를 보고 있으면 따라 내려가고, 이전 글을 앞에 붙였으면 보던 자리를 지킨다
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (anchor.current !== null) { el.scrollTop = el.scrollHeight - anchor.current; anchor.current = null; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, out, phase]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const was = stick.current;
    stick.current = nearBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
    if (stick.current && unseen) setUnseen(0);
    if (stick.current && !was) flushMark();   // 최신 글 쪽으로 내려왔을 때만(스크롤마다 부르지 않는다)
  };
  const toBottom = () => { const el = listRef.current; stick.current = true; setUnseen(0); if (el) el.scrollTop = el.scrollHeight; flushMark(); };
  const loadOlder = async () => {
    if (older || !msgs.length) return;
    setOlder(true);
    try {
      const rows = await be.list(firstId(msgs), PAGE);
      const el = listRef.current;
      if (el) anchor.current = el.scrollHeight - el.scrollTop;
      setMsgs(cur => mergeMessages(cur, rows));
      setHasMore(rows.length >= PAGE);
    } catch { /* 버튼을 다시 누르면 된다 */ }
    finally { setOlder(false); }
  };

  // 모바일 키보드: 보이는 화면(visualViewport) 높이에 방을 맞춘다 → 입력창이 키보드에 가려지지 않는다
  useEffect(() => {
    const vv = window.visualViewport;
    const fit = () => {
      const el = shellRef.current;
      if (!el) return;
      const top = document.querySelector('.siteHeader')?.getBoundingClientRect().height ?? 0;
      el.style.setProperty('--chat-h', `${Math.round((vv?.height ?? window.innerHeight) - top)}px`);
      if (stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    };
    fit();
    vv?.addEventListener('resize', fit); window.addEventListener('resize', fit);
    return () => { vv?.removeEventListener('resize', fit); window.removeEventListener('resize', fit); };
  }, []);

  // 보내기: 화면에 먼저 보이고(보내는 중), 실패하면 '전송 실패 [다시 보내기]'로 남는다
  const deliver = useCallback(async (item: Outgoing) => {
    try {
      const r = await be.send(item.body, item.article);
      const m: ChatMessage = { id: r.id, user_id: me, author_name: r.author_name, body: item.body, article: item.article, created_at: r.created_at, deleted_at: null };
      setOut(o => o.filter(x => x.key !== item.key));
      setMsgs(cur => mergeMessages(cur, [m]));
    } catch (e) {
      const fail = e instanceof ChatError ? e.kind : 'network';
      setOut(o => o.map(x => x.key === item.key ? { ...x, state: 'failed', fail } : x));
    }
  }, [be, me]);
  const lastBody = useRef('');
  const send = () => {
    const now = Date.now();
    const raw = inputRef.current?.value ?? text;   // 입력창의 지금 값(같은 순간의 두 이벤트가 옛 상태를 읽지 않게)
    const p = sendProblem(raw, !!attach);   // 기사를 첨부했으면 글이 없어도 된다
    if (p) { setNote(BODY_NOTE[p]); return; }
    const body = cleanBody(raw);
    // 중복 전송 방지: 같은 내용(글 + 첨부)을 0.5초 안에 다시 보내면 무시(서로 다른 짧은 글을 연달아 보내는 것은 막지 않는다)
    const sig = `${body}\u0000${attach?.id ?? ''}`;
    if (now - lastSend.current < SEND_GAP_MS && sig === lastBody.current) return;
    lastSend.current = now; lastBody.current = sig;
    const item: Outgoing = { key: keyOf(), body, article: attach, state: 'sending', at: now };
    if (inputRef.current) inputRef.current.value = '';
    setOut(o => [...o, item]); setText(''); setAttach(null); setNote(''); setPicking(false);
    stick.current = true; setUnseen(0);
    deliver(item);
    inputRef.current?.focus();
  };
  const retry = (item: Outgoing) => {
    const now = Date.now();
    if (now - lastSend.current < SEND_GAP_MS) return;
    lastSend.current = now;
    const again = { ...item, state: 'sending' as const, fail: undefined };
    setOut(o => o.map(x => x.key === item.key ? again : x));
    deliver(again);
  };
  const [removing, setRemoving] = useState<number | null>(null);
  const remove = async (id: number) => {
    if (removing !== null) return;
    setConfirm(null); setRemoving(id);
    try {
      await be.remove(id);
      setMsgs(cur => mergeMessages(cur, cur.filter(m => m.id === id).map(m => ({ ...m, body: null, article: null, deleted_at: new Date().toISOString() }))));
    } catch (e) {
      const k = e instanceof ChatError ? e.kind : 'network';
      setDelNote({ id, text: k === 'forbidden' ? '지울 수 없습니다' : '지우지 못했습니다. 잠시 후 다시 시도해 주세요' });
    } finally { setRemoving(null); }
  };

  // 입력창 높이: 내용에 맞춰 늘고(최대 여섯 줄 정도는 CSS max-height), 보낸 뒤 줄어든다
  useLayoutEffect(() => { const t = inputRef.current; if (!t) return; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }, [text]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const act = enterAction({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode });
    if (act === 'send') { e.preventDefault(); send(); }
  };

  if (phase === 'down') return <div className="chatShell" ref={shellRef}><p className="chatDown" role="status">{NOT_READY} <button type="button" className="readToggle" onClick={load}><RotateCcw size={14} aria-hidden="true" />다시 시도</button></p></div>;

  const n = bodyLength(cleanBody(text));
  let prevDay = '';
  return <div className="chatShell" ref={shellRef}>
    {link !== 'live' && phase === 'ready' && <p className="chatConn" role="status">{link === 'connecting' ? '연결 중' : '연결이 끊겨 다시 연결하는 중'}</p>}
    <div className="chatList" ref={listRef} onScroll={onScroll} aria-busy={phase === 'loading'}>
      {phase === 'loading' && <p className="chatEmpty">불러오는 중입니다…</p>}
      {phase === 'ready' && hasMore && <button type="button" className="readToggle chatOlder" onClick={loadOlder} disabled={older}>{older ? '불러오는 중…' : '이전 글 더 보기'}</button>}
      {phase === 'ready' && !msgs.length && !out.length && <p className="chatEmpty">아직 글이 없습니다.</p>}
      <ol className="chatMsgs" aria-label="채팅 글" aria-live="polite" aria-relevant="additions">
        {msgs.map(m => {
          const day = dayKey(m.created_at);
          const sep = day !== prevDay; prevDay = day;
          const mine = m.user_id === me, gone = isDeleted(m);
          return <Fragment key={m.id}>
            {sep && <li className="chatDay" aria-hidden="false"><span>{dayLabel(m.created_at)}</span></li>}
            <li className={'msg' + (mine ? ' mine' : '') + (gone ? ' gone' : '')} data-id={m.id}>
              <div className="msgHead"><b className="msgWho">{m.author_name}</b><time dateTime={m.created_at}>{timeLabel(m.created_at)}</time>
                {mine && !gone && readLabel(counts.get(m.id), reads) && <span className="msgRead">{readLabel(counts.get(m.id), reads)}</span>}
                {canDelete(m, me, admin) && (removing === m.id ? <span className="msgState">지우는 중</span> : confirm === m.id
                  ? <span className="msgConfirm">지울까요? <button type="button" className="msgAct danger" onClick={() => remove(m.id)}>삭제</button><button type="button" className="msgAct" onClick={() => setConfirm(null)}>취소</button></span>
                  : <button type="button" className="msgAct" onClick={() => { setConfirm(m.id); setDelNote(null); }}>삭제</button>)}
              </div>
              {gone ? <p className="msgBody muted">{DELETED_TEXT}</p> : <>
                {m.body && <p className="msgBody">{m.body}</p>}
                {m.article && <ArticleChip a={m.article} />}
              </>}
              {delNote?.id === m.id && <p className="msgFail">{delNote.text}</p>}
            </li>
          </Fragment>;
        })}
        {out.map(o => <li key={o.key} className={'msg mine pending' + (o.state === 'failed' ? ' failed' : '')}>
          <div className="msgHead">{o.state === 'sending' ? <span className="msgState">보내는 중</span> : <span className="msgFail" role="alert">전송 실패{failNote(o) ? ` — ${failNote(o)}` : ''}</span>}
            {o.state === 'failed' && <><button type="button" className="msgAct" onClick={() => retry(o)}>다시 보내기</button><button type="button" className="msgAct" onClick={() => setOut(x => x.filter(y => y.key !== o.key))}>지우기</button></>}
          </div>
          {o.body && <p className="msgBody">{o.body}</p>}
          {o.article && <ArticleChip a={o.article} />}
        </li>)}
      </ol>
      {unseen > 0 && <button type="button" className="chatNew" onClick={toBottom}>새 글 {unseen}건<ArrowDown size={15} aria-hidden="true" /></button>}
    </div>
    <form className="chatForm" onSubmit={e => { e.preventDefault(); send(); }}>
      {picking && <ChatAttach uid={me} onClose={() => { setPicking(false); inputRef.current?.focus(); }} onPick={a => { setAttach(a); setPicking(false); inputRef.current?.focus(); }} />}
      {attach && <div className="chatAttached"><ArticleChip a={attach} /><button type="button" className="iconBtn" aria-label="첨부 떼기" onClick={() => setAttach(null)}><X size={18} aria-hidden="true" /></button></div>}
      <div className="chatInputRow">
        <button type="button" className="readToggle chatAttachBtn" aria-expanded={picking} onClick={() => setPicking(p => !p)}><Newspaper size={16} aria-hidden="true" /><span>기사 첨부</span></button>
        <textarea ref={inputRef} className="chatInput" rows={1} value={text} placeholder="글 쓰기" aria-label="글 쓰기"
          onChange={e => { setText(e.target.value); if (note) setNote(''); }} onKeyDown={onKeyDown} enterKeyHint="send" />
        <button type="submit" className="confirm chatSend" aria-label="보내기" disabled={!canSend(text, !!attach)}><Send size={17} aria-hidden="true" /></button>
      </div>
      {(note || n >= COUNT_FROM) && <p className="chatHint">{note && <span className="msgFail">{note}</span>}{n >= COUNT_FROM && <span className={'chatCount' + (n > BODY_MAX ? ' over' : '')}>{n}/{BODY_MAX}</span>}</p>}
    </form>
  </div>;
}
