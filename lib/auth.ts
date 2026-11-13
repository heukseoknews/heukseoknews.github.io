/** 로그인 흐름의 순수 로직(브라우저·Supabase 없이 테스트한다, tests/auth.test.ts).
 *  화면은 이 파일과 lib/authBackend.ts(실제 Supabase 연결)만 쓴다. 비밀번호는 어디에도 저장·출력하지 않는다. */
import type { AuthMode } from './authConfig.ts';

// ───── 저장 키(브라우저 localStorage) ─────
/** Supabase 세션(supabase-js 가 저장·갱신). 기본 키 대신 고정 이름을 써서 장벽 검사가 같은 키를 읽게 한다 */
export const SESSION_KEY = 'heukseok-auth';
/** 계정 상태 사본(표시 이름·아이디·비밀번호 변경 필요). 서버가 안 될 때 마지막으로 알려진 상태 */
export const accountKey = (userId: string) => `heukseok-account-v1:${userId}`;
/** '아이디 저장'(아이디만) */
export const LOGIN_ID_KEY = 'heukseok-login-id';

export const LOGIN_PATH = '/login/';
export const CHANGE_PATH = '/login/change-password/';

export type KV = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };
export const browserKV: KV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장소 접근 불가 */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* 저장소 접근 불가 */ } },
};

// ───── 아이디 ─────
/** 아이디: 영문 소문자로 시작, 소문자·숫자·_·-·. 3~20자(supabase/migrations/0001_init.sql profiles.login_id 와 같은 규칙) */
export const normalizeId = (raw: string) => raw.trim().toLowerCase();
export const isValidId = (id: string) => /^[a-z][a-z0-9_.-]{2,19}$/.test(id);
export const toEmail = (id: string) => `${normalizeId(id)}@users.heukseok.invalid`;

// ───── next(로그인 뒤 돌아갈 곳) ─────
/** 같은 사이트 안의 경로만 받는다: '/' 로 시작, '//'·'/\'·제어문자·공백·역슬래시 없음, 로그인 화면 자신 아님. 아니면 '/' */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return '/';
  if (raw[0] !== '/' || raw[1] === '/' || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return '/';
  if (raw === '/login' || raw.startsWith('/login/') || raw.startsWith('/login?') || raw.startsWith('/login#')) return '/';
  return raw;
}
export const loginHref = (next: string) => `${LOGIN_PATH}?next=${encodeURIComponent(safeNext(next))}`;
export const changeHref = (next: string) => `${CHANGE_PATH}?next=${encodeURIComponent(safeNext(next))}`;
export const isAuthPath = (path: string) => path === '/login' || path.startsWith(LOGIN_PATH);

// ───── 비밀번호 규칙(서버는 최소 8자·같은 비밀번호 거절만 → 나머지는 화면이 검사) ─────
export const MSG = {
  needBoth: '아이디와 비밀번호를 입력해 주세요.',
  credentials: '아이디 또는 비밀번호가 맞지 않습니다.',
  rate: '잠시 후 다시 시도해 주세요.',
  network: '로그인 서버에 연결할 수 없습니다.',
  other: '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  weak: '비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요.',
  tooLong: '비밀번호는 72자 이하로 정해 주세요.',
  hasId: '아이디가 들어가지 않은 비밀번호를 정해 주세요.',
  same: '지금 비밀번호와 다른 비밀번호를 정해 주세요.',
  mismatch: '새 비밀번호가 서로 다릅니다.',
  current: '현재 비밀번호가 맞지 않습니다.',
  notApplied: '비밀번호 변경을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  session: '로그인이 끝났습니다. 다시 로그인해 주세요.',
} as const;

