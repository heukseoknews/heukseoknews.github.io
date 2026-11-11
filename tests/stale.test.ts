import assert from 'node:assert/strict';
import { isStale } from '../lib/stale.ts';

const now = new Date('2026-11-06T00:00:00Z');
assert.equal(isStale('2026-11-04T13:06:00Z', now), false);  // 34시간 54분 경과 → 아직 아님
assert.equal(isStale('2026-11-04T12:00:00Z', now), false);  // 정확히 36h → 아직 지연 아님(초과해야 true)
assert.equal(isStale('2026-11-04T11:59:59Z', now), true);   // 36h 1초 초과
assert.equal(isStale('2026-11-05T20:00:00Z', now), false);  // 최근
assert.equal(isStale(null, now), false);                    // 값 없음/로딩 중에는 안내 없음
assert.equal(isStale('not-a-date', now), false);
assert.equal(isStale('2026-11-04T00:00:00Z', now, 72), false); // 기준 시간 변경
console.log('stale tests passed');
