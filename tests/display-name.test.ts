import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAME_MAX, NAME_MSG, cleanName, nameFailOf, nameLength, nameProblem, saveDisplayName, type NameBackend, type NameFail } from '../lib/displayName.ts';
import { SESSION_KEY, accountKey, readAccount, type KV } from '../lib/auth.ts';
import { ME_ACCOUNT, ME_MENU, meMenu } from '../lib/me.ts';

// ---------- 저장 전 검사(서버 set_display_name 과 같은 기준) ----------
assert.equal(NAME_MAX, 20);
assert.equal(cleanName('  김 일  '), '김 일', '앞뒤 공백만 지움');
assert.equal(nameLength('가나다'), 3);
assert.equal(nameLength('😀a'), 2, '코드 포인트로 셈(서버 char_length 와 같게)');
assert.equal(nameProblem(''), 'empty');
assert.equal(nameProblem('    '), 'empty', '공백만');
assert.equal(nameProblem('가'.repeat(21)), 'tooLong');
assert.equal(nameProblem('  ' + '가'.repeat(20) + '  '), null, '앞뒤 공백을 지우면 20자');
assert.equal(nameProblem('😀'.repeat(20)), null);
assert.equal(nameProblem('가\n나'), 'invalid', '줄바꿈');
assert.equal(nameProblem('가\t나'), 'invalid', '탭');
assert.equal(nameProblem('가\u0085나'), 'invalid', 'C1 제어 문자');
assert.equal(nameProblem('김 일'), null, '가운데 공백 허용');

// ---------- 서버 오류 → 한 줄 ----------
const F = (status: number, code: string, message: string) => nameFailOf({ status, code, message });
assert.equal(F(409, 'PT409', 'name_taken'), 'taken');
assert.equal(F(422, 'PT422', 'name_too_long'), 'tooLong');
assert.equal(F(422, 'PT422', 'name_empty'), 'empty');
assert.equal(F(422, 'PT422', 'name_invalid_char'), 'invalid');
assert.equal(F(429, 'PT429', 'too_soon'), 'tooSoon');
assert.equal(F(401, 'PT401', 'not_signed_in'), 'signIn');
assert.equal(F(403, 'PT403', 'no_profile'), 'signIn');
assert.equal(F(403, 'PT403', 'password_change_required'), 'passwordFirst');
assert.equal(F(401, '42501', 'permission denied for function set_display_name'), 'signIn', 'anon');
assert.equal(F(404, 'PGRST202', 'Could not find the function public.set_display_name(new_name) in the schema cache'), 'notReady', 'SQL 적용 전');
assert.equal(F(409, '23505', 'duplicate key value violates unique constraint'), 'taken');
assert.equal(F(0, '', 'TypeError: Failed to fetch'), 'network');
assert.equal(F(503, '', ''), 'network');
assert.equal(F(400, 'XX000', 'weird'), 'other');
assert.equal(NAME_MSG.taken, '이미 쓰는 이름입니다.');
assert.equal(NAME_MSG.tooLong, '20자 이하로 정해 주세요.');
assert.equal(NAME_MSG.tooSoon, '잠시 뒤에 다시 바꿀 수 있습니다.');
assert.equal(NAME_MSG.signIn, '로그인이 필요합니다.');
assert.ok(NAME_MSG.notReady.includes('준비 중'));
for (const v of Object.values(NAME_MSG)) assert.ok(!v.includes('\n') && v.length <= 30, `한 줄: ${v}`);

// SQL 의 오류 키가 모두 화면 구분으로 이어지는지
const sql = readFileSync('supabase/migrations/0002_display_name.sql', 'utf8');
const keys = [...sql.matchAll(/raise sqlstate 'PT\d{3}' using message = '([a-z_]+)'/g)].map(m => m[1]);
assert.deepEqual([...new Set(keys)].sort(), ['name_empty', 'name_invalid_char', 'name_taken', 'name_too_long', 'no_profile', 'not_signed_in', 'password_change_required', 'too_soon']);
for (const k of keys) assert.notEqual(nameFailOf({ status: 400, code: 'PT400', message: k }), 'other', k);
// SQL 핵심: 전용 함수, 권한, 열, 멱등, 되돌리기 안내
assert.match(sql, /create or replace function public\.set_display_name\(new_name text\) returns text\s+language plpgsql security definer set search_path = ''/);
assert.match(sql, /revoke all on function public\.set_display_name\(text\) from public, anon, authenticated;\s+grant execute on function public\.set_display_name\(text\) to authenticated;/);
assert.match(sql, /alter table public\.profiles add column if not exists display_name_changed_at timestamptz;/);
assert.match(sql, /private\.password_ready\(\)/);
assert.match(sql, /where user_id = uid;/, '자기 행만');
assert.match(sql, /interval '10 minutes'/);
assert.match(sql, /lower\(regexp_replace\(p\.display_name, '\[\[:space:\]\]', '', 'g'\)\) = lower\(regexp_replace\(nm, '\[\[:space:\]\]', '', 'g'\)\)/, '대소문자·공백 차이도 겹침');
assert.match(sql, /^-- drop function if exists public\.set_display_name\(text\);$/m, '되돌리기 안내(주석)');
assert.ok(!/grant (update|insert|all)[^;]*on table public\.profiles/i.test(sql), 'profiles 쓰기 권한은 주지 않음');