export function passwordProblem(o: { next: string; confirm: string; current: string; loginId: string }): string | null {
  if (o.next.length < 8 || !/[A-Za-z]/.test(o.next) || !/[0-9]/.test(o.next)) return MSG.weak;
  if (o.next.length > 72) return MSG.tooLong;   // Supabase 비밀번호 최대 길이
  if (o.loginId && o.next.toLowerCase().includes(o.loginId.toLowerCase())) return MSG.hasId;
  if (o.next === o.current) return MSG.same;
  if (o.next !== o.confirm) return MSG.mismatch;
  return null;
}

// ───── 세션·계정 상태 사본 ─────
export type Account = { loginId: string; displayName: string | null; mustChange: boolean; checkedAt: string };

/** 저장된 Supabase 세션의 사용자 id(갱신 토큰이 있을 때만). 서버에 묻지 않는다 */
export function sessionUser(kv: KV): string | null {
  try {
    const s = JSON.parse(kv.get(SESSION_KEY) ?? 'null');
    const id = s?.user?.id;
    return typeof id === 'string' && id && typeof s.refresh_token === 'string' && s.refresh_token ? id : null;
  } catch { return null; }
}
export function readAccount(kv: KV, userId: string): Account | null {
  try {
    const a = JSON.parse(kv.get(accountKey(userId)) ?? 'null');
    return a && typeof a.mustChange === 'boolean' && typeof a.loginId === 'string' ? a : null;
  } catch { return null; }
}
export const writeAccount = (kv: KV, userId: string, a: Account) => kv.set(accountKey(userId), JSON.stringify(a));
/** 헤더에 보일 이름: 표시 이름, 없으면 아이디 */
export const shownName = (a: Pick<Account, 'loginId' | 'displayName'>) => a.displayName?.trim() || a.loginId;

// ───── 헤더 오른쪽 자리 ─────
/** 헤더 오른쪽에 무엇을 보일지. 두 상태가 함께 보이는 일이 없게 한 곳에서 정한다.
 *  - off(로그인 기능 없음): 지금처럼 마이페이지 버튼(기기 안 북마크·내 데이터)
 *  - 로그인 상태: 계정 메뉴(표시 이름 → 마이페이지·로그아웃)
 *  - 로그아웃 상태: '로그인' 하나
 *  - 확인 전(정적 HTML·첫 렌더): 비워 둔다(로그아웃 상태에 다른 버튼이 잠깐 보이지 않게) */
export type HeaderSlot = 'me' | 'account' | 'login' | 'none';
export function headerSlot(mode: AuthMode, state: 'unknown' | 'out' | 'in'): HeaderSlot {
  if (mode === 'off') return 'me';
  return state === 'in' ? 'account' : state === 'out' ? 'login' : 'none';
}
/** 저장된 세션으로 본 로그인 여부(서버에 묻지 않음) */
export const signedState = (kv: KV): 'in' | 'out' => sessionUser(kv) ? 'in' : 'out';

// ───── 장벽 판정 ─────
export type Gate = 'open' | 'login' | 'change';
/** 어느 화면을 보일지. 서버에 묻지 않고 저장된 세션·사본만 본다(서버가 안 될 때도 같은 답 = 마지막으로 알려진 상태).
 *  - off: 언제나 열림 / 로그인 화면 계열: 열림
 *  - 세션 없음: required 면 로그인 화면, optional 이면 열림
 *  - 세션 있음: 사본이 없거나 '변경 필요'면 비밀번호 변경 화면(그 화면이 서버에서 다시 확인), 아니면 열림 */
export function decideGate(o: { mode: AuthMode; path: string; userId: string | null; account: Account | null }): Gate {
  if (o.mode === 'off' || isAuthPath(o.path)) return 'open';
  if (!o.userId) return o.mode === 'required' ? 'login' : 'open';
  return !o.account || o.account.mustChange ? 'change' : 'open';
}

/** decideGate 와 같은 판정을 화면을 그리기 전에(<head> 첫 부분) 하는 인라인 스크립트. 기사 화면이 잠깐 보였다 넘어가지 않게,
 *  옮길 때는 <html data-auth="leaving"> 으로 본문을 숨긴다(app/globals.css). tests/auth.test.ts 가 decideGate 와 결과를 맞춰 본다. */
