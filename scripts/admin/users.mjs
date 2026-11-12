#!/usr/bin/env node
// 계정 관리(관리자 맥에서만). 사용법은 docs/auth-runbook.md. 기본은 모의 실행이고 --apply 를 줘야 반영한다.
//
//   node scripts/admin/users.mjs check                       연결·키·SQL 적용 확인(읽기만)
//   node scripts/admin/users.mjs create [--csv <경로>] [--apply]   CSV 일괄 생성(이미 있는 아이디는 건너뜀)
//   node scripts/admin/users.mjs reset-password <아이디> [--csv <경로>] [--apply]   학번으로 다시 초기화 + 첫 로그인 변경 다시 요구
//   node scripts/admin/users.mjs list                        아이디·표시 이름·상태(학번·비밀번호는 보이지 않음)
//   node scripts/admin/users.mjs disable <아이디> [--apply]   사용 중지
//   node scripts/admin/users.mjs enable <아이디> [--apply]    다시 사용
//
// 설정: 프로젝트 URL = 환경 변수 SUPABASE_URL(또는 --url, 비밀 아님)
//       비밀 키 = ~/.heukseok/supabase.env 의 SUPABASE_SECRET_KEY=(경로는 환경 변수 HEUKSEOK_SECRET_ENV 로 변경)
//       CSV = ~/.heukseok/accounts.csv(열: login_id,display_name,student_no, 경로는 --csv)
//       publishable 키(check 의 anon 확인용, 비밀 아님) = 환경 변수 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//       HEUKSEOK_ADMIN_BEARER=1 = Auth 관리 API 에 비밀 키를 Authorization: Bearer 로도 보냄(check 가 그렇게 안내할 때만)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CSV, insideRepo, loadSecretKey, makeApi, makeOut, makeRedactor, parseCsv, resolveUrl } from './lib.mjs';
import { cmdCheck, cmdCreate, cmdList, cmdResetPassword, cmdSetDisabled } from './commands.mjs';

const USAGE = '사용법: node scripts/admin/users.mjs <check|create|reset-password <아이디>|list|disable <아이디>|enable <아이디>> [--apply] [--csv <경로>] [--url <프로젝트 URL>]';

export function parseArgs(argv) {
  const a = { cmd: argv[0], pos: [], apply: false, csv: process.env.HEUKSEOK_ACCOUNTS_CSV || DEFAULT_CSV, url: null };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--apply') a.apply = true;
    else if (x === '--csv') a.csv = argv[++i];
    else if (x === '--url') a.url = argv[++i];
    else if (x.startsWith('--')) throw new Error(`모르는 옵션: ${x}`);
    else a.pos.push(x);
  }
  return a;
}

function readCsv(path, redactor) {
  if (insideRepo(path)) throw new Error(`계정 CSV 가 저장소 폴더 안에 있습니다. 저장소 밖(~/.heukseok/)으로 옮기세요: ${path}`);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { throw new Error(`계정 CSV 를 읽을 수 없습니다: ${path}`); }
  const parsed = parseCsv(text);
  for (const r of parsed.rows) redactor.add(r.student_no);   // 학번은 어떤 출력에도 나오지 않게
  return parsed;
}

async function main(argv) {
  const redactor = makeRedactor();
  const out = makeOut(redactor);
  const err = (...p) => process.stderr.write(redactor.redact(p.join(' ')) + '\n');
  try {
    const a = parseArgs(argv);
    if (!a.cmd || !['check', 'create', 'reset-password', 'list', 'disable', 'enable'].includes(a.cmd)) { err(USAGE); return 2; }
    const url = resolveUrl(a.url);
    const { key, warnings } = loadSecretKey();
    redactor.add(key);
    for (const w of warnings) err('경고: ' + w);
    const adminBearer = process.env.HEUKSEOK_ADMIN_BEARER === '1';
    const api = makeApi({ url, key, redactor, adminBearer });
    if (a.cmd === 'check') {
      const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
      const anonApi = pub.startsWith('sb_publishable_') ? makeApi({ url, key: pub, redactor }) : null;
      const bearerApi = adminBearer ? null : makeApi({ url, key, redactor, adminBearer: true });
      const r = await cmdCheck({ api, anonApi, bearerApi, out });
      return r.every(x => x.ok) ? 0 : 1;
    }
    if (a.cmd === 'list') { await cmdList({ api, out }); return 0; }
    if (a.cmd === 'create') {
      const { rows, errors } = readCsv(a.csv, redactor);
      const r = await cmdCreate({ api, out, rows, csvErrors: errors, apply: a.apply });
      return r.failed.length ? 1 : 0;
    }
    const loginId = (a.pos[0] || '').trim().toLowerCase();
    if (!loginId) { err(USAGE); return 2; }
    if (a.cmd === 'reset-password') {
      const { rows } = readCsv(a.csv, redactor);
      return (await cmdResetPassword({ api, out, loginId, rows, apply: a.apply })).ok ? 0 : 1;
    }
    return (await cmdSetDisabled({ api, out, loginId, disable: a.cmd === 'disable', apply: a.apply })).ok ? 0 : 1;
  } catch (e) {
    err('오류: ' + (e && e.message ? e.message : '알 수 없는 오류'));   // 메시지는 redact 를 거친다(스택·원문 객체는 출력하지 않음)
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
export { main };
