/** 채용·시험 일정 캘린더(/calendar/)의 순수 로직: 읽기·합치기·거르기·주 단위 묶기·D-day·시간 표시·iCal.
 *  자동 수집 data/calendar/auto.json(collector/calendar_collect.py) + 수동 입력 calendar/manual.json 을 합쳐 보여 준다(docs/calendar.md).
 *  날짜 값: 'YYYY-MM-DD'(하루 종일, 한국 날짜) 또는 시간대가 붙은 ISO('2027-01-28T23:59:59-12:00' — 원래 시간대의 벽시계 그대로). */

export type CalKind = 'exam' | 'job' | 'conf' | 'admission';
export type CalChannel = 'finance' | 'insurance' | 'ai';
export type CalEvent = {
  id: string; title: string; org: string; kind: CalKind; channel: CalChannel;
  start: string; end?: string; tz?: string; link: string; source: string; checked: string;
};
export const KINDS: CalKind[] = ['exam', 'job', 'conf', 'admission'];
export const KIND_LABEL: Record<CalKind, string> = { exam: '시험', job: '채용', conf: '학회 마감', admission: '입시' };
export const CAL_CHANNELS: CalChannel[] = ['finance', 'insurance', 'ai'];
export const CHANNEL_LABEL: Record<CalChannel, string> = { finance: '금융', insurance: '보험', ai: 'AI' };
/** 채널 뜻(필터 툴팁) */
export const CHANNEL_NOTE: Record<CalChannel, string> = {
  finance: '은행 취업·금융 자격시험', insurance: '계리사·보험 시험과 보험사 채용', ai: '학회 마감과 대학원 입시',
};
export const NOTICE = '일정은 바뀔 수 있으니 공식 사이트에서 다시 확인하세요.';

const DAY = 86_400_000;
const KST_MS = 9 * 3_600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
const isDateish = (s: unknown): s is string => typeof s === 'string' && (DATE_RE.test(s) || (ISO_RE.test(s) && !Number.isNaN(Date.parse(s))));
const isSafeLink = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\/[^\s"<>]+$/.test(s);

/** 파일 내용 → 일정(형식이 맞지 않는 항목은 버린다). { events: [...] } 또는 배열 */
export function parseEvents(raw: unknown): CalEvent[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : [];
  const out: CalEvent[] = [];
  for (const r of list) {
    const e = r as Partial<CalEvent> | null;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.id !== 'string' || !e.id || typeof e.title !== 'string' || !e.title || typeof e.org !== 'string') continue;
    if (!KINDS.includes(e.kind as CalKind) || !CAL_CHANNELS.includes(e.channel as CalChannel)) continue;
    if (!isDateish(e.start) || (e.end != null && !isDateish(e.end)) || !isSafeLink(e.link)) continue;
    if (typeof e.checked !== 'string' || !DATE_RE.test(e.checked)) continue;
    out.push({ id: e.id, title: e.title, org: e.org, kind: e.kind as CalKind, channel: e.channel as CalChannel, start: e.start,
      ...(e.end ? { end: e.end } : {}), ...(typeof e.tz === 'string' && e.tz ? { tz: e.tz } : {}), link: e.link,
      source: typeof e.source === 'string' ? e.source : 'manual', checked: e.checked });
  }
  return out;
}

/** 시각(ms). 하루 종일 날짜는 한국 시각 그날 0시(끝이면 다음 날 0시 직전) */
export function instant(s: string, endOfDay = false): number {
  if (DATE_RE.test(s)) return Date.parse(`${s}T00:00:00+09:00`) + (endOfDay ? DAY - 1 : 0);
  return Date.parse(s);
}
export const startMs = (e: CalEvent) => instant(e.start);
export const endMs = (e: CalEvent) => instant(e.end ?? e.start, true);
export const kstDateOf = (ms: number) => new Date(ms + KST_MS).toISOString().slice(0, 10);

/** 자동 + 수동 합치기: 같은 id 면 수동이 이긴다. 시작 시각 → id 순 */
export function mergeEvents(auto: CalEvent[], manual: CalEvent[]): CalEvent[] {
  const m = new Map<string, CalEvent>();
  for (const e of auto) m.set(e.id, e);
  for (const e of manual) m.set(e.id, e);
  return [...m.values()].sort((a, b) => startMs(a) - startMs(b) || a.id.localeCompare(b.id));
}

/** 지난 일정: 끝(없으면 시작, 하루 종일이면 그날 끝)이 지금보다 앞 */
export const isPast = (e: CalEvent, nowMs: number) => endMs(e) < nowMs;

export type CalFilter = { channels: CalChannel[]; kinds: CalKind[]; showPast: boolean };
export const DEFAULT_FILTER: CalFilter = { channels: [...CAL_CHANNELS], kinds: [...KINDS], showPast: false };
/** 거르기: 고른 채널·종류만, 지난 일정은 showPast 일 때만. 비어 있는 선택은 '전체'로 본다 */
export function filterEvents(events: CalEvent[], f: CalFilter, nowMs: number): CalEvent[] {
  const ch = new Set(f.channels.length ? f.channels : CAL_CHANNELS), kd = new Set(f.kinds.length ? f.kinds : KINDS);
  return events.filter(e => ch.has(e.channel) && kd.has(e.kind) && (f.showPast || !isPast(e, nowMs)));
}

