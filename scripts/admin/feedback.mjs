#!/usr/bin/env node
// 기사 피드백 통계·가명 내보내기(관리자 맥에서만, 읽기만). 설계·분석 주의는 docs/feedback.md.
//
//   node scripts/admin/feedback.mjs stats                    채널별·신호별 건수, 사용자 수
//   node scripts/admin/feedback.mjs export [--out <폴더>]    [{channel, id, signal, user: "u1", created_at}] 를 JSON 파일로
//
// 설정은 users.mjs 와 같다: 프로젝트 URL = 환경 변수 SUPABASE_URL(또는 --url), 비밀 키 = ~/.heukseok/supabase.env.
// 내보내기 기본 폴더 = ~/.heukseok/feedback-export/(저장소 밖). 저장소 안의 폴더는 거절한다. 사용자는 실행마다 u1, u2 … 로 바꾸고
// 아이디·표시 이름·user_id 는 파일과 화면 어디에도 쓰지 않는다.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_DIR, insideRepo, loadSecretKey, makeApi, makeOut, makeRedactor, resolveUrl } from './lib.mjs';

export const DEFAULT_OUT = join(DEFAULT_DIR, 'feedback-export');
export const SIGNALS = ['irrelevant', 'useful'];
const PAGE = 1000;
const USAGE = '사용법: node scripts/admin/feedback.mjs <stats|export> [--out <폴더>] [--url <프로젝트 URL>]';

export function parseArgs(argv) {
  const a = { cmd: argv[0], out: DEFAULT_OUT, url: null };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--out') a.out = argv[++i];
    else if (x === '--url') a.url = argv[++i];
    else throw new Error(`모르는 옵션: ${x}`);
  }
  return a;
}

/** 서비스 키로 전체 행(1,000행씩 페이지). 순서는 처음 누른 시각 → 사용자 → 채널 → 기사 */
export async function fetchAll(api) {
  const rows = [];
  for (let off = 0; off < 10_000_000; off += PAGE) {
    const page = (await api.select('article_feedback',
      `select=user_id,channel,article_id,signal,created_at&order=created_at.asc,user_id.asc,channel.asc,article_id.asc&limit=${PAGE}&offset=${off}`)) || [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** 통계: 전체·사용자 수·채널별·신호별·채널×신호 */
export function stats(rows) {
  const byChannel = {}, bySignal = Object.fromEntries(SIGNALS.map(s => [s, 0])), cross = {};
  for (const r of rows) {
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
    bySignal[r.signal] = (bySignal[r.signal] ?? 0) + 1;
    (cross[r.channel] ??= Object.fromEntries(SIGNALS.map(s => [s, 0])))[r.signal] += 1;
  }
  return { total: rows.length, users: new Set(rows.map(r => r.user_id)).size, byChannel, bySignal, cross };
}

/** 가명 내보내기 행: 사용자는 처음 나온 순서대로 u1, u2 …(이 파일 안에서만 같은 사람 = 같은 번호). 그 밖의 사용자 정보는 넣지 않는다 */
export function pseudonymize(rows) {
  const alias = new Map();
  const sorted = [...rows].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.channel).localeCompare(String(y.channel)) || String(x.article_id).localeCompare(String(y.article_id)));
  return sorted.map(r => {
    if (!alias.has(r.user_id)) alias.set(r.user_id, `u${alias.size + 1}`);
    return { channel: r.channel, id: r.article_id, signal: r.signal, user: alias.get(r.user_id), created_at: r.created_at };
  });
}

/** 내보낼 파일 경로. 저장소 안의 폴더는 거절 */
export function exportFile(dir, now = new Date(), repoCheck = insideRepo) {
  const d = resolve(dir);
  if (repoCheck(d)) throw new Error(`내보내기 폴더가 저장소 안에 있습니다. 저장소 밖(기본 ${DEFAULT_OUT})을 쓰세요: ${d}`);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return join(d, `feedback-${stamp}.json`);
}

export function writeExport(path, rows) {
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(rows, null, 1) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function run(a, { api, out, now = new Date(), repoCheck = insideRepo, write = writeExport }) {
  if (a.cmd === 'stats') {
    const s = stats(await fetchAll(api));
    out(`전체 ${s.total}건 · 사용자 ${s.users}명`);
    out(`신호별: ${SIGNALS.map(x => `${x === 'useful' ? '도움 됨' : '관련 없음'} ${s.bySignal[x] ?? 0}`).join(' · ')}`);
    for (const [ch, n] of Object.entries(s.byChannel).sort((x, y) => y[1] - x[1]))
      out(`  ${ch}: ${n}건 (관련 없음 ${s.cross[ch].irrelevant} · 도움 됨 ${s.cross[ch].useful})`);
    return s;
  }
  const path = exportFile(a.out, now, repoCheck);   // 받기 전에 경로부터 확인(저장소 안이면 서버에 묻지 않고 멈춤)
  const rows = pseudonymize(await fetchAll(api));
  write(path, rows);
  out(`${rows.length}건을 내보냈습니다(사용자 ${new Set(rows.map(r => r.user)).size}명, 가명): ${path}`);
  return { path, rows };
}

async function main(argv) {
  const redactor = makeRedactor();
  const out = makeOut(redactor);
  const err = (...p) => process.stderr.write(redactor.redact(p.join(' ')) + '\n');
  try {
    const a = parseArgs(argv);
    if (!['stats', 'export'].includes(a.cmd)) { err(USAGE); return 2; }
    const url = resolveUrl(a.url);
    const { key, warnings } = loadSecretKey();
    redactor.add(key);
    for (const w of warnings) err('경고: ' + w);
    await run(a, { api: makeApi({ url, key, redactor }), out });
    return 0;
  } catch (e) {
    err('오류: ' + (e && e.message ? e.message : '알 수 없는 오류'));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
export { main };
