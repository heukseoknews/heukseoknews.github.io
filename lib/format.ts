export const fmt = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? '날짜 미상' : new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(d);
};

/** 'MM.DD HH:mm' (KST) — 헤더 배지처럼 좁은 곳에 쓰는 짧은 표기 */
export const fmtShort = (v: string) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${g('month')}.${g('day')} ${g('hour')}:${g('minute')}`;
};
