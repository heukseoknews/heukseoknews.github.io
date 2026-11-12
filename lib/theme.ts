/** 채널 theme.json 의 CSS 변수를 :root 규칙 문자열로 만든다. 이름·값은 안전한 문자만 허용하고 나머지는 버린다. */
const NAME = /^--[a-z0-9-]+$/;
const VALUE = /^[#a-zA-Z0-9 .,%()-]+$/;

export function themeCss(vars: Record<string, string> = {}): string {
  const body = Object.entries(vars).filter(([k, v]) => NAME.test(k) && typeof v === 'string' && VALUE.test(v)).map(([k, v]) => `${k}:${v}`).join(';');
  return body ? `:root{${body}}` : '';
}

/** 채널 테마 4색: accent(버튼·링크·선택), strong(강조 글자), soft(칩·배지 바탕), dark(어두운 배경용) */
export const THEME_KEYS = ['--accent', '--accent-strong', '--accent-soft', '--accent-dark'] as const;
export type ThemeVars = Record<(typeof THEME_KEYS)[number], string>;

/** WCAG 2.x 대비(1~21). #rrggbb 만 받는다. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 채널 폴더가 아직 없는(수집·페이지 없음) 예정 채널의 테마. 폴더를 만들면 channels/<slug>/theme.json 으로 옮긴다. */
export const PLANNED_THEMES: Record<string, ThemeVars> = {};  // 금융 초록은 channels/finance/theme.json 으로 옮김
