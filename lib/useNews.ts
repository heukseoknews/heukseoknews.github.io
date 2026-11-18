'use client';
import { useEffect, useMemo, useState } from 'react';
import { Article, DataIndex, loadIndex, loadMonth } from './news';
import { createOnce, monthRequester, startLoad } from './newsLoad';

/** index.json + 월 파일 지연 로딩. extra: 추가로 불러올 월 목록 또는 'all'. 기본은 최근 2개월.
 *  같은 달은 한 번만 요청하고(진행 중 포함), 이번 달 월 파일은 index.json 과 동시에 요청한다(lib/newsLoad.ts).
 *  requested: 이 화면이 원하는 달(요청을 시작한 달) — 채널 화면은 이 달들의 점수 파일을 월 파일과 동시에 요청한다. */
export function useNews(channel: string, extra: string[] | 'all' = []) {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [byMonth, setByMonth] = useState<Record<string, Article[]>>({});
  const [failure, setFailure] = useState('');
  const once = useMemo(() => createOnce(m => loadMonth(channel, m)), [channel]);
  const request = useMemo(() => monthRequester(once, {
    rows: (m, rows) => setByMonth(p => ({ ...p, [m]: rows })),
    // 실패한 달은 빈 목록으로 두고 안내한다(같은 방문에서 저절로 다시 요청하지 않음 — 오프라인에서 요청이 반복되지 않게)
    fail: (m, e) => { console.error(`${m}.json`, e); setByMonth(p => ({ ...p, [m]: [] })); setFailure(`${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월 기사를 불러오지 못했습니다.`); },
  }), [once]);
  useEffect(() => {
    startLoad(() => loadIndex(channel), once, Date.now()).then(setIndex)
      .catch(e => { console.error('index.json', e); setFailure('뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'); });
  }, [channel, once]);
  const extraKey = extra === 'all' ? 'all' : extra.join(',');
  const wanted = useMemo(() => {
    const m = index?.months.map(x => x.month) ?? [];
    const set = new Set(m.slice(0, 2));
    if (extra === 'all') m.forEach(x => set.add(x)); else extra.forEach(x => m.includes(x) && set.add(x));
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, extraKey]);
  useEffect(() => { request(wanted, m => m in byMonth); }, [request, wanted, byMonth]);
  const all = useMemo(() => Object.values(byMonth).flat(), [byMonth]);
  // loading: 최초 표시에 필요한 최근 2개월이 모두 끝날 때까지(성공/실패 무관). 이전에는 index만 오면 끝난 것으로 보여 '기사 없음'이 깜빡였다.
  const baseMonths = index?.months.slice(0, 2).map(x => x.month) ?? [];
  const loading = !failure && (!index || baseMonths.some(m => !(m in byMonth)));
  const loadingMore = !loading && wanted.some(m => !(m in byMonth)); // 검색·달력 이동으로 과거 월을 추가로 읽는 중
  const loaded = useMemo(() => Object.keys(byMonth), [byMonth]);   // 불러온 월(성공·실패 모두) — 달력의 데이터 범위 계산에 쓴다
  return { index, all, loaded, requested: wanted, failure, loading, loadingMore };
}
