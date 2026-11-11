import assert from 'node:assert/strict';
import { matchSources, sourceOptions } from '../lib/sources.ts';

const items = [{ source: '보험매일' }, { source: '보험매일' }, { source: '한국경제' }, { source: '이데일리' }, { source: '이데일리' }, { source: '뉴시스' }, { source: '보험매일' }];
// 기사 수 많은 순, 같으면 가나다순
assert.deepEqual(sourceOptions(items), [
  { name: '보험매일', count: 3 }, { name: '이데일리', count: 2 }, { name: '뉴시스', count: 1 }, { name: '한국경제', count: 1 },
]);
// 선택된 언론사는 현재 조건에서 0건이어도 목록에 남는다(해제할 수 있어야 함)
assert.deepEqual(sourceOptions(items, ['연합뉴스']).at(-1), { name: '연합뉴스', count: 0 });
// 선택 없으면 전체, 여러 개 선택하면 그 중 하나(OR)
assert.equal(matchSources(items, []).length, 7);
assert.equal(matchSources(items, ['보험매일']).length, 3);
assert.equal(matchSources(items, ['보험매일', '뉴시스']).length, 4);
assert.equal(matchSources(items, ['없는매체']).length, 0);
console.log('sources tests passed');
