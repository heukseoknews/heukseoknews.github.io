/** 채널 theme.json 의 CSS 변수를 :root 규칙 문자열로 만든다. 이름·값은 안전한 문자만 허용하고 나머지는 버린다. */
const NAME = /^--[a-z0-9-]+$/;
const VALUE = /^[#a-zA-Z0-9 .,%()-]+$/;

export function themeCss(vars: Record<string, string> = {}): string {
  const body = Object.entries(vars).filter(([k, v]) => NAME.test(k) && typeof v === 'string' && VALUE.test(v)).map(([k, v]) => `${k}:${v}`).join(';');
  return body ? `:root{${body}}` : '';
}
