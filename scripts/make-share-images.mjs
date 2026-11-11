// 공유용 정적 이미지 생성: public/og.png(1200×630), public/apple-touch-icon.png(180), public/favicon.ico(16·32·48), public/favicon.svg
// 결과물은 커밋한다(빌드 때 실행하지 않음). 워드마크·문구는 lib/wordmark.json 의 윤곽선(path)으로 그려 폰트 파일·시스템 글꼴과 무관하다.
//
//   PLAYWRIGHT_MODULE=<playwright 패키지의 index.mjs 경로> node scripts/make-share-images.mjs
//   (또는 npm i --no-save playwright && npx playwright install chromium 후 node scripts/make-share-images.mjs)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const M = JSON.parse(readFileSync(new URL('../lib/wordmark.json', import.meta.url), 'utf8'));
const BRAND = '#1756A9', INK = '#16202B', TEXT2 = '#3D4A5A', MUTED = '#55606E', PAPER = '#FFFFFF';

/** 워드마크 SVG(심볼 바탕 = 브랜드 색, 글자 = 잉크) */
const wordmark = (h) => {
  const [, , w, vh] = M.viewBox, s = M.symbol;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${M.viewBox.join(' ')}" height="${h}" width="${(h * w / vh).toFixed(1)}">` +
    `<rect width="${s.size}" height="${s.size}" rx="${s.radius}" fill="${BRAND}"/><path fill="#fff" fill-rule="evenodd" d="${s.glyph}"/><path fill="${INK}" d="${M.text}"/></svg>`;
};
const textSvg = (t, h, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.w} ${t.h}" height="${h}" width="${(h * t.w / t.h).toFixed(1)}"><path fill="${color}" d="${t.d}"/></svg>`;
/** 심볼 아이콘(0~100 좌표). rounded=false 면 모서리 없이 꽉 채운다(apple-touch-icon: iOS 가 모서리를 깎음) */
const symbolSvg = (rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${rounded ? M.symbol100.radius : 0}" fill="${BRAND}"/><path fill="#fff" fill-rule="evenodd" d="${M.symbol100.glyph}"/></svg>`;

const og = `<html><body style="margin:0;width:1200px;height:630px;background:${PAPER};position:relative">
<div style="position:absolute;left:0;right:0;top:0;height:14px;background:${BRAND}"></div>
<div style="position:absolute;inset:14px 0 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
  ${wordmark(150)}
  ${textSvg(M.tagline, 40, TEXT2)}
</div>
<div style="position:absolute;left:0;right:0;bottom:44px;display:flex;justify-content:center">${textSvg(M.url, 22, MUTED)}</div>
</body></html>`;

const icon = (size, rounded) => `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">${symbolSvg(rounded).replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch();
const shot = async (html, w, h, transparent = false) => {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  const buf = await p.screenshot({ type: 'png', omitBackground: transparent });
  await p.close();
  return buf;
};

mkdirSync('public', { recursive: true });
writeFileSync('public/og.png', await shot(og, 1200, 630));
writeFileSync('public/apple-touch-icon.png', await shot(icon(180, false), 180, 180));

// ICO: PNG 데이터를 그대로 담는 형식(Windows Vista 이후·모든 현재 브라우저 지원). 둥근 모서리 밖은 투명.
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await shot(icon(s, true), s, s, true));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, ...pngs]));
await browser.close();

writeFileSync('public/favicon.svg', symbolSvg(true) + '\n');
console.log('public/og.png, apple-touch-icon.png, favicon.ico, favicon.svg 생성');