// ---------- 저장 흐름(가짜 서버) ----------
const kvOf = (init: Record<string, string> = {}): KV => { const m = new Map(Object.entries(init)); return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } }; };
const SESSION = JSON.stringify({ refresh_token: 'r', user: { id: 'u1' } });
const ACC = JSON.stringify({ loginId: 'kim01', displayName: '김일', mustChange: false, checkedAt: 'T' });
const fake = (reply: { name: string } | { error: NameFail }) => { const calls: string[] = []; const b: NameBackend & { calls: string[] } = { calls, async setDisplayName(n) { calls.push(n); return reply; } }; return b; };
{
  const kv = kvOf({ [SESSION_KEY]: SESSION, [accountKey('u1')]: ACC });
  const b = fake({ name: '새 이름' });
  assert.deepEqual(await saveDisplayName(b, kv, '  새 이름 ', 'T2'), { name: '새 이름' });
  assert.deepEqual(b.calls, ['새 이름'], '서버에는 정리한 이름');
  const a = readAccount(kv, 'u1')!;
  assert.equal(a.displayName, '새 이름', '계정 사본 갱신 → 헤더 이름이 새로고침 없이 바뀜');
  assert.equal(a.loginId, 'kim01'); assert.equal(a.mustChange, false);
}
{
  const kv = kvOf({ [SESSION_KEY]: SESSION, [accountKey('u1')]: ACC });
  const b = fake({ name: 'x' });
  assert.deepEqual(await saveDisplayName(b, kv, '가'.repeat(21)), { error: 'tooLong' });
  assert.deepEqual(await saveDisplayName(b, kv, '   '), { error: 'empty' });
  assert.equal(b.calls.length, 0, '화면 검사에 걸리면 서버에 보내지 않음');
  for (const err of ['taken', 'tooSoon', 'notReady', 'network'] as const) {
    assert.deepEqual(await saveDisplayName(fake({ error: err }), kv, '다른 이름'), { error: err });
    assert.equal(readAccount(kv, 'u1')!.displayName, '김일', `${err}: 사본 그대로`);
  }
  assert.deepEqual(await saveDisplayName(fake({ name: 'x' }), kvOf(), '이름'), { error: 'signIn' }, '세션 없음');
}

// ---------- 마이페이지 메뉴: 로그인을 켠 빌드에서만 '계정' ----------
assert.deepEqual(meMenu(false), ME_MENU, '꺼진 빌드는 지금 그대로');
assert.deepEqual(meMenu(true).map(m => m.href), ['/me/', '/me/data/', '/me/account/']);
assert.equal(ME_ACCOUNT.label, '계정');
assert.ok(readFileSync('components/MeShell.tsx', 'utf8').includes("meMenu(AUTH_MODE !== 'off')"));
const panel = readFileSync('components/AccountPanel.tsx', 'utf8');
assert.ok(panel.includes('saveDisplayName(supabaseBackend, browserKV, val)') && panel.includes('notifyAuth()'), '저장 뒤 헤더 갱신');
assert.ok(readFileSync('lib/authBackend.ts', 'utf8').includes("sb.rpc('set_display_name', { new_name: name })"), '전용 함수로만 저장');
assert.ok(!/from\('profiles'\)\.(update|upsert|insert)/.test(readFileSync('lib/authBackend.ts', 'utf8')), 'profiles 직접 쓰기 없음');

// ---------- verify(관리자 검증)에 표시 이름 항목 ----------
const verify = readFileSync('scripts/admin/verify.mjs', 'utf8');
for (const k of ['2-1. anon set_display_name 호출 막힘', "'password_change_required'", "'name_too_long'", "'name_empty'", "'name_invalid_char'", "'name_taken'", "'too_soon'", '5-1. profiles 에 반영', '5-1. A profiles 표시 이름 직접 고치기 여전히 막힘'])
  assert.ok(verify.includes(k), `verify: ${k}`);
console.log('display-name tests passed');
