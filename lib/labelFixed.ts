/** /label/ 채널별 고정 표본(기사 id 만). 한 번 정한 목록이라 갱신하지 않는다(lib/label.ts queueFor). */
import insurance from './label-fixed/insurance.json';
import ai from './label-fixed/ai.json';
import finance from './label-fixed/finance.json';

export const LABEL_FIXED: Record<string, readonly string[]> = { insurance, ai, finance };
