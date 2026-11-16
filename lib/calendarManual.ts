/** 수동 입력 일정(calendar/manual.json). 빌드 때 번들에 들어간다(형식이 틀린 항목은 버림, lib/calendar.ts parseEvents). */
import raw from '../calendar/manual.json';
import { parseEvents } from './calendar';

export const MANUAL_EVENTS = parseEvents(raw);
