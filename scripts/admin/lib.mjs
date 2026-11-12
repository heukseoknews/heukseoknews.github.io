// 계정 관리 스크립트 공통 모듈(관리자 맥에서만 실행). 새 의존성 없이 Node 내장 기능과 fetch 만 쓴다.
// 비밀(비밀 키·학번·비밀번호)은 메모리에만 두고, 화면 출력은 모두 out() → redact() 를 거친다.
// 설계: docs/auth-plan.md 6장, 실행 절차: docs/auth-runbook.md
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMAIL_DOMAIN = 'users.heukseok.invalid';
export const LOGIN_RE = /^[a-z][a-z0-9_.-]{2,19}$/;          // SQL profiles.login_id 검사와 같다
export const CSV_COLUMNS = ['login_id', 'display_name', 'student_no'];
export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_DIR = join(homedir(), '.heukseok');
export const DEFAULT_SECRET_ENV = join(DEFAULT_DIR, 'supabase.env');
export const DEFAULT_CSV = join(DEFAULT_DIR, 'accounts.csv');

export const toEmail = id => `${id}@${EMAIL_DOMAIN}`;
export const loginOf = email => (email || '').toLowerCase().endsWith('@' + EMAIL_DOMAIN) ? email.toLowerCase().slice(0, -(EMAIL_DOMAIN.length + 1)) : null;

// ───────── 출력 가림 ─────────
/** 등록한 비밀 문자열과 비밀처럼 보이는 모양(sb_secret_…, JWT)을 [가림] 으로 바꾼다. */
export function makeRedactor() {
  const secrets = new Set();
  return {
    add(s) { if (typeof s === 'string' && s.length >= 4) secrets.add(s); },
    redact(text) {
      let t = String(text);
      for (const s of [...secrets].sort((a, b) => b.length - a.length)) t = t.split(s).join('[가림]');
      return t.replace(/sb_secret_[A-Za-z0-9_\-]+/g, '[가림]')
              .replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+/g, '[가림]');
    },
  };
}

/** out(…): 가림을 거친 뒤 한 줄씩 출력. 테스트에서는 sink 를 바꿔 출력 내용을 검사한다. */
export function makeOut(redactor, sink = s => process.stdout.write(s + '\n')) {
  const lines = [];
  const out = (...parts) => { const s = redactor.redact(parts.join(' ')); lines.push(s); sink(s); };
  out.lines = lines;
  return out;
}

// ───────── 경로·키 ─────────
function real(p) { try { return realpathSync(p); } catch { return resolve(p); } }
export function insideRepo(p, root = REPO_ROOT) {
  const a = real(p), r = real(root);
  return a === r || a.startsWith(r + sep);
}

/** KEY=value 형식(주석·export·따옴표 허용)에서 값들을 읽는다. 값은 반환만 하고 어디에도 쓰지 않는다. */
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** 비밀 키를 파일에서만 읽는다(기본 ~/.heukseok/supabase.env, 환경 변수 HEUKSEOK_SECRET_ENV 로 경로 변경).
 *  오류 메시지에는 경로만 넣고 파일 내용·키는 넣지 않는다. 반환: { key, warnings } */
export function loadSecretKey({ path = process.env.HEUKSEOK_SECRET_ENV || DEFAULT_SECRET_ENV, read = p => readFileSync(p, 'utf8'), stat = p => statSync(p), repoRoot = REPO_ROOT } = {}) {
  if (insideRepo(path, repoRoot)) throw new Error(`비밀 키 파일이 저장소 폴더 안에 있습니다. 저장소 밖(예: ~/.heukseok/)으로 옮기세요: ${path}`);
  let text;
  try { text = read(path); } catch { throw new Error(`비밀 키 파일을 읽을 수 없습니다: ${path} (docs/auth-runbook.md 1단계)`); }
  const key = parseEnvText(text).SUPABASE_SECRET_KEY || '';
  if (!key) throw new Error(`비밀 키 파일에 SUPABASE_SECRET_KEY= 줄이 없습니다: ${path}`);
  if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY 가 새 방식 비밀 키(sb_secret_ 로 시작)가 아닙니다. 예전 JWT 방식 키는 쓰지 않습니다.');
  const warnings = [];
  try { if ((stat(path).mode & 0o077) !== 0) warnings.push(`비밀 키 파일을 나만 읽게 하세요: chmod 600 ${path}`); } catch { /* 권한 확인 실패는 경고하지 않는다 */ }
  return { key, warnings };
}