export function gateScript(mode: AuthMode): string {
  if (mode === 'off') return '';
  const K = JSON.stringify(SESSION_KEY), A = JSON.stringify(accountKey('')), R = mode === 'required';
  return `(function(){try{var L=location,p=L.pathname;if(p==='/login'||p.indexOf(${JSON.stringify(LOGIN_PATH)})===0)return;`
    + `var g=function(t){document.documentElement.setAttribute('data-auth','leaving');L.replace(t+'?next='+encodeURIComponent(p+L.search+L.hash))};`
    + `var s=null,a=null;try{s=JSON.parse(localStorage.getItem(${K})||'null')}catch(e){}`
    + `var u=s&&s.user&&typeof s.user.id==='string'&&s.user.id&&typeof s.refresh_token==='string'&&s.refresh_token?s.user.id:null;`
    + `if(!u){${R ? `g(${JSON.stringify(LOGIN_PATH)});` : ''}return}`
    + `try{a=JSON.parse(localStorage.getItem(${A}+u)||'null')}catch(e){}`
    + `if(!a||typeof a.mustChange!=='boolean'||typeof a.loginId!=='string'||a.mustChange)g(${JSON.stringify(CHANGE_PATH)})}catch(e){}})();`;
}

// ───── 서버 쪽(실제 구현은 lib/authBackend.ts, 테스트는 가짜) ─────
export type SignInFail = 'credentials' | 'rate' | 'network' | 'other';
export type PwFail = 'current' | 'same' | 'weak' | 'rate' | 'network' | 'session' | 'other';
export type AccountRow = { loginId: string | null; displayName: string | null; mustChange: boolean };
export interface AuthBackend {
  signIn(email: string, password: string): Promise<{ userId: string } | { error: SignInFail }>;
  /** 본인 profiles·account_security 행. account_security 행이 없으면 mustChange: true(막히는 쪽) */
  fetchAccount(userId: string): Promise<AccountRow | { error: 'network' | 'session' | 'other' }>;
  updatePassword(current: string, next: string): Promise<{ ok: true } | { error: PwFail }>;
  /** 이 기기의 세션만 지운다(다른 기기·로컬 북마크는 그대로) */
  signOut(): Promise<void>;
  /** 서버가 세션을 끝냈을 때(갱신 토큰 폐기·계정 삭제·다른 탭 로그아웃). 네트워크 오류로는 부르지 않는다 */
  onSignedOut(cb: () => void): () => void;
}

const SIGNIN_MSG: Record<SignInFail, string> = { credentials: MSG.credentials, rate: MSG.rate, network: MSG.network, other: MSG.other };
const PW_MSG: Record<PwFail, string> = { current: MSG.current, same: MSG.same, weak: MSG.weak, rate: MSG.rate, network: MSG.network, session: MSG.session, other: MSG.notApplied };

const toAccount = (row: AccountRow, fallbackId: string, now: string): Account =>
  ({ loginId: row.loginId || fallbackId, displayName: row.displayName, mustChange: row.mustChange, checkedAt: now });

export type Outcome = { go: string } | { message: string };

/** 로그인: 아이디 확인 → 로그인 → 계정 상태 확인 → '변경 필요'면 변경 화면, 아니면 next */
export async function login(b: AuthBackend, kv: KV, o: { id: string; password: string; next: string | null; remember: boolean; now?: string }): Promise<Outcome> {
  const id = normalizeId(o.id);
  if (!id || !o.password) return { message: MSG.needBoth };
  if (!isValidId(id)) return { message: MSG.credentials };   // 형식이 아니면 서버에 묻지 않는다(계정 유무를 알리지 않는 같은 문구)
  const r = await b.signIn(toEmail(id), o.password);
  if ('error' in r) return { message: SIGNIN_MSG[r.error] };
  if (o.remember) kv.set(LOGIN_ID_KEY, id); else kv.remove(LOGIN_ID_KEY);
  const next = safeNext(o.next);
  const acc = await b.fetchAccount(r.userId);
  if ('error' in acc) { kv.remove(accountKey(r.userId)); return { go: changeHref(next) }; }  // 확인 못 하면 변경 화면이 다시 확인
  const a = toAccount(acc, id, o.now ?? new Date().toISOString());
  writeAccount(kv, r.userId, a);
  return { go: a.mustChange ? changeHref(next) : next };
}