/** D-day: 앞으로면 'D-n'(오늘이면 'D-day'), 진행 중(시작은 지났고 끝이 남음)이면 '진행 중', 지났으면 '지남'. 한국 날짜 기준 */
export function dday(e: CalEvent, nowMs: number): string {
  if (isPast(e, nowMs)) return '지남';
  const today = Date.parse(`${kstDateOf(nowMs)}T00:00:00+09:00`);
  const startDay = Date.parse(`${kstDateOf(startMs(e))}T00:00:00+09:00`);
  if (startMs(e) <= nowMs && e.end) return '진행 중';
  const n = Math.round((startDay - today) / DAY);
  return n <= 0 ? 'D-day' : `D-${n}`;
}

/** 주 단위 묶기(월요일 시작, 한국 날짜). 진행 중인 일정은 이번 주에 둔다 */
export type CalWeek = { monday: string; sunday: string; events: CalEvent[] };
export function groupByWeek(events: CalEvent[], nowMs: number): CalWeek[] {
  const weeks = new Map<string, CalWeek>();
  for (const e of events) {
    const at = isPast(e, nowMs) ? startMs(e) : Math.max(startMs(e), nowMs);
    const d = kstDateOf(at);
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;     // 월=0
    const mon = kstDateOf(Date.parse(`${d}T00:00:00+09:00`) - dow * DAY);
    const sun = kstDateOf(Date.parse(`${mon}T00:00:00+09:00`) + 6 * DAY);
    const w = weeks.get(mon) ?? { monday: mon, sunday: sun, events: [] };
    w.events.push(e);
    weeks.set(mon, w);
  }
  return [...weeks.values()].sort((a, b) => a.monday.localeCompare(b.monday));
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}(${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
/** 한국 시각 표시: '11.21(토)' 또는 '1.29(금) 20:59' */
export function fmtKst(s: string): string {
  if (DATE_RE.test(s)) return md(s);
  const ms = Date.parse(s);
  return `${md(kstDateOf(ms))} ${new Date(ms + KST_MS).toISOString().slice(11, 16)}`;
}
/** 기간 표시: 시작 ~ 끝(같은 날이면 시각만) */
export function fmtRange(e: CalEvent): string {
  if (!e.end) return fmtKst(e.start);
  const a = fmtKst(e.start), b = fmtKst(e.end);
  const sameDay = !DATE_RE.test(e.start) && !DATE_RE.test(e.end) && kstDateOf(startMs(e)) === kstDateOf(endMs(e));
  return sameDay ? `${a}~${b.slice(-5)}` : `${a} ~ ${b}`;
}
/** 원래 시간대 표시(시각이 있고 한국 시각이 아닐 때만): '원래 1.28 23:59 AoE' */
export function origTime(e: CalEvent): string | null {
  if (!e.tz || e.tz === 'KST' || DATE_RE.test(e.start)) return null;
  const local = e.start.slice(0, 16);
  return `원래 ${Number(local.slice(5, 7))}.${Number(local.slice(8, 10))} ${local.slice(11, 16)} ${e.tz}`;
}

// ───────── iCal(구독용 정적 파일 /calendar.ics) ─────────
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsDate = (d: string) => d.replace(/-/g, '');
/** 줄 접기: 75바이트(UTF-8)마다 CRLF + 공백. 글자 중간에서 자르지 않는다 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
export function toIcs(events: CalEvent[], nowMs: number, host = 'heukseoknews.github.io'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${host}//calendar//KO`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:흑석일보 일정', 'X-WR-TIMEZONE:Asia/Seoul'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${icsText(e.id)}@${host}`, `DTSTAMP:${icsUtc(nowMs)}`);
    if (DATE_RE.test(e.start) && (!e.end || DATE_RE.test(e.end))) {
      const last = e.end ?? e.start;
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(kstDateOf(Date.parse(`${last}T00:00:00+09:00`) + DAY))}`);
    } else {
      lines.push(`DTSTART:${icsUtc(startMs(e))}`, `DTEND:${icsUtc(e.end ? endMs(e) : startMs(e))}`);
    }
    lines.push(`SUMMARY:${icsText(`${e.title} · ${e.org}`)}`, `URL:${e.link}`,
      `DESCRIPTION:${icsText(`${KIND_LABEL[e.kind]} · ${CHANNEL_LABEL[e.channel]} · 확인 ${e.checked}${origTime(e) ? ` · ${origTime(e)}` : ''}\n${NOTICE}`)}`,
      `CATEGORIES:${icsText(KIND_LABEL[e.kind])}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ───────── 수집 상태(data/calendar/status.json) ─────────
export type CalSourceStatus = { id: string; ok: boolean; lastSuccessAt: string | null; lastErrorAt: string | null };
export const SOURCE_LABEL: Record<string, string> = { ccfddl: '학회 마감(ccfddl)', kidi: '보험개발원 보험전문인시험' };
export function parseStatus(raw: unknown): CalSourceStatus[] {
  const src = raw && typeof raw === 'object' ? (raw as { sources?: Record<string, Record<string, unknown>> }).sources : undefined;
  if (!src || typeof src !== 'object') return [];
  return Object.entries(src).map(([id, s]) => ({
    id, ok: s?.ok === true,
    lastSuccessAt: typeof s?.last_success_at === 'string' ? s.last_success_at : null,
    lastErrorAt: s?.ok === false && typeof s?.last_error_at === 'string' ? s.last_error_at : null,
  }));
}
