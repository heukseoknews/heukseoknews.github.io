import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatBuild, triggerLabel } from '../lib/version.ts';
// @ts-ignore 순수 JS 스크립트
import { dataCollectedAt, toKstIso } from '../scripts/make-version.mjs';

assert.equal(toKstIso(new Date('2026-11-05T05:02:11Z')), '2026-11-05T14:02:11+09:00');
assert.equal(toKstIso(new Date('2026-11-04T16:00:00Z')), '2026-11-05T01:00:00+09:00'); // 날짜 경계
assert.equal(formatBuild('2026-11-05T14:02:11+09:00'), '2026.11.05 14:02');
assert.equal(formatBuild('이상한 값'), '이상한 값');
assert.equal(triggerLabel('schedule'), '예약 수집'); assert.equal(triggerLabel('x'), 'x');

const d = mkdtempSync(join(tmpdir(), 'ver-'));
const f = join(d, 'status.json');
writeFileSync(f, JSON.stringify({ last_run: { finished_at: 'F' }, sources: { a: { last_success_at: '2026-11-05T03:00:00Z' }, b: { last_success_at: '2026-11-05T04:00:00Z' }, c: { last_success_at: null } } }));
assert.equal(dataCollectedAt(f), '2026-11-05T04:00:00Z');         // 소스별 최신 성공 시각
writeFileSync(f, JSON.stringify({ last_run: { finished_at: 'F' }, sources: { c: { last_success_at: null } } }));
assert.equal(dataCollectedAt(f), 'F');                             // 성공 기록이 없으면 last_run
assert.equal(dataCollectedAt(join(d, 'none.json')), null);         // 파일 없음
console.log('version tests passed');
