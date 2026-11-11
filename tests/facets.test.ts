import assert from 'node:assert/strict';
import { facetOptions, groupOptions, matchesFacet } from '../lib/facets.ts';

type A = { source: string; companies?: string[]; orgs?: string[] };
const arts: A[] = [
  { source: '보험매일', companies: ['삼성화재', 'DB손해보험'], orgs: ['금융감독원'] },
  { source: '한국경제', companies: ['삼성화재'] },
  { source: '보험저널', companies: ['한화생명'], orgs: ['금융감독원', '금융위원회'] },
  { source: '보험저널' },            // 필드 없음(예전 기사)
];
const co = (a: A) => a.companies ?? [];
const org = (a: A) => a.orgs ?? [];
const grp = (n: string) => ({ 삼성화재: '손해보험', DB손해보험: '손해보험', 한화생명: '생명보험' } as Record<string, string>)[n];

// 옵션: 기사 수 많은 순(같으면 이름순), 한 기사 안의 중복은 한 번, 그룹 표기
const o = facetOptions(arts, co, [], grp);
assert.deepEqual(o.map(x => [x.name, x.count]), [['삼성화재', 2], ['한화생명', 1], ['DB손해보험', 1]]);
assert.equal(o[0].group, '손해보험');
// 선택한 항목은 건수가 0이어도 남는다(해제할 수 있게)
assert.deepEqual(facetOptions(arts, co, ['코리안리']).find(x => x.name === '코리안리'), { name: '코리안리', count: 0, group: undefined });
// 그룹 순서, 그룹 없는 옵션은 마지막 '기타'
const g = groupOptions([...o, { name: '캐노피우스', count: 1 }], ['생명보험', '손해보험']);
assert.deepEqual(g.map(x => x.group), ['생명보험', '손해보험', '기타']);
assert.deepEqual(groupOptions(o, []).length, 1);

// 매칭: 빈 선택 = 전체, 여러 개 = OR, 필드 없는 기사는 선택 시 제외
assert.equal(arts.filter(a => matchesFacet(a, co, [])).length, 4);
assert.equal(arts.filter(a => matchesFacet(a, co, ['삼성화재'])).length, 2);
assert.equal(arts.filter(a => matchesFacet(a, co, ['삼성화재', '한화생명'])).length, 3);
assert.equal(arts.filter(a => matchesFacet(a, org, ['금융위원회'])).length, 1);
// 다른 필터와 AND(교집합)
const both = arts.filter(a => matchesFacet(a, co, ['삼성화재']) && matchesFacet(a, org, ['금융감독원']));
assert.deepEqual(both.map(a => a.source), ['보험매일']);
// 조합 결과 0건: 보험사 한화생명 AND 기관 없음 조합
assert.equal(arts.filter(a => matchesFacet(a, co, ['삼성화재']) && matchesFacet(a, org, ['금융위원회'])).length, 0);
// 드롭다운 건수는 자기 자신만 뺀 나머지 조건 기준: 기관=금융감독원 일 때 보험사 옵션
const withOrg = arts.filter(a => matchesFacet(a, org, ['금융감독원']));
assert.deepEqual(facetOptions(withOrg, co).map(x => [x.name, x.count]), [['삼성화재', 1], ['한화생명', 1], ['DB손해보험', 1]]);
console.log('facets tests passed');
