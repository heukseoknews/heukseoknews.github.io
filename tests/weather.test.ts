import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AIR_URL, CACHE_KEY, CACHE_TTL_MS, FORECAST_URL, type KV, average24, loadWeather, parseForecast, pmGrade, readCache, roundTemp, skyOf, writeCache } from '../lib/weather.ts';

// ── 날씨 코드 → 하늘 상태 ──
assert.deepEqual(skyOf(0), { text: '맑음', icon: 'sun' });
assert.deepEqual(skyOf(2), { text: '구름 조금', icon: 'cloudSun' });
assert.equal(skyOf(3)?.text, '흐림');
assert.equal(skyOf(45)?.text, '안개'); assert.equal(skyOf(48)?.icon, 'fog');
assert.equal(skyOf(53)?.icon, 'drizzle');
assert.equal(skyOf(61)?.text, '비'); assert.equal(skyOf(65)?.text, '강한 비');
assert.equal(skyOf(73)?.text, '눈'); assert.equal(skyOf(77)?.icon, 'snow');
assert.equal(skyOf(81)?.text, '소나기'); assert.equal(skyOf(86)?.text, '눈 소나기');
assert.equal(skyOf(95)?.icon, 'storm'); assert.equal(skyOf(99)?.text, '우박 동반 뇌우');
// Open-Meteo 문서 WW 표의 코드는 모두 변환된다
for (const c of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99]) assert.ok(skyOf(c), `code ${c}`);
assert.equal(skyOf(4), null); assert.equal(skyOf(-1), null); assert.equal(skyOf(100), null);

// 기온 반올림: 0에서 먼 쪽, -0 은 0
assert.equal(roundTemp(-11.5), -12); assert.equal(roundTemp(11.5), 12); assert.equal(roundTemp(-0.4), 0); assert.ok(Object.is(roundTemp(-0.4), 0)); assert.equal(roundTemp(7.6), 8);

// ── 미세먼지 등급 경계(환경부·에어코리아: PM10 30/80/150, PM2.5 15/35/75, 반올림 뒤 판정) ──
const g10: [number, string][] = [[0, '좋음'], [30, '좋음'], [30.4, '좋음'], [30.5, '보통'], [31, '보통'], [80, '보통'], [81, '나쁨'], [150, '나쁨'], [151, '매우나쁨'], [600, '매우나쁨']];
for (const [v, g] of g10) assert.equal(pmGrade('pm10', v), g, `pm10 ${v}`);
const g25: [number, string][] = [[0, '좋음'], [15, '좋음'], [15.49, '좋음'], [15.5, '보통'], [16, '보통'], [35, '보통'], [36, '나쁨'], [75, '나쁨'], [76, '매우나쁨']];
for (const [v, g] of g25) assert.equal(pmGrade('pm25', v), g, `pm25 ${v}`);
assert.equal(pmGrade('pm10', -1), null); assert.equal(pmGrade('pm25', NaN), null);

// 24시간 평균: 마지막 24개, 18개 미만이면 판정 안 함, null 은 건너뜀
assert.equal(average24(Array(24).fill(20)), 20);
assert.equal(average24([...Array(10).fill(999), ...Array(24).fill(10)]), 10);
assert.equal(average24([...Array(17).fill(10), ...Array(7).fill(null)]), null);
assert.equal(average24([...Array(18).fill(10), ...Array(6).fill(null)]), 10);
assert.equal(average24('x'), null);

// ── 응답 해석 ──
const FC = { current: { time: '2026-11-18T15:30', temperature_2m: 7.6, weather_code: 1 }, daily: { time: ['2026-11-18'], temperature_2m_max: [8.9], temperature_2m_min: [1.5], precipitation_probability_max: [88] } };
const AIR = { hourly: { time: [], pm10: Array(24).fill(40), pm2_5: Array(24).fill(12) } };
assert.deepEqual(parseForecast(FC), { temp: 7.6, code: 1, min: 1.5, max: 8.9, pop: 88 });
assert.equal(parseForecast({ ...FC, current: { temperature_2m: 7.6, weather_code: 42 } }), null);   // 표에 없는 코드
assert.equal(parseForecast({ current: FC.current }), null);
assert.equal(parseForecast(null), null);
assert.equal(parseForecast({ ...FC, daily: { ...FC.daily, precipitation_probability_max: [null] } })?.pop, null);

// 요청 주소: 고정 좌표(소수 둘째 자리), 키 없음, 위치 권한 없음
for (const u of [FORECAST_URL, AIR_URL]) { assert.match(u, /latitude=37\.50&longitude=126\.96/); assert.doesNotMatch(u, /apikey/); }
assert.match(AIR_URL, /hourly=pm10,pm2_5&past_hours=24/);
const src = readFileSync('lib/weather.ts', 'utf8') + readFileSync('components/WeatherStrip.tsx', 'utf8');
assert.doesNotMatch(src, /geolocation/);

// ── 가짜 저장소·가짜 fetch ──
class MemKV implements KV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }
const throwing: KV = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
type R = { ok: boolean; json(): Promise<unknown> };
const ok = (j: unknown): Promise<R> => Promise.resolve({ ok: true, json: () => Promise.resolve(j) });
function fakeFetch(routes: { fc?: () => Promise<R>; air?: () => Promise<R> }) {
  const calls: string[] = [];
  const fn = (u: string) => { calls.push(u); const r = u.startsWith('https://api.open-meteo.com/') ? routes.fc : routes.air; return r ? r() : Promise.reject(new Error('offline')); };
  return { fn, calls };
}
const NOW = Date.parse('2026-11-18T06:30:00Z');

