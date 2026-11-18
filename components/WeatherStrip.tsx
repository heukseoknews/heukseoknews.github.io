'use client';
import { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import { PLACE, WEATHER_ENABLED, type PmGrade, type SkyIcon, type Weather, browserStorage, loadWeather, pmGrade, roundTemp, skyOf } from '../lib/weather';

const ICONS: Record<SkyIcon, typeof Sun> = { sun: Sun, cloudSun: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const GRADE_CLASS: Record<PmGrade, string> = { 좋음: 'g1', 보통: 'g2', 나쁨: 'g3', 매우나쁨: 'g4' };
const deg = (v: number) => `${roundTemp(v)}°`;

function Pm({ label, kind, value }: { label: string; kind: 'pm10' | 'pm25'; value: number | null }) {
  const g = value === null ? null : pmGrade(kind, value);
  if (!g) return null;
  return <span className="wxPm">{label} <b className={GRADE_CLASS[g]} title={`24시간 평균 ${Math.round(value!)}㎍/㎥`}>{g}</b></span>;
}

/** 채널 뉴스 화면 탭 줄 위 한 줄 날씨. 받기 전·실패 시에는 아무것도 그리지 않는다(오류 문구 없음) */
export default function WeatherStrip() {
  const [w, setW] = useState<Weather | null>(null);
  useEffect(() => {
    if (!WEATHER_ENABLED) return;
    let live = true;
    loadWeather({ fetchFn: (u, i) => fetch(u, i), kv: browserStorage(), nowMs: Date.now() })
      .then(d => { if (live) setW(d); }, () => { /* 조용히 숨김 */ });
    return () => { live = false; };
  }, []);
  const sky = w ? skyOf(w.code) : null;
  if (!w || !sky) return null;
  const Icon = ICONS[sky.icon];
  return <section className="weather" aria-label="오늘의 날씨">
    <div className="wxMain">
      <b className="wxPlace">{PLACE}</b>
      <span className="wxNow"><Icon size={17} aria-hidden="true" />{sky.text} <b>{deg(w.temp)}</b></span>
      <span className="wxRange">최저 {deg(w.min)} · 최고 {deg(w.max)}</span>
      {w.pop !== null && <span className="wxPop">강수 {Math.round(w.pop)}%</span>}
      <Pm label="미세" kind="pm10" value={w.pm10} />
      <Pm label="초미세" kind="pm25" value={w.pm25} />
    </div>
    <p className="wxCredit"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo.com</a>
      {(w.pm10 !== null || w.pm25 !== null) && <> · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noopener noreferrer">Air quality: CAMS</a></>}</p>
  </section>;
}
