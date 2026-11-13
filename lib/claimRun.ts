'use client';
/** 기기 북마크 합치기 실행(브라우저). 판단·병합 규칙은 lib/claim.ts. 합친 채널은 계정 사본에 저장하고 서버로 보낸다. 기기 기록은 지우지 않는다. */
import { browserKV } from './auth';
import { CHANNELS, getChannel } from './channels';
import { type ClaimItem, claimMerge, claimable, markClaimed } from './claim';
import { meChannels } from './me';
import { accountStore, localStorageStore } from './storage';
import { SYNC_EVENT } from './sync';

export const CLAIM_CHANNELS = meChannels(CHANNELS.map(c => c.slug));
const device = (ch: string) => localStorageStore.load(ch, getChannel(ch)?.storage?.legacy_keys);
export const deviceItems = (uid: string, channels = CLAIM_CHANNELS): ClaimItem[] => claimable(browserKV, uid, channels.map(ch => ({ channel: ch, state: device(ch) })));

export async function runClaim(uid: string, channels: string[]): Promise<{ merged: number; refused: string[]; notes: string[] }> {
  const store = accountStore(uid);
  const out = { merged: 0, refused: [] as string[], notes: [] as string[] };
  const now = new Date().toISOString();
  for (const ch of channels) {
    const name = getChannel(ch)?.name ?? ch;
    const r = claimMerge(store.load(ch), device(ch));
    if (r.over) { out.refused.push(name); continue; }
    store.save(ch, r.state);
    markClaimed(browserKV, ch, uid, now);
    out.merged++;
    out.notes.push(...r.notes.map(n => `${name}: ${n}`));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { userId: uid, channel: ch } }));   // 열린 화면이 다시 읽게
    try { (await import('./syncManager')).syncFor(uid).changed(ch); } catch { /* 다음 동기화 때 보낸다 */ }
  }
  return out;
}