/** 프로젝트 URL(비밀 아님): --url > 환경 변수 SUPABASE_URL > NEXT_PUBLIC_SUPABASE_URL. https 만 받는다. */
export function resolveUrl(flagUrl, env = process.env) {
  const u = (flagUrl || env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('프로젝트 URL 이 없습니다. export SUPABASE_URL=https://<프로젝트 ref>.supabase.co 로 정하거나 --url 을 주세요.');
  let p;
  try { p = new URL(u); } catch { throw new Error('프로젝트 URL 형식이 아닙니다(https://<프로젝트 ref>.supabase.co).'); }
  if (p.protocol !== 'https:' || p.pathname !== '/' || p.search || p.hash) throw new Error('프로젝트 URL 은 https://<프로젝트 ref>.supabase.co 형태여야 합니다(경로·쿼리 없이).');
  return u;
}

// ───────── CSV ─────────
/** login_id,display_name,student_no 머리줄이 있는 CSV. 따옴표·쉼표·BOM 처리. 반환: { rows:[{line,login_id,display_name,student_no}], errors:[{line,reason}] } */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const records = [];
  let rec = [], f = '', q = false, line = 1, recLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === '\n') line++; f += c; }
    } else if (c === '"') q = true;
    else if (c === ',') { rec.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      rec.push(f); records.push({ line: recLine, cells: rec }); rec = []; f = ''; line++; recLine = line;
    } else f += c;
  }
  if (f !== '' || rec.length) { rec.push(f); records.push({ line: recLine, cells: rec }); }
  const nonEmpty = records.filter(r => r.cells.some(c => c.trim() !== ''));
  if (!nonEmpty.length) return { rows: [], errors: [{ line: 1, reason: 'CSV 가 비어 있습니다' }] };
  const head = nonEmpty[0].cells.map(c => c.trim().toLowerCase());
  const idx = CSV_COLUMNS.map(c => head.indexOf(c));
  if (idx.some(i => i < 0)) return { rows: [], errors: [{ line: nonEmpty[0].line, reason: `머리줄은 ${CSV_COLUMNS.join(',')} 이어야 합니다` }] };
  const rows = [], errors = [];
  for (const r of nonEmpty.slice(1)) {
    if (r.cells.length < head.length) { errors.push({ line: r.line, reason: '열 수가 부족합니다' }); continue; }
    const [login, name, sn] = idx.map(i => (r.cells[i] ?? ''));
    rows.push({ line: r.line, login_id: login.trim().toLowerCase(), display_name: name.trim().normalize('NFC'), student_no: sn.trim() });
  }
  return { rows, errors };
}

/** 한 줄 검사(학번 값은 이유 문구에 넣지 않는다). 반환: 오류 이유 목록 */
export function rowProblems(r) {
  const p = [];
  if (!LOGIN_RE.test(r.login_id)) p.push('아이디 형식(영문 소문자로 시작, 소문자·숫자·_·-·. 3~20자)');
  if (!r.display_name) p.push('표시 이름이 비었습니다');
  else if ([...r.display_name].length > 20) p.push('표시 이름은 20자 이하');
  if (!r.student_no) p.push('학번이 비었습니다');
  else {
    if (r.student_no.length < 8) p.push('학번(초기 비밀번호)이 8자 미만');
    if (Buffer.byteLength(r.student_no, 'utf8') > 72) p.push('학번(초기 비밀번호)이 72바이트 초과');
    if (/\s/.test(r.student_no)) p.push('학번에 공백이 있습니다');
    if (r.login_id && r.student_no.toLowerCase().includes(r.login_id)) p.push('학번(초기 비밀번호)에 아이디가 들어 있습니다');
  }
  return p;
}

/** 만들 계정 계획: 검증 실패·CSV 안 중복·이미 있는 계정·다른 계정과 겹치는 표시 이름을 나눈다.
 *  existing = [{ login_id, display_name }] (서버의 기존 계정) */
export function planCreate(rows, existing = []) {
  const byLogin = new Map(existing.map(e => [e.login_id, e]));
  const takenNames = new Map(existing.filter(e => e.display_name).map(e => [e.display_name, e.login_id]));
  const seenLogin = new Map(), seenName = new Map();
  for (const r of rows) {
    seenLogin.set(r.login_id, (seenLogin.get(r.login_id) || 0) + 1);
    seenName.set(r.display_name, (seenName.get(r.display_name) || 0) + 1);
  }
  const create = [], skip = [], invalid = [];
  for (const r of rows) {
    const probs = rowProblems(r);
    if (seenLogin.get(r.login_id) > 1) probs.push('CSV 안에서 아이디가 겹칩니다');
    if (r.display_name && seenName.get(r.display_name) > 1) probs.push('CSV 안에서 표시 이름이 겹칩니다');
    if (probs.length) { invalid.push({ line: r.line, login_id: r.login_id, reasons: probs }); continue; }
    if (byLogin.has(r.login_id)) { skip.push({ line: r.line, login_id: r.login_id, reason: '이미 있는 아이디(건너뜀)' }); continue; }
    const owner = takenNames.get(r.display_name);
    if (owner && owner !== r.login_id) { invalid.push({ line: r.line, login_id: r.login_id, reasons: [`표시 이름이 기존 계정(${owner})과 겹칩니다`] }); continue; }
    create.push(r);
  }
  return { create, skip, invalid };
}

