import assert from 'node:assert/strict';
import { addDays, countByDate, dayHeading, kstDate, monthGrid, shiftMonth, todayKst, weekRange } from '../lib/dates.ts';

// KST 경계: 2026-11-03T15:00Z = 11/4 00:00 KST
assert.equal(kstDate('2026-11-03T14:59:59+00:00'), '2026-11-03');
assert.equal(kstDate('2026-11-03T15:00:00+00:00'), '2026-11-04');
assert.equal(kstDate('2026-10-31T16:00:00+00:00'), '2026-11-01'); // 월 경계(UTC 10월 → KST 11월)
assert.equal(todayKst(new Date('2026-11-04T20:00:00Z')), '2026-11-05');
assert.equal(dayHeading('2026-11-04'), '11월 4일 (수)');
assert.equal(addDays('2026-11-01', -1), '2026-10-31');
assert.deepEqual(weekRange('2026-11-04'), ['2026-11-02', '2026-11-08']); // 월~일
assert.deepEqual(weekRange('2026-11-08'), ['2026-11-02', '2026-11-08']); // 일요일은 그 주 마지막
assert.deepEqual(countByDate([{ published_at: '2026-11-03T14:00:00Z' }, { published_at: '2026-11-03T16:00:00Z' }, { published_at: '2026-11-04T01:00:00Z' }]), { '2026-11-03': 1, '2026-11-04': 2 });
const g = monthGrid('2026-11'); // 2026-11-01 = 일요일
assert.equal(g[0][0], '2026-11-01');
assert.equal(g.flat().filter(Boolean).length, 30);
assert.ok(g.every(w => w.length === 7));
assert.equal(shiftMonth('2026-12', 1), '2027-01');
assert.equal(shiftMonth('2026-01', -1), '2025-12');
console.log('dates tests passed');
