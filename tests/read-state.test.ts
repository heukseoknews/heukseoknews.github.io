import assert from 'node:assert/strict';
import { HARD_LIMIT, SOFT_LIMIT, addRead, migrateReads, pruneReads, removeRead } from '../lib/readState.ts';

// 예전 형식(readIds 배열) 이전: 순서 보존, readAt 우선
const m = migrateReads({ readIds: ['x', 'y', 'z'] });
assert.deepEqual(Object.keys(m), ['x', 'y', 'z']);
assert.ok(m.x < m.y && m.y < m.z);
assert.deepEqual(migrateReads({ readAt: { a: '2026-11-04T00:00:00Z' }, readIds: ['q'] }), { a: '2026-11-04T00:00:00Z' });
assert.deepEqual(migrateReads({}), {});

// 추가/취소는 멱등
let r = addRead({}, 'a', '2026-11-04T01:00:00Z');
assert.equal(addRead(r, 'a', '2026-11-05T00:00:00Z'), r, '이미 읽은 건 시각을 바꾸지 않음');
assert.deepEqual(removeRead(r, 'a'), {});
assert.equal(removeRead(r, 'nope'), r);

// 한도 이내면 그대로
const small = { a: '2026-11-01T00:00:00Z' };
assert.equal(pruneReads(small, '2026-11-02T00:00:00Z'), small);

const mk = (n: number, startMs: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`id${startMs}_${i}`, new Date(startMs + i * 1000).toISOString()]));
const baseline = '2026-11-04T00:00:00.000Z';
const baseMs = Date.parse(baseline);

// 한도 초과 시 확인 이전에 읽은 것(오래된 순)부터 지우고, 확인 이후 읽은 기록은 전부 보호한다
const oldReads = mk(1000, baseMs - 2000 * 1000);          // 확인 이전 1000건
const newReads = mk(800, baseMs + 1000);                    // 확인 이후 800건(새 뉴스 범위)
const pruned = pruneReads({ ...oldReads, ...newReads }, baseline);
assert.equal(Object.keys(pruned).length, SOFT_LIMIT);       // 1800 → 1500
assert.ok(Object.keys(newReads).every(id => id in pruned), '새 뉴스 범위 읽음 기록은 모두 보존');
const droppedOld = Object.keys(oldReads).filter(id => !(id in pruned));
assert.equal(droppedOld.length, 300);
assert.ok(droppedOld.every(id => oldReads[id] <= oldReads[Object.keys(oldReads)[299]]), '오래된 것부터 삭제');

// 확인 이후 읽음이 SOFT 를 넘어도 보호(읽은 기사가 새 뉴스로 되돌아오지 않음)
const manyNew = mk(SOFT_LIMIT + 300, baseMs + 1000);
assert.equal(pruneReads(manyNew, baseline), manyNew, 'SOFT~HARD 사이는 새 뉴스 범위 기록 보호');
// 기준 시각이 없으면(첫 방문) 전부 새 뉴스 범위로 보호
assert.equal(pruneReads(manyNew, null), manyNew);
// 보호 대상이 HARD 를 넘으면 가장 오래된 것부터 지워 저장 용량을 제한
const huge = mk(HARD_LIMIT + 50, baseMs + 1000);
const capped = pruneReads(huge, baseline);
assert.equal(Object.keys(capped).length, HARD_LIMIT);
assert.ok(!(Object.keys(huge)[0] in capped) && Object.keys(huge).at(-1)! in capped);
console.log('read-state tests passed');
