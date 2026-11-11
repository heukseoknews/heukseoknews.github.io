/** 채널 목록(홈 카드·채널 이동 줄). 공개 여부는 status 하나로 정한다:
 *  - live: 홈 카드·이동 줄에서 링크, 페이지 검색 색인
 *  - soon: '준비 중'(링크 없음). 채널 폴더가 있으면 페이지는 만들되 noindex(미리 운영).
 *  채널을 열 때는 아래 status 를 'live' 로 바꾸면 된다(channels/<slug>/ 폴더가 있어야 함 — tests/channels.test.ts).
 *  설정 JSON 을 import 하지 않아 테스트에서 바로 불러온다. 채널 상세 설정은 lib/channels.ts. */
export type ChannelStatus = 'live' | 'soon';
export type DirectoryEntry = { slug: string; name: string; /** 홈 카드 한 줄 설명 */ card: string; status: ChannelStatus };

export const DIRECTORY: DirectoryEntry[] = [
  { slug: 'insurance', name: '보험', card: '보험·계리·금융시장', status: 'live' },
  { slug: 'ai', name: 'AI', card: '모델·오픈소스·정책·산업', status: 'soon' },
  { slug: 'finance', name: '금융', card: '은행·금융권 뉴스', status: 'soon' },
];

export const statusOf = (slug: string): ChannelStatus => DIRECTORY.find(d => d.slug === slug)?.status ?? 'soon';
export const isLive = (slug: string) => statusOf(slug) === 'live';

export type RowItem = DirectoryEntry & { href: string | null; current: boolean };
/** 채널 이동 줄 구성: live 채널과 지금 보는 채널만 링크, 나머지는 '준비 중'(href null). */
export function channelRow(current: string): RowItem[] {
  return DIRECTORY.map(d => ({ ...d, current: d.slug === current, href: d.status === 'live' || d.slug === current ? `/${d.slug}/` : null }));
}

/** 옛 이전 링크(/#import=…)는 내 데이터 화면으로 해시를 유지한 채 보낸다. 홈(/)의 인라인 스크립트. 그 밖에는 이동하지 않는다. */
export const IMPORT_TARGET = '/insurance/settings/';
export const IMPORT_REDIRECT_JS = `(function(){var h=location.hash||'';if(h.indexOf('#import=')===0)location.replace(${JSON.stringify(IMPORT_TARGET)}+h);})();`;
