/** 마이페이지(/me/) 공통: 메뉴·채널 선택. 채널과 무관한 경로이고, 어느 채널을 볼지는 ?ch= 로 정한다.
 *  메뉴는 아래 배열에 한 줄씩. 로그인을 붙이면 { href: '/me/account/', label: '계정' }(비밀번호 변경·로그아웃)을 더한다(docs/auth-plan.md 8장). */
import { DIRECTORY } from './directory.ts';

export type MeMenuItem = { href: string; label: string };
export const ME_MENU: MeMenuItem[] = [
  { href: '/me/', label: '내 북마크' },
  { href: '/me/data/', label: '내 데이터' },
];
export const ME_HOME = '/me/';
/** 마지막으로 본 마이페이지 채널(이 브라우저) */
export const ME_CHANNEL_KEY = 'heukseok-me-channel';

/** 마이페이지에서 고를 수 있는 채널: 공개(live) 채널 중 페이지가 있는 것(directory 순서) */
export const meChannels = (available: string[]) => DIRECTORY.filter(d => d.status === 'live' && available.includes(d.slug)).map(d => d.slug);

/** ?ch= → 마지막으로 본 채널 → 첫 채널 순서. 목록에 없는 값은 무시한다. */
export function pickChannel(query: string | null, remembered: string | null, list: string[]): string {
  if (query && list.includes(query)) return query;
  if (remembered && list.includes(remembered)) return remembered;
  return list[0] ?? 'insurance';
}

export const meHref = (path: string, channel: string) => `${path}?ch=${encodeURIComponent(channel)}`;
/** 옛 '내 데이터' 주소(/<채널>/settings/)가 보낼 곳 */
export const dataHref = (channel: string) => meHref('/me/data/', channel);