/** 변경 화면에 들어왔을 때: 세션 없음 → 로그인, 서버가 '변경 필요 아님' → next, 그 밖에는 폼.
 *  서버가 안 되면 사본이 '변경 필요 아님'일 때만 next(마지막 상태), 아니면 폼(제출하면 연결 오류 문구) */
export async function enterChange(b: AuthBackend, kv: KV, o: { next: string | null; now?: string }): Promise<{ go: string } | { form: Account | null }> {
  const userId = sessionUser(kv);
  const next = safeNext(o.next);
  if (!userId) return { go: loginHref(next) };
  const acc = await b.fetchAccount(userId);
  const cached = readAccount(kv, userId);
  if ('error' in acc) {
    if (acc.error === 'session') return { go: loginHref(next) };
    return cached && !cached.mustChange ? { go: next } : { form: cached };
  }
  const a = toAccount(acc, cached?.loginId ?? '', o.now ?? new Date().toISOString());
  writeAccount(kv, userId, a);
  return a.mustChange ? { form: a } : { go: next };
}

/** 비밀번호 변경: 화면 규칙 → 서버 변경(현재 비밀번호 함께) → 서버의 '변경 필요'가 꺼졌는지 다시 읽어 확인 → next */
export async function changePassword(b: AuthBackend, kv: KV, o: { current: string; next: string; confirm: string; loginId: string; nextPath: string | null; now?: string }): Promise<Outcome> {
  const userId = sessionUser(kv);
  if (!userId) return { go: loginHref(safeNext(o.nextPath)) };
  if (!o.current) return { message: MSG.current };
  const bad = passwordProblem({ next: o.next, confirm: o.confirm, current: o.current, loginId: o.loginId });
  if (bad) return { message: bad };
  const r = await b.updatePassword(o.current, o.next);
  if ('error' in r) return r.error === 'session' ? { go: loginHref(safeNext(o.nextPath)) } : { message: PW_MSG[r.error] };
  const acc = await b.fetchAccount(userId);
  if ('error' in acc || acc.mustChange) return { message: MSG.notApplied };
  writeAccount(kv, userId, toAccount(acc, o.loginId, o.now ?? new Date().toISOString()));
  return { go: safeNext(o.nextPath) };
}

/** 앱을 열 때 뒤에서 계정 상태를 다시 읽는다. 서버가 안 되면 사본을 그대로 둔다(마지막 상태). 바뀐 판정을 돌려준다 */
export async function refreshAccount(b: AuthBackend, kv: KV, o: { mode: AuthMode; path: string; now?: string }): Promise<Gate> {
  const userId = sessionUser(kv);
  if (userId) {
    const acc = await b.fetchAccount(userId);
    if (!('error' in acc)) writeAccount(kv, userId, toAccount(acc, readAccount(kv, userId)?.loginId ?? '', o.now ?? new Date().toISOString()));
  }
  return decideGate({ mode: o.mode, path: o.path, userId, account: userId ? readAccount(kv, userId) : null });
}

/** 로그아웃: 이 기기 세션과 계정 상태 사본만 지운다. 북마크·읽음 등 기기 안 기록은 그대로 */
export async function logout(b: AuthBackend, kv: KV): Promise<void> {
  const userId = sessionUser(kv);
  try { await b.signOut(); } catch { /* 서버가 안 돼도 이 기기 세션은 지운다 */ }
  kv.remove(SESSION_KEY);
  if (userId) kv.remove(accountKey(userId));
}
