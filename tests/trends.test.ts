import assert from 'node:assert/strict';
import { lastWeeks, niceMax } from '../lib/trends.ts';

const t = { generated_at: '', keywords: ['K-ICS', '금리'], total: 0, weeks: [
  { week_start: '2026-10-26', counts: { 'K-ICS': 1, '금리': 14 }, total: 53 },
  { week_start: '2026-11-02', counts: { 'K-ICS': 2, '금리': 17 }, total: 251 },
] } as any;
const w = lastWeeks(t, '2026-11-04', 4); // 이번 주 시작 = 11/2
assert.deepEqual(w.map(x => x.week_start), ['2026-10-26', '2026-11-02']); // 데이터 시작 주 앞의 빈 주는 제외
assert.equal(w[1].counts['금리'], 17);
// 중간에 기사가 없던 주는 0으로 유지
const gap = { ...t, weeks: [t.weeks[0], { week_start: '2026-11-09', counts: { 'K-ICS': 1, '금리': 1 }, total: 5 }] };
const g = lastWeeks(gap, '2026-11-10', 4);
assert.deepEqual(g.map(x => x.week_start), ['2026-10-26', '2026-11-02', '2026-11-09']);
assert.equal(g[1].total, 0);
// 12주보다 오래된 데이터는 최근 12주만
assert.equal(lastWeeks({ ...t, weeks: [{ week_start: '2026-01-05', counts: {}, total: 3 }, ...t.weeks] }, '2026-11-04', 12).length, 12);
// 데이터가 전혀 없으면 이번 주 1개
assert.equal(lastWeeks({ ...t, weeks: [] }, '2026-11-04', 12).length, 1);
assert.equal(lastWeeks(t, '2026-11-08', 1)[0].week_start, '2026-11-02'); // 일요일도 같은 주
assert.equal(niceMax(0), 5); assert.equal(niceMax(17), 20); assert.equal(niceMax(23), 30); assert.equal(niceMax(120), 150);
console.log('trends tests passed');
