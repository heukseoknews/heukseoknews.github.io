import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { themeCss } from '../lib/theme.ts';
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

// 기본 채널(보험)은 숨김일 수 없다(포털 / 가 이동하는 곳). 숨김 채널은 등록·빌드하되 전환·포털에는 나오지 않는다(lib/channels.ts VISIBLE_CHANNELS)
assert.notEqual(JSON.parse(readFileSync('channels/insurance/channel.json', 'utf8')).hidden, true, '기본 채널은 숨길 수 없다');
assert.match(registry, /VISIBLE_CHANNELS[^\n]*filter\(c => !c\.hidden\)/, 'VISIBLE_CHANNELS 는 hidden 을 뺀다');
for (const f of ['components/ChannelSwitcher.tsx', 'app/page.tsx']) assert.ok(readFileSync(f, 'utf8').includes('VISIBLE_CHANNELS') && !/\bCHANNELS\.map/.test(readFileSync(f, 'utf8')), `${f}: 숨김 채널을 링크하면 안 됨`);

// 보험 채널은 옛 사이트와 같은 이름·라벨·색
const ins = JSON.parse(readFileSync('channels/insurance/channel.json', 'utf8'));
assert.deepEqual(ins.tabs, { new: '새 뉴스', all: '전체 뉴스', press: '감독당국 보도자료', bookmarks: '북마크' });
assert.deepEqual(ins.filters, { sources: '언론사', companies: '보험사', orgs: '유관기관' });
assert.equal(ins.subtitle, '보험·계리·금융시장');
assert.deepEqual(ins.storage.legacy_keys, { saved: 'actuary-news-hub-v3', companies: 'actuary-news-hub-companies-v1' });
const css = readFileSync('app/globals.css', 'utf8');
assert.ok(css.startsWith(':root{--brand:#155099;--brand-strong:#204e87;--brand-dark:#173e74;'), 'globals.css 기본 색 = 보험 테마');
assert.equal(themeCss(JSON.parse(readFileSync('channels/insurance/theme.json', 'utf8')).vars), ':root{--brand:#155099;--brand-strong:#204e87;--brand-dark:#173e74}');

// 테마 값 검사: 위험한 이름·값은 버린다
assert.equal(themeCss({ '--a': '#fff', 'color': 'red', '--b': 'red;}body{x:y', '--c': 'url(javascript:x)' }), ':root{--a:#fff}');
assert.equal(themeCss({}), '');
console.log('channels tests passed');
