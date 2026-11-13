/** 로그인 스위치(빌드 때 정해짐). 값은 GitHub Variables → deploy.yml 빌드 단계 env, 로컬은 .env.local.
 *  - off: URL·publishable 키가 없거나 형식이 아니면 — 로그인 기능이 아예 없다(오늘과 같은 사이트, 로그인 코드도 불러오지 않음)
 *  - optional: 설정은 있고 NEXT_PUBLIC_REQUIRE_LOGIN 이 꺼짐 — 헤더에 '로그인' 진입만, 장벽 없음
 *  - required: 설정이 있고 NEXT_PUBLIC_REQUIRE_LOGIN 켬(1·true·on·yes) — 로그인 화면이 먼저
 *  publishable 키(sb_publishable_…)만 받는다. 다른 모양(예전 JWT 키, 비밀 키)이면 off 로 둔다. */
export type AuthMode = 'off' | 'optional' | 'required';

export function authModeOf(url: string | undefined, key: string | undefined, require: string | undefined): AuthMode {
  if (!url || !key) return 'off';
  if (!/^https?:\/\/[^\s/]+\/?$/.test(url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return 'off';
  return /^(1|true|on|yes)$/i.test((require ?? '').trim()) ? 'required' : 'optional';
}

// NEXT_PUBLIC_* 는 next build 가 이 자리에 문자열로 넣는다(그래서 process.env.이름 을 그대로 써야 한다)
const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const RAW_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const AUTH_MODE: AuthMode = authModeOf(RAW_URL, RAW_KEY, process.env.NEXT_PUBLIC_REQUIRE_LOGIN);
export const AUTH_URL = AUTH_MODE === 'off' ? '' : RAW_URL!.replace(/\/$/, '');
export const AUTH_KEY = AUTH_MODE === 'off' ? '' : RAW_KEY!;