// ───────── Supabase 호출 ─────────
export class ApiError extends Error {
  constructor(status, code, message) { super(`HTTP ${status}${code ? ' ' + code : ''}${message ? ': ' + message : ''}`); this.status = status; this.code = code; }
}

/** Supabase REST·Auth 관리 API 호출. 새 방식 키는 apikey 헤더로만 보낸다(공식 문서: API keys → Known limitations,
 *  "Send publishable and secret keys on the apikey header, not on Authorization: Bearer"). userToken 이 있으면 그 사용자로 요청. */
// adminBearer: Auth 관리 API(/auth/v1/admin/…)에만 비밀 키를 Authorization: Bearer 로도 보낸다. 문서상 권장은 아니므로 기본은 끔이고,
//  check 가 apikey 만으로 401/403 을 받고 이 방식으로는 통과할 때만 켠다(환경 변수 HEUKSEOK_ADMIN_BEARER=1).
export function makeApi({ url, key, fetch: f = globalThis.fetch, redactor, userToken, adminBearer = false } = {}) {
  const call = async (method, path, body, extraHeaders = {}) => {
    const headers = { apikey: key, Accept: 'application/json', ...extraHeaders };
    if (userToken) headers.Authorization = `Bearer ${userToken}`;
    else if (adminBearer && path.startsWith('/auth/v1/admin/')) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try { res = await f(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new ApiError(0, 'network', redactor ? redactor.redact(e.message) : 'network error'); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const code = data && (data.error_code || data.code || data.error) || '';
      const msg = data && (data.msg || data.message || data.error_description) || '';
      throw new ApiError(res.status, String(code), redactor ? redactor.redact(String(msg)).slice(0, 200) : '');
    }
    return data;
  };
  const enc = encodeURIComponent;
  return {
    call,
    // Auth 관리 API(service_role 필요)
    listUsers: (page = 1, perPage = 200) => call('GET', `/auth/v1/admin/users?page=${page}&per_page=${perPage}`),
    createUser: body => call('POST', '/auth/v1/admin/users', body),
    updateUser: (id, body) => call('PUT', `/auth/v1/admin/users/${enc(id)}`, body),
    deleteUser: id => call('DELETE', `/auth/v1/admin/users/${enc(id)}`),
    // 사용자 Auth
    signIn: (email, password) => call('POST', '/auth/v1/token?grant_type=password', { email, password }),
    changeOwnPassword: (password, current_password) => call('PUT', '/auth/v1/user', { password, current_password }),
    // PostgREST
    select: (table, query) => call('GET', `/rest/v1/${table}?${query}`),
    insert: (table, row) => call('POST', `/rest/v1/${table}`, row, { Prefer: 'return=representation' }),
    patch: (table, query, row) => call('PATCH', `/rest/v1/${table}?${query}`, row, { Prefer: 'return=representation' }),
    remove: (table, query) => call('DELETE', `/rest/v1/${table}?${query}`, undefined, { Prefer: 'return=representation' }),
    rpc: (fn, args = {}) => call('POST', `/rest/v1/rpc/${enc(fn)}`, args),
  };
}

/** 모든 Auth 사용자(페이지 넘김) */
export async function allUsers(api) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const d = await api.listUsers(page, 200);
    const users = (d && d.users) || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

/** 서버의 계정 현황(아이디·표시 이름·상태). 학번·비밀번호는 서버에도 없다(해시뿐). */
export async function accounts(api) {
  const [users, profiles, sec] = await Promise.all([
    allUsers(api),
    api.select('profiles', 'select=user_id,login_id,display_name,is_admin,created_at'),
    api.select('account_security', 'select=user_id,must_change_password,password_changed_at,reset_pending'),
  ]);
  const P = new Map((profiles || []).map(p => [p.user_id, p]));
  const S = new Map((sec || []).map(s => [s.user_id, s]));
  return users.map(u => {
    const p = P.get(u.id) || {}, s = S.get(u.id) || {};
    const banned = !!(u.banned_until && Date.parse(u.banned_until) > Date.now());
    return { user_id: u.id, login_id: p.login_id || loginOf(u.email), display_name: p.display_name ?? null, has_profile: !!P.get(u.id),
             is_admin: !!p.is_admin, must_change: s.must_change_password ?? null, password_changed_at: s.password_changed_at || null,
             disabled: banned, last_sign_in_at: u.last_sign_in_at || null, created_at: u.created_at || null };
  }).sort((a, b) => String(a.login_id).localeCompare(String(b.login_id)));
}