// 정상: 둘 다 받아 합치고 캐시한다
{
  const kv = new MemKV(); const f = fakeFetch({ fc: () => ok(FC), air: () => ok(AIR) });
  const w = await loadWeather({ fetchFn: f.fn, kv, nowMs: NOW });
  assert.deepEqual(w, { temp: 7.6, code: 1, min: 1.5, max: 8.9, pop: 88, pm10: 40, pm25: 12 });
  assert.equal(f.calls.length, 2);
  // 30분 안에는 캐시만(요청 없음)
  const f2 = fakeFetch({});
  assert.deepEqual(await loadWeather({ fetchFn: f2.fn, kv, nowMs: NOW + CACHE_TTL_MS - 1 }), w);
  assert.equal(f2.calls.length, 0);
  // 30분이 지나면 다시 요청
  const f3 = fakeFetch({ fc: () => ok(FC), air: () => ok(AIR) });
  await loadWeather({ fetchFn: f3.fn, kv, nowMs: NOW + CACHE_TTL_MS });
  assert.equal(f3.calls.length, 2);
}

// 실패 시 숨김(null): 네트워크 오류, HTTP 오류, 이상한 응답, json 파싱 실패. 실패는 캐시하지 않는다
{
  const kv = new MemKV();
  assert.equal(await loadWeather({ fetchFn: fakeFetch({}).fn, kv, nowMs: NOW }), null);
  assert.equal(await loadWeather({ fetchFn: fakeFetch({ fc: () => Promise.resolve({ ok: false, json: () => Promise.resolve(FC) }), air: () => ok(AIR) }).fn, kv, nowMs: NOW }), null);
  assert.equal(await loadWeather({ fetchFn: fakeFetch({ fc: () => ok({ error: true, reason: 'x' }), air: () => ok(AIR) }).fn, kv, nowMs: NOW }), null);
  assert.equal(await loadWeather({ fetchFn: fakeFetch({ fc: () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) }), air: () => ok(AIR) }).fn, kv, nowMs: NOW }), null);
  assert.equal(kv.getItem(CACHE_KEY), null);
}

// 대기질만 실패: 날씨는 보이고 미세먼지는 빠진다
{
  const w = await loadWeather({ fetchFn: fakeFetch({ fc: () => ok(FC) }).fn, kv: new MemKV(), nowMs: NOW });
  assert.equal(w?.temp, 7.6); assert.equal(w?.pm10, null); assert.equal(w?.pm25, null);
}

// 캐시 읽기 실패: 저장소가 던지거나, 없거나, 값이 깨졌거나, 미래 시각이면 무시하고 새로 받는다
{
  for (const kv of [throwing, null]) {
    const f = fakeFetch({ fc: () => ok(FC), air: () => ok(AIR) });
    assert.equal((await loadWeather({ fetchFn: f.fn, kv, nowMs: NOW }))?.pm10, 40);
    assert.equal(f.calls.length, 2);
  }
  assert.equal(readCache(throwing, NOW), null);
  assert.doesNotThrow(() => writeCache(throwing, { temp: 1, code: 0, min: 0, max: 2, pop: null, pm10: null, pm25: null }, NOW));
  const kv = new MemKV();
  for (const bad of ['{', 'null', '"x"', JSON.stringify({ at: 'x', data: {} }), JSON.stringify({ at: NOW, data: { temp: 'hot' } }), JSON.stringify({ at: NOW, data: { temp: 1, code: 42, min: 0, max: 2 } }), JSON.stringify({ at: NOW + 60_000, data: { temp: 1, code: 0, min: 0, max: 2 } })]) {
    kv.setItem(CACHE_KEY, bad);
    assert.equal(readCache(kv, NOW), null, bad);
  }
  kv.setItem(CACHE_KEY, '{');
  const f = fakeFetch({ fc: () => ok(FC), air: () => ok(AIR) });
  assert.equal((await loadWeather({ fetchFn: f.fn, kv, nowMs: NOW }))?.temp, 7.6);
  assert.equal(readCache(kv, NOW)?.temp, 7.6);   // 깨진 캐시는 새 값으로 덮어쓴다
}

// /label/ 화면에는 위젯이 없고 외부 요청도 없다: 날씨 부품은 채널 뉴스 화면에서만 쓴다
const users = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(d => d.isFile() && /\.tsx?$/.test(d.name)).map(d => `${d.parentPath}/${d.name}`)
  .filter(p => /WeatherStrip|lib\/weather/.test(readFileSync(p, 'utf8')));
assert.deepEqual(users('app'), ['app/[channel]/page.tsx']);
assert.deepEqual(users('components').filter(p => !p.endsWith('WeatherStrip.tsx')), []);
for (const p of ['app/label/page.tsx', 'components/LabelTool.tsx', 'lib/label.ts']) assert.doesNotMatch(readFileSync(p, 'utf8'), /open-meteo|Weather/i, p);

console.log('weather tests passed');
