/** 이전 동등성 검증(화면): 옛 사이트 빌드(out/)와 새 사이트 빌드(out/insurance/)의 카테고리·건수·필터가 같은지 확인한다.
 *
 *   node --experimental-strip-types scripts/audit/equivalence_site.ts <옛 코드 사본 폴더>
 *
 * 두 쪽 모두 `npm run build` 가 끝난 상태여야 한다. 브라우저 없이 확인한다:
 * 1) 배포되는 data JSON 이 바이트 단위로 같은지  2) 정적 HTML 의 본문(탭·카테고리 버튼·필터 버튼·안내 문구)이 같은지
 * 3) 같은 데이터에 옛/새 lib 함수와 옛/새 설정(카테고리 순서·보험사·기관 그룹)을 적용한 건수·필터 옵션이 같은지.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OLD = resolve(process.argv[2] ?? '');
const NEW = resolve(import.meta.dirname, '../..');
if (!existsSync(join(OLD, 'out/index.html')) || !existsSync(join(NEW, 'out/insurance/index.html'))) throw new Error('두 쪽 모두 npm run build 가 필요합니다.');
const errs: string[] = [];
const check = (label: string, fn: () => void) => { try { fn(); console.log(`  ✓ ${label}`); } catch (e) { errs.push(label); console.log(`  ✗ ${label}\n${(e as Error).message.slice(0, 1500)}`); } };

// 1) 배포 data
const oldData = join(OLD, 'out/data'), newData = join(NEW, 'out/data/insurance');
const files = readdirSync(oldData).filter(f => f.endsWith('.json')).sort();
check(`배포 data 파일 목록·내용 동일 (${files.length}개)`, () => {
  assert.deepEqual(readdirSync(newData).sort(), files);
  for (const f of files) assert.ok(readFileSync(join(oldData, f)).equals(readFileSync(join(newData, f))), f);
});

// 2) 정적 HTML 본문(<main class="shell">). 헤더·푸터(브랜드)는 의도적으로 바뀌었으므로 제외.
//    의도한 문구 변경: 설정 경로 config/ → channels/insurance/
const INTENDED: [RegExp, string][] = [[/config\/keywords\.json/g, 'channels/insurance/keywords.json']];
const mainText = (html: string) => {
  const m = /<main class="shell"[^>]*>([\s\S]*?)<\/main>/.exec(html);
  if (!m) throw new Error('main 없음');
  return m[1].replace(/<!--.*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<(input|select|option)\b[^>]*>/g, t => ` ${(/(placeholder|value|aria-label)="([^"]*)"/g.exec(t) ?? [])[0] ?? ''} `)
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};
const pick = (html: string, re: RegExp) => [...html.matchAll(re)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim());
for (const [o, n] of [['index.html', 'insurance/index.html'], ['week/index.html', 'insurance/week/index.html'], ['trends/index.html', 'insurance/trends/index.html'], ['status/index.html', 'insurance/status/index.html']]) {
  const ho = readFileSync(join(OLD, 'out', o), 'utf8'), hn = readFileSync(join(NEW, 'out', n), 'utf8');
  check(`${o} ↔ ${n} 본문 텍스트 동일`, () => {
    let t = mainText(ho);
    for (const [re, to] of INTENDED) t = t.replace(re, to);
    assert.equal(mainText(hn), t);
  });
  check(`${o} ↔ ${n} 탭·카테고리·필터 버튼 동일`, () => {
    for (const re of [/<nav class="primary"[^>]*>([\s\S]*?)<\/nav>/g, /<nav class="categories"[^>]*>([\s\S]*?)<\/nav>/g, /class="sourceBtn[^"]*"[^>]*>([\s\S]*?)<svg/g, /<label class="check"[^>]*>([\s\S]*?)<\/label>/g, /placeholder="([^"]*)"/g, /<option value="[^"]*">([^<]*)</g])
      assert.deepEqual(pick(hn, re), pick(ho, re), String(re));
  });
}

// 3) 건수·필터 옵션: 같은 데이터에 옛/새 lib·설정 적용
type A = { id: string; source: string; source_type: string; category: string; relevant?: boolean; companies?: string[]; orgs?: string[]; published_at: string; score: number };
const articles: A[] = files.filter(f => /^\d{4}-\d{2}\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(join(newData, f), 'utf8')));
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const lib = async (root: string, name: string) => import(pathToFileURL(join(root, 'lib', name)).href);
const sides = await Promise.all([[OLD, join(OLD, 'config')], [NEW, join(NEW, 'channels/insurance')]].map(async ([root, cfg]) => {
  const facets = await lib(root, 'facets.ts'), sources = await lib(root, 'sources.ts'), hl = await lib(root, 'highlights.ts');
  const cats = Object.keys(json(join(cfg, 'categories.json')).categories);
  const cg = Object.fromEntries(json(join(cfg, 'companies.json')).companies.map((c: { name: string; group: string }) => [c.name, c.group]));
  const og = Object.fromEntries(json(join(cfg, 'orgs.json')).orgs.map((c: { name: string; group: string }) => [c.name, c.group]));
  const rel = articles.filter(a => a.relevant !== false);
  const byCat = (rows: A[]) => Object.fromEntries(['전체', ...cats].map(c => [c, rows.filter(a => c === '전체' || a.category === c).length]));
  const today = '2026-11-11';
  return {
    categories: cats,
    countsRelevant: byCat(rel), countsAll: byCat(articles),
    press: { relevant: rel.filter(a => a.source_type === 'press').length, all: articles.filter(a => a.source_type === 'press').length },
    sourceOptions: sources.sourceOptions(rel),
    companyOptions: facets.groupOptions(facets.facetOptions(rel, (a: A) => a.companies ?? [], [], (n: string) => cg[n]), json(join(cfg, 'companies.json')).groups),
    orgOptions: facets.groupOptions(facets.facetOptions(rel, (a: A) => a.orgs ?? [], [], (n: string) => og[n]), json(join(cfg, 'orgs.json')).groups),
    week: ['전체', ...cats].map(c => hl.weeklyHighlights(articles, today, 20, c).map((a: A) => a.id)),
  };
}));
for (const k of Object.keys(sides[0]) as (keyof typeof sides[0])[]) check(`건수·필터: ${k}`, () => assert.deepEqual(sides[1][k], sides[0][k]));
console.log(`  카테고리(관련 기사): ${JSON.stringify(sides[1].countsRelevant)}`);
console.log(`  언론사 ${sides[1].sourceOptions.length}곳 · 보험사 ${sides[1].companyOptions.reduce((s: number, g: { options: unknown[] }) => s + g.options.length, 0)}곳 · 유관기관 ${sides[1].orgOptions.reduce((s: number, g: { options: unknown[] }) => s + g.options.length, 0)}곳 · 감독당국 탭 ${sides[1].press.relevant}건`);

console.log('동등성(화면):', errs.length ? `다름 ${errs.length}건` : '같음');
process.exit(errs.length ? 1 : 0);
