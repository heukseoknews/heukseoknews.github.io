'use client';
/** 브라우저 쪽 동기화 실행기(계정마다 하나). 로그인을 켠 빌드에서만 불러온다(lib/useSaved.ts 가 동적으로).
 *  언제: 화면을 열 때·탭이 다시 보일 때·보이는 동안 5분마다 받기, 화면에서 바꾸면 2초 모아서 올리기('모두 확인'은 바로).
 *  탭이 숨겨지거나 페이지를 떠날 때 보낼 것이 남아 있으면 바로 올린다(못 올려도 기기 사본에 남아 다음에 올림).
 *  실패하면 기기 사본은 그대로 두고 30초·1분·2분…(최대 5분) 뒤 다시. 상태(동기화 중·저장됨·오류)는 작게 표시한다(components/SyncNote.tsx). */
import { browserKV, sessionUser } from './auth';
import { SYNC_EVENT, SyncError, type SyncFail, markDirty, readMeta, syncChannel } from './sync';
import { supabaseRows } from './syncBackend';

export type SyncState = { state: 'idle' | 'syncing' | 'ok' | 'error'; fail?: SyncFail; at: string | null };
const PULL_MS = 5 * 60_000, PUSH_DELAY = 2000, RETRY_MIN = 30_000, RETRY_MAX = 5 * 60_000;

class Manager {
  private be;
  private channels = new Set<string>();
  private status = new Map<string, SyncState>();
  private timers = new Map<string, number>();
  private running = new Set<string>();
  private again = new Set<string>();
  private fails = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private userId: string) {
    this.be = supabaseRows(userId);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kickAll(); else this.flush(); });
    window.addEventListener('pagehide', () => this.flush());
    window.setInterval(() => { if (document.visibilityState === 'visible') this.kickAll(); }, PULL_MS);
  }
  private alive() { return sessionUser(browserKV) === this.userId; }   // 로그아웃·다른 계정이면 멈춤
  private set(ch: string, s: SyncState) { this.status.set(ch, s); this.listeners.forEach(f => f()); }
  start(ch: string) { this.channels.add(ch); this.kick(ch, 0); }
  /** 화면에서 바꿨음: 보낼 것 있음 표시 후 2초 모아 올리기(delay 0 이면 바로) */
  changed(ch: string, delay = PUSH_DELAY) { this.channels.add(ch); markDirty(browserKV, ch, this.userId); this.kick(ch, delay); }
  /** 보낼 것이 남은 채널을 기다리지 않고 바로 올린다(탭 숨김·떠남) */
  flush() { this.channels.forEach(ch => { if (readMeta(browserKV, ch, this.userId).dirty) { clearTimeout(this.timers.get(ch)); void this.run(ch); } }); }
  kickAll() { this.channels.forEach(ch => this.kick(ch, 0)); }
  kick(ch: string, delay: number) {
    clearTimeout(this.timers.get(ch));
    this.timers.set(ch, window.setTimeout(() => { void this.run(ch); }, delay));
  }
  private async run(ch: string) {
    if (!this.alive()) return;
    if (this.running.has(ch)) { this.again.add(ch); return; }
    this.running.add(ch);
    this.set(ch, { ...this.get(ch), state: 'syncing' });
    try {
      const r = await syncChannel(this.be, browserKV, this.userId, ch);
      this.fails.delete(ch);
      if (r.changed) window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { userId: this.userId, channel: ch } }));   // 화면이 새 내용을 먼저 읽고
      this.set(ch, { state: 'ok', at: readMeta(browserKV, ch, this.userId).at });                                              // 그다음 '맞춤 끝'을 알린다(useSaved.settled)
    } catch (e) {
      const fail: SyncFail = e instanceof SyncError ? e.kind : 'other';
      if (!(e instanceof SyncError)) console.error('[sync] run', (e as Error)?.name ?? '');
      const n = (this.fails.get(ch) ?? 0) + 1;
      this.fails.set(ch, n);
      this.set(ch, { state: 'error', fail, at: readMeta(browserKV, ch, this.userId).at });
      if (this.alive()) this.kick(ch, Math.min(RETRY_MIN * 2 ** (n - 1), RETRY_MAX));
    } finally {
      this.running.delete(ch);
      if (this.again.delete(ch)) this.kick(ch, 0);
    }
  }
  get(ch: string): SyncState { return this.status.get(ch) ?? { state: 'idle', at: readMeta(browserKV, ch, this.userId).at }; }
  /** 어느 채널이든 오류면 오류(헤더의 작은 점) */
  anyError() { return [...this.status.values()].some(s => s.state === 'error'); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
}

const managers = new Map<string, Manager>();
export function syncFor(userId: string): Manager {
  let m = managers.get(userId);
  if (!m) { m = new Manager(userId); managers.set(userId, m); }
  return m;
}
export type { Manager };
