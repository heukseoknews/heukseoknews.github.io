// 채널을 바꿔도 화면 틀이 같은지 측정한다(docs/design-plan.md "채널은 색과 내용만 바뀐다").
//   node scripts/measure-layout.mjs [기준 주소=http://localhost:4173] [--json 결과.json] [--shots 폴더]
// 빌드 결과(out/)를 정적 서버로 띄운 뒤 실행한다. Playwright 가 필요하다(저장소 의존성이 아니므로
// PLAYWRIGHT=<playwright 모듈 경로> 로 알려 주거나 전역 설치). 폭 1440·1024·768·390 에서 보험·AI·금융을 오가며
// 헤더 메뉴·채널 이동 줄·탭 줄 요소의 왼쪽 x(DOM getBoundingClientRect)를 재고, 채널 사이 차이가 1px 넘으면 종료 코드 1.
// 홈·채널·마이페이지의 본문 컨테이너 왼쪽 여백도 같은지 본다. 모바일(≤640px)은 헤더 메뉴가 햄버거 안에 있어 열어서 잰다.
const args = process.argv.slice(2);
const base = (args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'http://localhost:4173').replace(/\/$/, '');
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');

const WIDTHS = [1440, 1024, 768, 390];
const CHANNELS = ['insurance', 'ai', 'finance'];
const TOL = 1;

const b = await chromium.launch();
const result = {};
let bad = 0;
for (const w of WIDTHS) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  const rows = {};
  for (const ch of CHANNELS) {
    await p.goto(`${base}/${ch}/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    if (w <= 640) { await p.click('button.menuBtn'); await p.waitForTimeout(100); }
    rows[ch] = await p.evaluate(() => {
      const x = el => el ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null;
      const r = {};
      document.querySelectorAll('nav[aria-label="사이트 메뉴"] li a').forEach((a, i) => { r[`메뉴${i + 1}`] = x(a); });
      document.querySelectorAll('.chRow li > *').forEach((a, i) => { r[`채널${i + 1}`] = x(a); r[`채널${i + 1}폭`] = Math.round(a.getBoundingClientRect().width * 10) / 10; });
      document.querySelectorAll('nav.primary button').forEach((a, i) => { r[`탭${i + 1}`] = x(a); });
      r['본문'] = x(document.querySelector('main.shell'));
      r['본문안쪽'] = (() => { const m = document.querySelector('main.shell'); return m ? Math.round((m.getBoundingClientRect().left + parseFloat(getComputedStyle(m).paddingLeft)) * 10) / 10 : null; })();
      return r;
    });
    if (opt('--shots')) await p.screenshot({ path: `${opt('--shots')}/layout-${ch}-${w}.png` });
  }
  // 홈·마이페이지 컨테이너 왼쪽(안쪽 여백 포함)
  const inner = async (url, sel) => { await p.goto(`${base}${url}`, { waitUntil: 'networkidle' }); return p.evaluate(s => { const m = document.querySelector(s); if (!m) return null; const r = m.getBoundingClientRect(); return Math.round((r.left + parseFloat(getComputedStyle(m).paddingLeft)) * 10) / 10; }, sel); };
  const pages = { 홈: await inner('/', '.homeMain'), 마이페이지: await inner('/me/', 'main.shell') };
  const keys = [...new Set(CHANNELS.flatMap(c => Object.keys(rows[c])))];
  const diff = {};
  for (const k of keys) {
    const v = CHANNELS.map(c => rows[c][k]).filter(x => x !== null && x !== undefined);
    diff[k] = v.length ? Math.round((Math.max(...v) - Math.min(...v)) * 10) / 10 : null;
    if (diff[k] > TOL) bad++;
  }
  result[w] = { rows, diff, pages };
  console.log(`\n== ${w}px`);
  console.log(['요소', ...CHANNELS, '차이'].join('\t'));
  for (const k of keys) console.log([k, ...CHANNELS.map(c => rows[c][k] ?? '-'), (diff[k] ?? '-') + (diff[k] > TOL ? ' ✗' : '')].join('\t'));
  console.log(`홈 ${pages.홈} · 채널 ${rows.insurance['본문안쪽']} · 마이페이지 ${pages.마이페이지} (본문 왼쪽, 안쪽 여백 포함)`);
  await p.close();
}
await b.close();
if (opt('--json')) (await import('node:fs')).writeFileSync(opt('--json'), JSON.stringify(result, null, 1));
console.log(bad ? `\n채널 사이 차이 ${TOL}px 초과 ${bad}곳` : '\n채널 사이 차이 모두 1px 이내');
process.exit(bad ? 1 : 0);
