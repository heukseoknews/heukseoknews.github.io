import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 배포 전 비밀 키 검사(scripts/check-build-secrets.mjs)를 가짜 결과물 폴더로 시험한다. 가짜 키는 실행 중에 조립한다(이 파일이 저장소 검사에 걸리지 않게).
const run = (dir: string) => { const r = spawnSync(process.execPath, ['scripts/check-build-secrets.mjs', dir], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_SECRET = 'sb_' + 'secret_' + 'A1b2C3d4'.repeat(4);
const FAKE_JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'anon', exp: 2000000000 })}.${'s1Gn4tuRe'.repeat(4)}`;
const ROLE = 'service_' + 'role';
assert.ok(FAKE_JWT.startsWith('eyJ') && FAKE_JWT.split('.')[1].startsWith('eyJ'));

const temps: string[] = [];
const site = (files: Record<string, string | Buffer>) => {
  const d = mkdtempSync(join(tmpdir(), 'heukseok-out-')); temps.push(d);
  for (const [p, v] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), v); }
  return d;
};
// 통과해야 하는 결과물: supabase-js 의 접두어 검사 코드, 기사 데이터(해시·본문 'eyJ' 글자), 점으로 이은 해시, 이미지 바이트
const clean = {
  'index.html': '<!doctype html><title>흑석일보</title><script src="/_next/static/chunks/a.js"></script>',
  '_next/static/chunks/324.js': 'let tC=e=>e.startsWith("sb_publishable_")||e.startsWith("sb_secret_");',
  'data/insurance/2026-11.json': JSON.stringify([{ id: 'a3f9c1e07b2d4e5f8a9b0c1d2e3f4a5b', title: 'eyJ 로 시작하는 토큰 형식 해설', url: 'https://x/eyJabc' }]),
  'data/insurance/trends.json': JSON.stringify({ hash: 'abcdefghij0123456789.klmnopqrst0123456789.uvwxyzABCD0123456789' }),
  'og.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]),
};
{
  const r = run(site(clean));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /비밀 키 검사 통과: 파일 5개/);
  assert.match(r.out, /접두어만 있고 키 값은 없는 파일 1개.*324\.js/, '라이브러리 접두어는 통과시키되 알림');
}
// 실패해야 하는 결과물: 파일 경로·종류만 쓰고 값은 출력하지 않는다
for (const [name, file, body] of [
  ['새 방식 비밀 키', '_next/static/chunks/app/page-1.js', `const k="${FAKE_SECRET}";`],
  ['service_role', 'data/ai/2026-11.json', `{"role":"${ROLE}"}`],
  ['JWT 모양', 'login/index.html', `<script>var k='${FAKE_JWT}'</script>`],
] as const) {
  const r = run(site({ ...clean, [file]: body }));
  assert.equal(r.code, 1, `${name}: 실패해야 함`);
  assert.match(r.out, /비밀 키 검사 실패/);
  assert.ok(r.out.includes(file), `${name}: 파일 경로를 알린다`);
  assert.ok(!r.out.includes(FAKE_SECRET) && !r.out.includes(FAKE_JWT) && !r.out.includes(FAKE_JWT.split('.')[2]), `${name}: 값은 출력하지 않음`);
}
{
  const r = run(site({ ...clean, 'a.js': FAKE_SECRET, 'b/c.html': FAKE_JWT }));
  assert.equal(r.code, 1);
  assert.match(r.out, /2곳/);
}
assert.equal(run(join(tmpdir(), 'heukseok-없는-폴더-' + Date.now())).code, 2, '폴더가 없으면 실패(통과로 착각하지 않게)');
for (const d of temps) rmSync(d, { recursive: true, force: true });

// 배포 워크플로: 빌드 직후·업로드 전에 이 검사를 돌린다
const wf = readFileSync('.github/workflows/deploy.yml', 'utf8');
const iBuild = wf.indexOf('- run: npm run build'), iCheck = wf.indexOf('node scripts/check-build-secrets.mjs out'), iUpload = wf.indexOf('actions/upload-pages-artifact');
assert.ok(iBuild > 0 && iCheck > iBuild && iUpload > iCheck, '빌드 → 비밀 키 검사 → 업로드 순서');
console.log('build-secrets tests passed');
