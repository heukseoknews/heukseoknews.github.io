/** 마이페이지(/me/) 공통: 메뉴·채널 선택. 채널과 무관한 경로이고, 어느 채널을 볼지는 ?ch= 로 정한다.
 *  메뉴는 아래 배열에 한 줄씩. 로그인을 켠 빌드에서는 '계정'(표시 이름)을 더한다(meMenu). */
import { DIRECTORY } from './directory.ts';

export type MeMenuItem = { href: string; label: string };
export const ME_MENU: MeMenuItem[] = [
  { href: '/me/', label: '내 북마크' },
  { href: '/me/data/', label: '내 데이터' },
];
/** 로그인을 켠 빌드에서만 더하는 메뉴(표시 이름 바꾸기). 꺼진 빌드의 마이페이지는 지금 그대로 */
export const ME_ACCOUNT: MeMenuItem = { href: '/me/account/', label: '계정' };
export const meMenu = (authOn: boolean): MeMenuItem[] => authOn ? [...ME_MENU, ME_ACCOUNT] : ME_MENU;
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

/** 옛 '내 데이터' 주소(/<채널>/settings/)에서 화면을 그리기 전에 마이페이지로 보내는 인라인 스크립트(#import= 해시 유지). */
export const settingsRedirectJs = (channel: string) => `(function(){location.replace(${JSON.stringify(dataHref(channel))}+(location.hash||''));})();`;
