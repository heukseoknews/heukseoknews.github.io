/** 채널 레지스트리. 채널을 추가하면 channels/<slug>/ 설정 파일을 만들고 아래 CHANNELS 에 한 줄 등록한다
 *  (정적 빌드라 설정 JSON 을 빌드 시점에 import 해야 한다). 테스트(tests/channels.test.ts)가 폴더와 등록이 맞는지 확인한다. */
import insuranceMeta from '../channels/insurance/channel.json';
import insuranceTheme from '../channels/insurance/theme.json';
import insuranceCategories from '../channels/insurance/categories.json';
import insuranceCompanies from '../channels/insurance/companies.json';
import insuranceOrgs from '../channels/insurance/orgs.json';
import aiMeta from '../channels/ai/channel.json';
import aiTheme from '../channels/ai/theme.json';
import aiCategories from '../channels/ai/categories.json';
import aiCompanies from '../channels/ai/companies.json';
import aiOrgs from '../channels/ai/orgs.json';
import { categoryList } from './categories';
import { type ChannelStatus, statusOf } from './directory';
import { groupMap } from './entities';
import { type Formatters, makeFormatters } from './format';

export type TabId = 'new' | 'all' | 'press' | 'bookmarks';
export type FilterId = 'sources' | 'companies' | 'orgs';
export type ChannelMeta = {
  slug: string; name: string; subtitle: string; description: string; locale: string; timezone: string;
  /** 수집 시각(UTC cron). .github/workflows/deploy.yml 의 schedule 중 하나여야 한다(tests/channels.test.ts). */
  schedule_utc: string[];
  tabs: Record<TabId, string>; filters: Record<FilterId, string>;
  storage?: { legacy_keys?: { saved?: string; companies?: string } };
  /** false 면 워크플로가 이 채널을 수집하지 않는다(설정만 준비된 상태). */
  collect?: boolean;
};
type Named = { name: string; group: string };
export type Channel = ChannelMeta & Formatters & {
  /** live = 공개(링크·색인), soon = 준비 중(페이지는 있으나 링크 없음·noindex). lib/directory.ts 에서 정한다. */
  status: ChannelStatus;
  themeVars: Record<string, string>;
  categories: string[];
  companyGroup: Record<string, string>; companyGroups: string[];
  orgGroup: Record<string, string>; orgGroups: string[];
};

function build(meta: ChannelMeta, theme: { vars?: Record<string, string> }, categories: { categories: Record<string, unknown> },
  companies: { companies: Named[]; groups: string[] }, orgs: { orgs: Named[]; groups: string[] }): Channel {
  return {
    ...meta, ...makeFormatters(meta.locale, meta.timezone), status: statusOf(meta.slug), themeVars: theme.vars ?? {},
    categories: categoryList(categories),
    companyGroup: groupMap(companies.companies), companyGroups: companies.groups,
    orgGroup: groupMap(orgs.orgs), orgGroups: orgs.groups,
  };
}

export const CHANNELS: Channel[] = [
  build(insuranceMeta as ChannelMeta, insuranceTheme, insuranceCategories, insuranceCompanies, insuranceOrgs),
  build(aiMeta as ChannelMeta, aiTheme, aiCategories, aiCompanies as { companies: Named[]; groups: string[] }, aiOrgs),  // 준비 중(soon)
];
/** 정적 페이지는 CHANNELS 전부 만든다. 홈 카드·채널 이동 줄은 lib/directory.ts(DIRECTORY, channelRow). */
/** 검색 색인 제외 메타(준비 중 채널) */
export const robotsFor = (c: Channel) => (c.status === 'live' ? {} : { robots: { index: false, follow: false } });
export const DEFAULT_CHANNEL = 'insurance';
export const getChannel = (slug: string): Channel | undefined => CHANNELS.find(c => c.slug === slug);
/** 채널 안 경로: channelHref('insurance', 'week/') → '/insurance/week/' */
export const channelHref = (slug: string, sub = '') => `/${slug}/${sub}`;
