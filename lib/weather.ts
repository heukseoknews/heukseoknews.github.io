/** 오늘의 날씨(채널 뉴스 화면 탭 줄 위 한 줄). 브라우저가 Open-Meteo 공개 API(키 없음, 비상업)를 직접 부른다.
 *  위치는 고정 좌표(소수 둘째 자리), 방문자 위치 권한은 쓰지 않는다. 실패하면 null → 화면은 아무것도 그리지 않는다.
 *  방문자별 30분 캐시는 localStorage(읽기·쓰기 모두 try/catch, 저장소가 없어도 동작). 운영 메모는 docs/architecture.md '오늘의 날씨'.
 *  끄기: WEATHER_ENABLED = false. */

export const WEATHER_ENABLED = true;
export const PLACE = '흑석';
const LAT = '37.50';
const LON = '126.96';
export const CACHE_KEY = 'heukseok-weather';
export const CACHE_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;

export const FORECAST_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
  + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
  + '&timezone=Asia%2FSeoul&forecast_days=1';
/** 미세먼지 등급은 환경부 기준처럼 24시간 평균으로 판정: 지난 24시간 시간별 값을 받는다 */
export const AIR_URL = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}`
  + '&hourly=pm10,pm2_5&past_hours=24&forecast_hours=0&timezone=Asia%2FSeoul';

export type SkyIcon = 'sun' | 'cloudSun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';
export interface Sky { text: string; icon: SkyIcon }

/** WMO 날씨 코드(Open-Meteo 문서의 WW 표) → 하늘 상태. 표에 없는 코드는 null */
export function skyOf(code: number): Sky | null {
  switch (code) {
    case 0: return { text: '맑음', icon: 'sun' };
    case 1: return { text: '대체로 맑음', icon: 'sun' };
    case 2: return { text: '구름 조금', icon: 'cloudSun' };
    case 3: return { text: '흐림', icon: 'cloud' };
    case 45: case 48: return { text: '안개', icon: 'fog' };
    case 51: case 53: case 55: return { text: '이슬비', icon: 'drizzle' };
    case 56: case 57: return { text: '어는 이슬비', icon: 'drizzle' };
    case 61: case 63: return { text: '비', icon: 'rain' };
    case 65: return { text: '강한 비', icon: 'rain' };
    case 66: case 67: return { text: '어는 비', icon: 'rain' };
    case 71: case 73: return { text: '눈', icon: 'snow' };
    case 75: return { text: '강한 눈', icon: 'snow' };
    case 77: return { text: '싸락눈', icon: 'snow' };
    case 80: case 81: return { text: '소나기', icon: 'rain' };
    case 82: return { text: '강한 소나기', icon: 'rain' };
    case 85: case 86: return { text: '눈 소나기', icon: 'snow' };
    case 95: return { text: '뇌우', icon: 'storm' };
    case 96: case 99: return { text: '우박 동반 뇌우', icon: 'storm' };
    case 97: return { text: '강한 뇌우', icon: 'storm' };
    default: return null;
  }
}

export type PmGrade = '좋음' | '보통' | '나쁨' | '매우나쁨';
/** 환경부·에어코리아 등급 구간(㎍/㎥, 정수 경계). 소수는 반올림한 뒤 판정한다. 각 값은 그 등급의 상한 */
const PM_BOUNDS: Record<'pm10' | 'pm25', [number, number, number]> = { pm10: [30, 80, 150], pm25: [15, 35, 75] };
export function pmGrade(kind: 'pm10' | 'pm25', value: number): PmGrade | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const v = Math.round(value);
  const [good, normal, bad] = PM_BOUNDS[kind];
  return v <= good ? '좋음' : v <= normal ? '보통' : v <= bad ? '나쁨' : '매우나쁨';
}

/** 기온 표시용 반올림: 0에서 먼 쪽으로(-11.5 → -12, 11.5 → 12). -0 은 0 */
export const roundTemp = (v: number): number => (Math.sign(v) * Math.round(Math.abs(v))) || 0;

export interface Weather {
  temp: number; code: number; min: number; max: number; pop: number | null;
  /** 지난 24시간 평균(㎍/㎥). 대기질을 못 받았으면 null(날씨만 보인다) */
  pm10: number | null; pm25: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : undefined);

/** 날씨 응답 → 필요한 값. 기온·하늘 코드·최저·최고 중 하나라도 없거나 코드가 표에 없으면 null */
export function parseForecast(j: unknown): Omit<Weather, 'pm10' | 'pm25'> | null {
  const o = j as { current?: Record<string, unknown>; daily?: Record<string, unknown> } | null;
  if (!o || typeof o !== 'object') return null;
  const temp = num(o.current?.temperature_2m), code = num(o.current?.weather_code);
  const max = num(first(o.daily?.temperature_2m_max)), min = num(first(o.daily?.temperature_2m_min));
  if (temp === null || code === null || max === null || min === null || !skyOf(code)) return null;
  return { temp, code, min, max, pop: num(first(o.daily?.precipitation_probability_max)) };
}

/** 시간별 값의 평균. 24개 중 18개(75%) 미만이면 판정하지 않는다 */
export function average24(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  const ok = values.slice(-24).filter((v): v is number => num(v) !== null && (v as number) >= 0);
  if (ok.length < 18) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

export function parseAir(j: unknown): { pm10: number | null; pm25: number | null } {
  const h = (j as { hourly?: Record<string, unknown> } | null)?.hourly;
  return { pm10: average24(h?.pm10), pm25: average24(h?.pm2_5) };
}

// ───────── 캐시(방문자 브라우저, 30분) ─────────
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** 저장소 자체에 접근할 수 없는 브라우저(사생활 보호 모드, 차단된 사이트 데이터)는 null */
export function browserStorage(): KV | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readCache(kv: KV | null, nowMs: number): Weather | null {
  if (!kv) return null;
  try {
    const raw = kv.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at?: unknown; data?: Weather };
    if (typeof c?.at !== 'number' || nowMs - c.at < 0 || nowMs - c.at >= CACHE_TTL_MS) return null;
    const d = c.data;
    if (!d || num(d.temp) === null || num(d.min) === null || num(d.max) === null || num(d.code) === null || !skyOf(d.code)) return null;
    return { temp: d.temp, code: d.code, min: d.min, max: d.max, pop: num(d.pop), pm10: num(d.pm10), pm25: num(d.pm25) };
  } catch { return null; }
}

export function writeCache(kv: KV | null, data: Weather, nowMs: number): void {
  if (!kv) return;
  try { kv.setItem(CACHE_KEY, JSON.stringify({ at: nowMs, data })); } catch { /* 저장 불가: 이번 방문에만 */ }
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function getJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const r = await fetchFn(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('http');
    return await r.json();
  } finally { if (t) clearTimeout(t); }
}

/** 캐시 → 없으면 두 API 호출. 날씨가 실패하면 null(위젯 숨김), 대기질만 실패하면 미세먼지 없이 날씨만. 성공한 것만 캐시한다 */
export async function loadWeather(opts: { fetchFn: Fetch; kv: KV | null; nowMs: number }): Promise<Weather | null> {
  const cached = readCache(opts.kv, opts.nowMs);
  if (cached) return cached;
  const [fc, air] = await Promise.allSettled([getJson(opts.fetchFn, FORECAST_URL), getJson(opts.fetchFn, AIR_URL)]);
  const base = fc.status === 'fulfilled' ? parseForecast(fc.value) : null;
  if (!base) return null;
  const pm = air.status === 'fulfilled' ? parseAir(air.value) : { pm10: null, pm25: null };
  const data: Weather = { ...base, ...pm };
  writeCache(opts.kv, data, opts.nowMs);
  return data;
}
