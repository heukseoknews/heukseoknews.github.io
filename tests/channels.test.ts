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
  assert.ok(c.hidden === undefined || typeof c.hidden === 'boolean', `${d}: hidden 은 true/false`);
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

// 공개 여부 = lib/directory.ts status(live | soon) 하나. channel.json 의 hidden 은 화면이 읽지 않는다.
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
for (const f of ['components/SiteHeader.tsx', 'components/Footer.tsx']) assert.ok(!readFileSync(f, 'utf8').includes("'status/', '수집 상태'"), `${f}: 수집 상태 메뉴 없음`);

// 보험 채널은 옛 사이트와 같은 이름·라벨·색
const ins = JSON.parse(readFileSync('channels/insurance/channel.json', 'utf8'));
assert.deepEqual(ins.tabs, { new: '새 뉴스', all: '전체 뉴스', press: '감독당국 보도자료', bookmarks: '북마크' });
assert.deepEqual(ins.filters, { sources: '언론사', companies: '보험사', orgs: '유관기관' });
assert.equal(ins.subtitle, '보험·계리·금융시장');
assert.deepEqual(ins.storage.legacy_keys, { saved: 'actuary-news-hub-v3', companies: 'actuary-news-hub-companies-v1' });
assert.equal(ins.notices.press.title, '금융위원회 · 금융감독원 관련 자료');
assert.equal(ins.press_discovery_label, true);
// AI 채널은 보험용 안내·수집 경로 표기를 쓰지 않는다
const ai = JSON.parse(readFileSync('channels/ai/channel.json', 'utf8'));
assert.equal(ai.notices?.press, undefined); assert.notEqual(ai.press_discovery_label, true);
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

// 테마 값 검사: 위험한 이름·값은 버린다
assert.equal(themeCss({ '--a': '#fff', 'color': 'red', '--b': 'red;}body{x:y', '--c': 'url(javascript:x)' }), ':root{--a:#fff}');
assert.equal(themeCss({}), '');
console.log('channels tests passed');
