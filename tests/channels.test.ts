import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PLANNED_THEMES, THEME_KEYS, contrast, themeCss } from '../lib/theme.ts';
import { DIRECTORY, channelRow, statusOf } from '../lib/directory.ts';
import { loadChannels, planChannels } from '../scripts/plan-channels.mjs';

// 채널 폴더 = lib/channels.ts 등록, 채널 수집 시각(schedule_utc) ⊂ deploy.yml cron, 매트릭스는 scripts/plan-channels.mjs
const dirs = readdirSync('channels', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
assert.ok(dirs.includes('insurance'));
const registry = readFileSync('lib/channels.ts', 'utf8');
const registered = [...new Set([...registry.matchAll(/'\.\.\/channels\/([a-z0-9-]+)\/channel\.json'/g)].map(m => m[1]))].sort();
assert.deepEqual(registered, dirs, 'channels/ 폴더와 lib/channels.ts 등록이 다르다');
const wf = readFileSync('.github/workflows/deploy.yml', 'utf8');
const crons = [...wf.matchAll(/cron: '([^']+)'/g)].map(m => m[1]);
assert.ok(crons.length >= 1 && /fromJSON\(needs\.plan\.outputs\.channels\)/.test(wf), '매트릭스는 plan 잡 결과로');
const used = new Set<string>();

const REQUIRED = ['slug', 'name', 'subtitle', 'description', 'locale', 'timezone', 'schedule_utc', 'tabs', 'filters'];
for (const d of dirs) {
  const c = JSON.parse(readFileSync(`channels/${d}/channel.json`, 'utf8'));
  for (const k of REQUIRED) assert.ok(c[k], `${d}/channel.json: ${k} 없음`);
  assert.equal(c.slug, d);
  assert.equal(c.hidden, undefined, `${d}: 공개 여부는 lib/directory.ts status — channel.json hidden 은 쓰지 않는다`);
  assert.deepEqual(Object.keys(c.tabs).sort(), ['all', 'bookmarks', 'new', 'press']);
  assert.deepEqual(Object.keys(c.filters).sort(), ['companies', 'orgs', 'sources']);
  assert.ok(Array.isArray(c.schedule_utc) && c.schedule_utc.length, `${d}: schedule_utc 는 cron 목록`);
  for (const x of c.schedule_utc) { assert.ok(crons.includes(x), `${d}: schedule_utc '${x}' 가 deploy.yml cron 에 없다`); used.add(x); }
  assert.ok(c.collect === undefined || typeof c.collect === 'boolean', `${d}: collect 는 true/false`);
  assert.doesNotThrow(() => new Intl.DateTimeFormat(c.locale, { timeZone: c.timezone }));
  // 화면의 날짜 키(lib/dates.ts KST_MS)·이름 정렬(lib/facets.ts, lib/sources.ts 'ko')은 아직 KST·한국어 고정이다.
  // 다른 timezone·locale 채널을 만들려면 화면 코드를 먼저 일반화해야 하므로 여기서 막는다(수집기는 channel.json timezone 을 이미 읽는다).
  assert.equal(c.timezone, 'Asia/Seoul', `${d}: 화면 날짜 코드가 KST 고정 — 다른 타임존은 lib/dates.ts 일반화 후`);
  assert.ok(c.locale.startsWith('ko'), `${d}: 화면 정렬이 'ko' 고정 — 다른 locale 은 lib/facets.ts 일반화 후`);
  const t = JSON.parse(readFileSync(`channels/${d}/theme.json`, 'utf8'));
  assert.equal(themeCss(t.vars).split(';').length, Object.keys(t.vars).length, `${d}/theme.json: 허용되지 않는 변수·값`);
  for (const f of ['categories', 'companies', 'orgs', 'score', 'feeds', 'boards', 'keywords']) JSON.parse(readFileSync(`channels/${d}/${f}.json`, 'utf8'));
}

for (const x of crons) assert.ok(used.has(x), `deploy.yml cron '${x}' 를 쓰는 채널이 없다`);

// 매트릭스 계획: 예약 시각별 채널, collect:false 제외, 수동 실행·push
const real = loadChannels();
assert.deepEqual(planChannels(real, 'push'), []);
const ch = [{ slug: 'ai', schedule_utc: ['37 20 * * *', '37 4 * * *'], collect: true }, { slug: 'insurance', schedule_utc: ['37 20 * * *'] }];
assert.deepEqual(planChannels(ch, 'schedule', '37 20 * * *'), ['ai', 'insurance']);
assert.deepEqual(planChannels(ch, 'schedule', '37 4 * * *'), ['ai']);
assert.deepEqual(planChannels(ch, 'schedule', '0 0 * * *'), []);
assert.deepEqual(planChannels(ch, 'workflow_dispatch'), ['ai', 'insurance']);
assert.deepEqual(planChannels(ch, 'workflow_dispatch', '', 'ai'), ['ai']);
assert.deepEqual(planChannels([{ ...ch[0], collect: false }, ch[1]], 'schedule', '37 4 * * *'), [], 'collect:false 는 제외');
// 보험 채널은 20:37 에 수집된다(지금과 같음)
assert.ok(planChannels(real, 'schedule', '37 20 * * *').includes('insurance') && planChannels(real, 'workflow_dispatch').includes('insurance'));

// 공개 여부 = lib/directory.ts status(live | soon) 하나(channel.json 에 hidden 없음).
const byDir = Object.fromEntries(DIRECTORY.map(d => [d.slug, d]));
assert.equal(DIRECTORY.length, new Set(DIRECTORY.map(d => d.slug)).size, 'DIRECTORY slug 중복');
for (const d of dirs) {
  assert.ok(byDir[d], `${d}: lib/directory.ts DIRECTORY 에 없음`);
  assert.equal(byDir[d].name, JSON.parse(readFileSync(`channels/${d}/channel.json`, 'utf8')).name, `${d}: 이름이 channel.json 과 다름`);
}
for (const e of DIRECTORY) {
  assert.ok(['live', 'soon'].includes(e.status), `${e.slug}: status 는 live | soon`);
  assert.ok(e.card && e.name, `${e.slug}: 이름·카드 설명`);
  if (e.status === 'live') assert.ok(dirs.includes(e.slug), `${e.slug}: live 채널은 channels/ 폴더(페이지)가 있어야 한다`);
  if (!dirs.includes(e.slug)) assert.ok(PLANNED_THEMES[e.slug], `${e.slug}: 폴더 없는 채널은 PLANNED_THEMES 에 색`);
}
assert.equal(statusOf('insurance'), 'live', '기본 채널(보험)은 공개');
assert.equal(statusOf('ai'), 'soon'); assert.equal(statusOf('finance'), 'soon'); assert.ok(!dirs.includes('finance'));
assert.deepEqual(DIRECTORY.map(d => [d.slug, d.card]), [['insurance', '보험·계리·금융시장'], ['ai', '모델·오픈소스·정책·산업'], ['finance', '은행·금융권 뉴스']]);
// 채널 이동 줄: live 와 지금 채널만 링크, 준비 중은 링크 없음
const row = (cur: string) => channelRow(cur).map(r => [r.slug, r.href, r.current]);
assert.deepEqual(row('insurance'), [['insurance', '/insurance/', true], ['ai', null, false], ['finance', null, false]]);
assert.deepEqual(row('ai'), [['insurance', '/insurance/', false], ['ai', '/ai/', true], ['finance', null, false]]);
// 화면 코드: hidden 대신 status, 이동 줄은 channelRow, 숨김 채널 목록 직접 링크 금지
for (const f of ['app/[channel]/layout.tsx', 'lib/meta.ts']) { const t = readFileSync(f, 'utf8'); assert.ok(t.includes('robotsFor(c)') && !t.includes('.hidden'), `${f}: noindex 는 status(robotsFor)`); }
assert.match(registry, /robotsFor = \(c: Channel\) => \(c\.status === 'live' \? \{\} : \{ robots: \{ index: false, follow: false \} \}\)/);
const sw = readFileSync('components/ChannelSwitcher.tsx', 'utf8');
assert.ok(sw.includes('channelRow(ch.slug)') && !/\bCHANNELS\.map/.test(sw) && sw.includes('aria-disabled="true"'), 'ChannelSwitcher: channelRow, 준비 중은 비활성 span');
// 수집 상태(/status/) 링크는 사이트 어디에도 없다(페이지는 주소로만). 지연 배지는 표시만.
for (const f of ['components/SiteHeader.tsx', 'components/Footer.tsx', 'components/ChannelSwitcher.tsx', 'components/StaleNotice.tsx', 'app/page.tsx', 'app/[channel]/page.tsx', 'app/[channel]/layout.tsx'])
  assert.ok(!/['"`]status\/['"`]|\/status\//.test(readFileSync(f, 'utf8')), `${f}: 수집 상태 링크 없음`);
assert.match(readFileSync('components/SiteHeader.tsx', 'utf8'), /<span className="collectBadge warn" role="status"/);

// 보험 채널은 옛 사이트와 같은 이름·라벨·색
const ins = JSON.parse(readFileSync('channels/insurance/channel.json', 'utf8'));
assert.deepEqual(ins.tabs, { new: '새 뉴스', all: '전체 뉴스', press: '감독당국 보도자료', bookmarks: '북마크' });
assert.deepEqual(ins.filters, { sources: '언론사', companies: '보험사', orgs: '유관기관' });
assert.equal(ins.subtitle, '보험·계리·금융시장');
assert.deepEqual(ins.storage.legacy_keys, { saved: 'actuary-news-hub-v3', companies: 'actuary-news-hub-companies-v1' });
// 화면이 읽지 않는 설정은 두지 않는다(옛 탭 안내 notices·수집 경로 표기 press_discovery_label 삭제)
for (const d of dirs) {
  const c = JSON.parse(readFileSync(`channels/${d}/channel.json`, 'utf8'));
  assert.ok(!('notices' in c) && !('press_discovery_label' in c), `${d}/channel.json: 쓰지 않는 설정 notices·press_discovery_label 없음`);
}
assert.ok(!/notices|press_discovery_label/.test(registry), 'ChannelMeta 에도 없음');
const page = readFileSync('app/[channel]/page.tsx', 'utf8');
assert.ok(!page.includes('금융위원회'), '보험 전용 안내 문구는 channel.json 으로');
const css = readFileSync('app/globals.css', 'utf8');
assert.ok(css.startsWith(':root{--accent:#1756A9;--accent-strong:#0F3F80;--accent-soft:#EAF1FB;--accent-dark:#7FB0F0;'), 'globals.css 기본 색 = 보험 테마');
assert.equal(themeCss(JSON.parse(readFileSync('channels/insurance/theme.json', 'utf8')).vars), ':root{--accent:#1756A9;--accent-strong:#0F3F80;--accent-soft:#EAF1FB;--accent-dark:#7FB0F0}');
assert.match(css, /--brand:var\(--accent\);--brand-strong:var\(--accent-strong\)/, '옛 변수 이름은 accent 의 별칭');

// 채널 테마 4색과 대비(WCAG AA): 흰 바탕 글자·흰 글자 얹기 4.5, soft 위 strong·accent 4.5, 어두운 바탕(#11161D) 위 dark 4.5
const themes: Record<string, Record<string, string>> = { ...Object.fromEntries(dirs.map(d => [d, JSON.parse(readFileSync(`channels/${d}/theme.json`, 'utf8')).vars])), ...PLANNED_THEMES };
for (const d of Object.keys(PLANNED_THEMES)) assert.ok(!dirs.includes(d), `${d}: 폴더가 생기면 PLANNED_THEMES 에서 theme.json 으로 옮긴다`);
for (const [slug, t] of Object.entries(themes)) {
  assert.deepEqual(Object.keys(t).sort(), [...THEME_KEYS].sort(), `${slug}: 테마는 accent·strong·soft·dark 4색`);
  for (const v of Object.values(t)) assert.match(v, /^#[0-9A-Fa-f]{6}$/);
  const [a, s, so, dk] = THEME_KEYS.map(k => t[k]);
  for (const [label, x, y] of [['accent/흰 바탕', a, '#FFFFFF'], ['accent/페이지 바탕', a, '#F6F7F9'], ['strong/soft', s, so], ['accent/soft', a, so], ['dark/어두운 바탕', dk, '#11161D']] as const)
    assert.ok(contrast(x, y) >= 4.5, `${slug} ${label} 대비 ${contrast(x, y).toFixed(2)} < 4.5`);
}
// 채널 색은 서로 달라야 한다(보험 파랑·AI 보라·금융 초록)
assert.equal(new Set(Object.values(themes).map(t => t['--accent'].toLowerCase())).size, Object.keys(themes).length);
assert.equal(themes.ai['--accent'], '#6A3FD0');
assert.equal(themes.finance['--accent'], '#127346');
// 공통 글자색 대비
for (const [c, min] of [['#16202b', 4.5], ['#55606e', 4.5], ['#646f7f', 4.5], ['#7d8796', 3]] as const) {
  assert.ok(css.includes(c), `globals.css 에 ${c}`);
  assert.ok(contrast(c, '#ffffff') >= min && contrast(c, '#f6f7f9') >= min, `${c} 대비`);
}

// 푸터: 수집 상태 링크·빌드 시각·commit 없음(version.json 은 유지), 문의·마지막 수집만
const footer = readFileSync('components/Footer.tsx', 'utf8');
assert.ok(!/status\/|수집 상태|formatBuild|useVersion|\.commit/.test(footer), '푸터에 수집 상태 링크·빌드 정보 없음');
assert.ok(footer.includes('SITE.issues') && footer.includes('마지막 수집') && footer.includes('SITE.nameEn'));
// 차트 색: 토큰(1번 = 채널 색), 나머지는 흰 바탕 3:1 이상(그래픽), 축 글자는 --muted(4.5:1 이상)
const trendsPage = readFileSync('app/[channel]/trends/page.tsx', 'utf8');
assert.ok(!/#[0-9a-fA-F]{6}/.test(trendsPage), 'trends 화면에 하드코딩 색 없음');
const chartColors = [...css.matchAll(/--chart-(\d):([^;]+);/g)].map(m => [m[1], m[2]]);
assert.equal(chartColors.length, 7); assert.equal(chartColors[0][1], 'var(--accent)');
for (const [, c] of chartColors.slice(1)) assert.ok(contrast(c, '#FFFFFF') >= 3, `차트 색 ${c} 대비`);
assert.match(css, /\.chart \.axis\{fill:var\(--muted\)\}/);
// 북마크 채움 = 채널 색 토큰
const card = readFileSync('components/ArticleCard.tsx', 'utf8');
assert.ok(!/#[0-9a-fA-F]{6}/.test(card) && /\.bookmark \.saved\{fill:var\(--accent\)\}/.test(css));

// 공식 발표 배지 = 채널 토큰(고정색 없음): soft 바탕 + strong 글자 + accent 테두리. 대비는 위 테마 검사(strong/soft·accent/soft 4.5 이상)
assert.match(css, /\.pill\.official\{background:var\(--accent-soft\);color:var\(--accent-strong\);box-shadow:inset 0 0 0 1px var\(--accent\)\}/);
// 한국어 줄바꿈은 낱말 단위, 긴 영문·URL 은 넘치지 않게
assert.match(css, /body\{margin:0;word-break:keep-all;overflow-wrap:anywhere\}/);
// 본문 포커스 표시: 2px 채널색(키보드 포커스만)
assert.ok(css.includes('.shell :is(a,button,input,select,summary):focus-visible{outline:2px solid var(--accent);outline-offset:2px}'));
assert.ok(!/outline:3px solid var\(--brand\)/.test(css), '본문 포커스 3px 고정색 없음');

// 테마 값 검사: 위험한 이름·값은 버린다
assert.equal(themeCss({ '--a': '#fff', 'color': 'red', '--b': 'red;}body{x:y', '--c': 'url(javascript:x)' }), ':root{--a:#fff}');
assert.equal(themeCss({}), '');
console.log('channels tests passed');
