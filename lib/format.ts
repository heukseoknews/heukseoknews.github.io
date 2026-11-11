export type Formatters = { fmt: (v: string) => string; fmtShort: (v: string) => string };

/** 채널 channel.json 의 locale·timezone 으로 날짜 표기 함수를 만든다. */
export function makeFormatters(locale = 'ko-KR', timeZone = 'Asia/Seoul'): Formatters {
  const long = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const short = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const fmt = (v: string) => {
    const d = new Date(v);
    return isNaN(d.getTime()) ? '날짜 미상' : long.format(d);
  };
  /** 'MM.DD HH:mm' — 헤더 배지처럼 좁은 곳에 쓰는 짧은 표기 */
  const fmtShort = (v: string) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    const p = short.formatToParts(d);
    const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
    return `${g('month')}.${g('day')} ${g('hour')}:${g('minute')}`;
  };
  return { fmt, fmtShort };
}

export const { fmt, fmtShort } = makeFormatters();
