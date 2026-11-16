'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';
import { ChannelProvider } from '../../lib/channelContext';
import { CHANNELS } from '../../lib/channels';
import { meChannels } from '../../lib/me';
import SiteHeader from '../../components/SiteHeader';
import Footer from '../../components/Footer';
import {
  CAL_CHANNELS, CHANNEL_LABEL, CHANNEL_NOTE, type CalEvent, type CalFilter, type CalSourceStatus,
  DEFAULT_FILTER, KINDS, KIND_LABEL, NOTICE, SOURCE_LABEL, dday, filterEvents, fmtKst, fmtRange, groupByWeek, mergeEvents, origTime, parseEvents, parseStatus,
} from '../../lib/calendar';
import { MANUAL_EVENTS } from '../../lib/calendarManual';

const LIST = meChannels(CHANNELS.map(c => c.slug));
const getJson = (p: string) => fetch(p, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

/** 일정(/calendar/): 채널과 무관한 포털 화면(색은 포털 공통 색 — 채널 theme 를 넣지 않음). 헤더는 마이페이지 틀(채널명 자리에 '일정').
 *  다가오는 일정을 주 단위로 묶어 날짜순으로, D-day·한국 시각(원래 시간대 작게)·원문 링크·확인일. 지난 일정은 기본 숨김. */
export default function CalendarPage() {
  const [auto, setAuto] = useState<CalEvent[] | null>(null);
  const [status, setStatus] = useState<CalSourceStatus[]>([]);
  const [filter, setFilter] = useState<CalFilter>(DEFAULT_FILTER);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    getJson('/data/calendar/auto.json').then(j => setAuto(parseEvents(j)));
    getJson('/data/calendar/status.json').then(j => setStatus(parseStatus(j)));
  }, []);
  const all = useMemo(() => mergeEvents(auto ?? [], MANUAL_EVENTS), [auto]);
  const shown = useMemo(() => (now === null ? [] : filterEvents(all, filter, now)), [all, filter, now]);
  const weeks = useMemo(() => (now === null ? [] : groupByWeek(shown, now)), [shown, now]);
  const ready = auto !== null && now !== null;
  const chip = (on: boolean, label: string, onClick: () => void, title?: string) =>
    <button key={label} type="button" className={'calChip' + (on ? ' on' : '')} aria-pressed={on} title={title} onClick={onClick}>{label}</button>;

  return <ChannelProvider slug={LIST[0]}>
    <SiteHeader me label="일정" />
    <main className="shell calMain" id="content">
      <div className="calHead">
        <h1><CalendarDays size={22} aria-hidden="true" /> 일정</h1>
        <a className="calIcs" href="/calendar.ics" download>캘린더 구독(.ics)</a>
      </div>
      <p className="calNotice" role="note">{NOTICE}</p>
      <div className="calFilters" role="group" aria-label="일정 필터">
        <div className="calRow"><span className="calRowLabel">채널</span>
          {CAL_CHANNELS.map(c => chip(filter.channels.includes(c), CHANNEL_LABEL[c], () => setFilter(f => ({ ...f, channels: toggle(f.channels, c) })), CHANNEL_NOTE[c]))}</div>
        <div className="calRow"><span className="calRowLabel">종류</span>
          {KINDS.map(k => chip(filter.kinds.includes(k), KIND_LABEL[k], () => setFilter(f => ({ ...f, kinds: toggle(f.kinds, k) }))))}</div>
        <label className="check"><input type="checkbox" checked={filter.showPast} onChange={e => setFilter(f => ({ ...f, showPast: e.target.checked }))} /> 지난 일정 보기</label>
      </div>
      {status.length > 0 && <p className="calStatus">자동 수집 {status.map(s => <span key={s.id}>
        {SOURCE_LABEL[s.id] ?? s.id} {s.lastSuccessAt ? `${fmtKst(s.lastSuccessAt)} 확인` : '아직 없음'}{s.lastErrorAt ? ` · 최근 실패 ${fmtKst(s.lastErrorAt)}` : ''}</span>)}</p>}
      <section className="calList" aria-live="polite">
        {!ready ? <div className="empty">일정을 불러오는 중입니다…</div>
          : weeks.length === 0 ? <div className="empty"><CalendarDays size={27} aria-hidden="true" /><b>{filter.showPast ? '조건에 맞는 일정이 없습니다.' : '다가오는 일정이 없습니다.'}</b></div>
          : weeks.map(w => <div key={w.monday} className="calWeek">
            <h2 className="calWeekHead">{fmtKst(w.monday)} ~ {fmtKst(w.sunday)}</h2>
            <ul>{w.events.map(e => { const d = dday(e, now!); const orig = origTime(e);
              return <li key={e.id} className={'calItem' + (d === '지남' ? ' past' : '')}>
                <span className={'calDday' + (d === 'D-day' || d === '진행 중' ? ' soon' : '')}>{d}</span>
                <div className="calBody">
                  <a className="calTitle" href={e.link} target="_blank" rel="noopener noreferrer">{e.title}<ExternalLink size={13} aria-hidden="true" /></a>
                  <p className="calMeta"><span>{e.org}</span><span className="pill">{KIND_LABEL[e.kind]}</span><span className="pill">{CHANNEL_LABEL[e.channel]}</span></p>
                  <p className="calWhen"><time dateTime={e.start}>{fmtRange(e)}</time>{orig && <small> · {orig}</small>}<small className="calChecked"> · 확인 {fmtKst(e.checked)}</small></p>
                </div>
              </li>; })}</ul>
          </div>)}
      </section>
      <p className="calStatus">학회 마감일 출처: <a href="https://github.com/ccfddl/ccf-deadlines" target="_blank" rel="noopener noreferrer">ccfddl/ccf-deadlines</a> (MIT 라이선스)</p>
    </main>
    <Footer />
  </ChannelProvider>;
}
