import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_FILTER, type CalEvent, dday, endMs, filterEvents, fmtKst, fmtRange, foldLine, groupByWeek, isPast, mergeEvents, origTime, parseEvents, parseStatus, toIcs,
} from '../lib/calendar.ts';

const NOW = Date.parse('2026-11-16T03:00:00Z');   // 한국 11-16(월) 12:00
const ev = (id: string, x: Partial<CalEvent> = {}): CalEvent => ({ id, title: `일정 ${id}`, org: '기관', kind: 'exam', channel: 'insurance',
  start: '2026-11-20', link: 'https://example.org/x', source: 'manual', checked: '2026-11-16', ...x });

// ───── 읽기: 형식이 틀린 항목은 버림 ─────
const parsed = parseEvents({ events: [ev('ok'), { ...ev('bad-kind'), kind: 'party' }, { ...ev('bad-date'), start: '11/20' }, { ...ev('bad-link'), link: 'javascript:x' },
  { ...ev('no-checked'), checked: '' }, null, { ...ev('tz'), start: '2027-01-28T23:59:59-12:00', tz: 'AoE' }] });
assert.deepEqual(parsed.map(e => e.id), ['ok', 'tz']);
assert.deepEqual(parseEvents(null), []);
assert.deepEqual(parseEvents([ev('arr')]).map(e => e.id), ['arr'], '배열도 받음');

// ───── 수동 + 자동 합치기: 같은 id 는 수동이 이김, 시각순 ─────
const auto = [ev('a', { start: '2026-12-01', source: 'kidi' }), ev('dup', { title: '자동', start: '2026-11-25', source: 'kidi' })];
const manual = [ev('dup', { title: '수동', start: '2026-11-25' }), ev('m', { start: '2026-11-18' })];
const all = mergeEvents(auto, manual);
assert.deepEqual(all.map(e => e.id), ['m', 'dup', 'a']);
assert.equal(all.find(e => e.id === 'dup')!.title, '수동');

// ───── 지난 일정 숨김(하루 종일은 그날 끝까지, 기간은 끝 기준) ─────
assert.equal(isPast(ev('today', { start: '2026-11-16' }), NOW), false, '오늘(하루 종일)은 아직');
assert.equal(isPast(ev('yday', { start: '2026-11-15' }), NOW), true);
assert.equal(isPast(ev('range', { start: '2026-11-10', end: '2026-11-20T18:00:00+09:00' }), NOW), false, '기간이 끝나지 않으면 아직');
assert.equal(isPast(ev('aoe', { start: '2026-11-15T23:59:59-12:00', tz: 'AoE' }), NOW), false, 'AoE 11-15 23:59 = 한국 11-16 20:59 — 아직');
assert.equal(isPast(ev('aoe2', { start: '2026-11-14T23:59:59-12:00', tz: 'AoE' }), NOW), true, 'AoE 11-14 23:59 = 한국 11-15 20:59 — 지남');
const list = [ev('old', { start: '2026-11-01' }), ev('next', { start: '2026-11-18' }), ev('ai', { start: '2026-11-19', channel: 'ai', kind: 'conf' }),
  ev('job', { start: '2026-11-30', channel: 'finance', kind: 'job' })];
assert.deepEqual(filterEvents(list, DEFAULT_FILTER, NOW).map(e => e.id), ['next', 'ai', 'job'], '기본: 지난 일정 숨김');
assert.deepEqual(filterEvents(list, { ...DEFAULT_FILTER, showPast: true }, NOW).map(e => e.id), ['old', 'next', 'ai', 'job']);

// ───── 필터: 채널·종류 ─────
assert.deepEqual(filterEvents(list, { ...DEFAULT_FILTER, channels: ['ai'] }, NOW).map(e => e.id), ['ai']);
assert.deepEqual(filterEvents(list, { ...DEFAULT_FILTER, kinds: ['exam', 'job'] }, NOW).map(e => e.id), ['next', 'job']);
assert.deepEqual(filterEvents(list, { ...DEFAULT_FILTER, channels: ['finance'], kinds: ['exam'] }, NOW).map(e => e.id), []);
assert.deepEqual(filterEvents(list, { channels: [], kinds: [], showPast: false }, NOW).map(e => e.id), ['next', 'ai', 'job'], '모두 끄면 전체로 본다');

// ───── D-day(한국 날짜) ─────
assert.equal(dday(ev('t', { start: '2026-11-16' }), NOW), 'D-day');
assert.equal(dday(ev('t', { start: '2026-11-18' }), NOW), 'D-2');
assert.equal(dday(ev('t', { start: '2026-11-17T08:00:00+09:00' }), NOW), 'D-1');
assert.equal(dday(ev('t', { start: '2026-11-10', end: '2026-11-20' }), NOW), '진행 중');
assert.equal(dday(ev('t', { start: '2026-11-01' }), NOW), '지남');
// AoE 마감은 한국 시각으로 하루 늦게 끝난다: AoE 11-16 23:59 = 한국 11-17 20:59 → D-1
assert.equal(dday(ev('aoe', { start: '2026-11-16T23:59:59-12:00', tz: 'AoE' }), NOW), 'D-1');

