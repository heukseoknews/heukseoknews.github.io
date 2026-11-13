// 배포 전 비밀 키 검사: 정적 빌드 결과물(out/) 전체에서 비밀 키 모양 문자열을 찾는다. 한 건이라도 있으면 종료 코드 1(배포 중단).
//   node scripts/check-build-secrets.mjs [폴더=out]
// 찾는 것(찾은 값은 출력하지 않고 파일 경로와 종류만 쓴다)
//   1. 새 방식 비밀 키: 'sb_secret_' 뒤에 키 글자 20자 이상. 접두어만 있는 것('sb_secret_' 뒤가 따옴표 등)은 supabase-js 의
//      키 형식 검사 코드(e.startsWith("sb_secret_"))라 통과시키고 따로 알린다.
//   2. 'service_role' 문자열(예전 방식 비밀 키의 역할 이름). 지금 결과물에는 없다.
//   3. JWT 모양 키: eyJ 로 시작하는 머리.몸통.서명 세 마디(머리·몸통 모두 eyJ = base64 의 '{"' 로 시작, 서명 20자 이상).
//      예전 방식 키(anon·service_role)는 모두 이 모양이다. 사이트는 publishable 키만 쓰므로 anon JWT 도 들어 있으면 안 된다.
// 이미지·글꼴도 바이트를 그대로 글자로 읽어 함께 본다(위 모양이 우연히 나올 가능성은 사실상 없다).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'out';
const RULES = [
  { kind: '새 방식 비밀 키(sb_secret_…)', re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { kind: 'service_role 문자열', re: /service_role/g },
  { kind: 'JWT 모양 키(eyJ….eyJ….…)', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g },
];
const PREFIX_ONLY = /sb_secret_(?![A-Za-z0-9_-]{20,})/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

let files = 0;
const problems = [];
const prefixOnly = [];
try { statSync(root); } catch { console.error(`비밀 키 검사: 폴더가 없습니다 — ${root}`); process.exit(2); }
for (const p of walk(root)) {
  files++;
  const text = readFileSync(p).toString('latin1');
  const rel = relative(root, p);
  for (const r of RULES) {
    const n = (text.match(r.re) ?? []).length;
    if (n) problems.push(`${rel}: ${r.kind} ${n}건`);
  }
  if (PREFIX_ONLY.test(text)) prefixOnly.push(rel);
  PREFIX_ONLY.lastIndex = 0;
}

if (prefixOnly.length) console.log(`참고: 'sb_secret_' 접두어만 있고 키 값은 없는 파일 ${prefixOnly.length}개(supabase-js 키 형식 검사 코드) — 통과: ${prefixOnly.join(', ')}`);
if (problems.length) {
  console.error(`비밀 키 검사 실패: ${problems.length}곳 — 배포를 멈춘다(값은 출력하지 않음)`);
  for (const l of problems) console.error(`  ✗ ${l}`);
  process.exit(1);
}
console.log(`비밀 키 검사 통과: 파일 ${files.toLocaleString()}개에서 비밀 키·service_role·JWT 모양 없음`);
