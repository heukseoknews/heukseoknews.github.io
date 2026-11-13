/** 처음 로그인할 때 이 기기의 북마크를 계정에 합칠지 묻는 흐름의 순수 로직(docs/auth-plan.md 5.3).
 *  묻지 않고 합치거나 지우지 않는다. 합쳐도 기기 기록(heukseok-v2:<채널>)은 지우지 않는다(되돌릴 수 있게).
 *  같은 브라우저를 여러 사람이 쓰면 남의 기록이 섞일 수 있어서 묻는다. */
import type { KV } from './auth.ts';
import { liveBookmarks, mergeCheck } from './bookmarks.ts';
import { type UserState, mergeStates } from './userState.ts';

/** 이 채널의 기기 기록을 어느 계정에 합쳤는지 { userId, at } */
export const claimedKey = (channel: string) => `heukseok-claimed-v1:${channel}`;
/** '나중에'를 고른 계정(다시 자동으로 묻지 않고, 내 데이터 화면의 버튼으로만) */
export const laterKey = (userId: string) => `heukseok-claim-later-v1:${userId}`;

export type ClaimItem = { channel: string; count: number };
const claimedBy = (kv: KV, channel: string): string | null => { try { return JSON.parse(kv.get(claimedKey(channel)) ?? 'null')?.userId ?? null; } catch { return null; } };

/** 합칠 거리: 기기 기록에 살아 있는 북마크가 있고, 이 계정에 아직 합치지 않은 채널 */
export function claimable(kv: KV, userId: string, devices: { channel: string; state: UserState }[]): ClaimItem[] {
  return devices.map(d => ({ channel: d.channel, count: liveBookmarks(d.state).length })).filter(x => x.count > 0 && claimedBy(kv, x.channel) !== userId);
}
/** 자동으로 물을까: 합칠 거리가 있고 '나중에'를 고르지 않았을 때 */
export const shouldAsk = (kv: KV, userId: string, items: ClaimItem[]) => items.length > 0 && !kv.get(laterKey(userId));
export const promptText = (items: ClaimItem[]) => `이 기기의 북마크 ${items.reduce((n, x) => n + x.count, 0).toLocaleString()}개를 내 계정에 합칠까요?`;

/** 계정 사본 + 기기 기록 합치기(가져오기와 같은 병합 규칙). over 면 서버 상한을 넘어 합치지 않는다(계정 사본 그대로). notes 는 화면 한도 안내 */
export function claimMerge(account: UserState, device: UserState): { state: UserState; over: boolean; notes: string[] } {
  const merged = mergeStates(account, device);
  const { over, notes } = mergeCheck(merged);
  return { state: over ? account : merged, over, notes };
}
export const markClaimed = (kv: KV, channel: string, userId: string, at: string) => kv.set(claimedKey(channel), JSON.stringify({ userId, at }));