// ───── 주 단위 묶기(월요일 시작), 진행 중은 이번 주 ─────
const weeks = groupByWeek([ev('w1', { start: '2026-11-16' }), ev('w1b', { start: '2026-11-22' }), ev('w2', { start: '2026-11-23' }),
  ev('ongoing', { start: '2026-11-02', end: '2026-11-30' })], NOW);
assert.deepEqual(weeks.map(w => [w.monday, w.sunday, w.events.map(e => e.id)]), [
  ['2026-11-16', '2026-11-22', ['w1', 'w1b', 'ongoing']],
  ['2026-11-23', '2026-11-29', ['w2']],
]);

// ───── 시간 표시: 한국 시각 + 원래 시간대 ─────
const aoe = ev('aoe', { start: '2027-01-28T23:59:59-12:00', tz: 'AoE' });
assert.equal(fmtKst(aoe.start), '1.29(금) 20:59');
assert.equal(origTime(aoe), '원래 1.28 23:59 AoE');
assert.equal(origTime(ev('k', { start: '2026-02-24T09:30:00+09:00', tz: 'KST' })), null, '한국 시각이면 원래 시간대 표시 없음');
assert.equal(origTime(ev('d', { start: '2027-07-10', tz: 'AoE' })), null, '날짜만이면 없음');
assert.equal(fmtKst('2026-11-21'), '11.21(토)');
assert.equal(fmtRange(ev('r', { start: '2026-02-24T09:30:00+09:00', end: '2026-02-27T18:00:00+09:00' })), '2.24(화) 09:30 ~ 2.27(금) 18:00');
assert.equal(fmtRange(ev('r', { start: '2026-11-21T10:00:00+09:00', end: '2026-11-21T15:00:00+09:00' })), '11.21(토) 10:00~15:00');
assert.equal(endMs(ev('d', { start: '2026-11-16' })), Date.parse('2026-11-17T00:00:00+09:00') - 1);

// ───── iCal ─────
const ics = toIcs([aoe, ev('day', { start: '2026-11-21', title: '쉼표, 세미콜론; 포함' }), ev('rng', { start: '2026-07-10', end: '2026-07-15' })], NOW);
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
assert.ok(ics.includes('DTSTART:20270129T115959Z'), 'AoE → UTC');
assert.ok(ics.includes('DTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261122'), '하루 종일은 다음 날까지');
assert.ok(ics.includes('DTSTART;VALUE=DATE:20260710\r\nDTEND;VALUE=DATE:20260716'));
assert.ok(ics.includes('쉼표\\, 세미콜론\\; 포함'), '특수 문자 이스케이프');
assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `75바이트 이하: ${line}`);
assert.equal(foldLine('가'.repeat(40)).split('\r\n ').join(''), '가'.repeat(40), '접어도 글자가 깨지지 않음');

// ───── 수집 상태 ─────
assert.deepEqual(parseStatus({ sources: { kidi: { ok: false, last_success_at: '2026-11-15T19:00:00+00:00', last_error_at: '2026-11-16T19:00:00+00:00' },
  ccfddl: { ok: true, last_success_at: '2026-11-16T19:00:00+00:00' } } }), [
  { id: 'kidi', ok: false, lastSuccessAt: '2026-11-15T19:00:00+00:00', lastErrorAt: '2026-11-16T19:00:00+00:00' },
  { id: 'ccfddl', ok: true, lastSuccessAt: '2026-11-16T19:00:00+00:00', lastErrorAt: null },
]);
assert.deepEqual(parseStatus(null), []);

// ───── 수동 파일: 모든 항목이 형식에 맞고, 저장 필드만, 공식 링크 ─────
const manualRaw = JSON.parse(readFileSync('calendar/manual.json', 'utf8')).events as Record<string, unknown>[];
assert.equal(parseEvents(manualRaw).length, manualRaw.length, '수동 일정은 모두 형식에 맞아야 한다');
for (const e of manualRaw) {
  assert.ok(Object.keys(e).every(k => ['id', 'title', 'org', 'kind', 'channel', 'start', 'end', 'tz', 'link', 'source', 'checked'].includes(k)), `${e.id}: 저장 필드만`);
  assert.ok(String(e.link).startsWith('https://') && e.source === 'manual', `${e.id}`);
}
assert.equal(new Set(manualRaw.map(e => e.id)).size, manualRaw.length, 'id 중복 없음');

// ───── 화면: 헤더 메뉴 연결·포털 색·안내 문구 ─────
assert.ok(readFileSync('components/SiteHeader.tsx', 'utf8').includes("link(CALENDAR, '일정')"));
const page = readFileSync('app/calendar/page.tsx', 'utf8');
assert.ok(!/themeCss|themeVars|<style/.test(page), '일정 화면은 채널 색을 넣지 않음(포털 공통 색)');
assert.ok(page.includes('{NOTICE}'));
assert.ok(page.includes('https://github.com/ccfddl/ccf-deadlines') && page.includes('MIT 라이선스'), 'ccfddl 출처(MIT) 표기');
console.log('calendar tests passed');
