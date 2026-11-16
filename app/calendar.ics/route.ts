// 구독용 iCal(/calendar.ics): 빌드 때 data/calendar/auto.json + calendar/manual.json 으로 만드는 정적 파일(수집 뒤 배포마다 갱신).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeEvents, parseEvents, toIcs } from '../../lib/calendar';
import { MANUAL_EVENTS } from '../../lib/calendarManual';

export const dynamic = 'force-static';

export function GET() {
  let auto: unknown = null;
  try { auto = JSON.parse(readFileSync(join(process.cwd(), 'data', 'calendar', 'auto.json'), 'utf8')); } catch { /* 아직 수집 전 */ }
  const body = toIcs(mergeEvents(parseEvents(auto), MANUAL_EVENTS), Date.now());
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
