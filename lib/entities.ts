import companiesCfg from '../config/companies.json';
import orgsCfg from '../config/orgs.json';

/** 보험사·유관기관 드롭다운의 그룹(config/companies.json, config/orgs.json). 이름 → 그룹, 그룹 표시 순서. */
export const COMPANY_GROUP: Record<string, string> = Object.fromEntries(companiesCfg.companies.map(c => [c.name, c.group]));
export const COMPANY_GROUPS: string[] = companiesCfg.groups;
export const ORG_GROUP: Record<string, string> = Object.fromEntries(orgsCfg.orgs.map(o => [o.name, o.group]));
export const ORG_GROUPS: string[] = orgsCfg.groups;
