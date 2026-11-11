// 공유용 정적 이미지 생성: public/og.png(1200×630), public/apple-touch-icon.png(180), public/favicon.ico(16·32·48), public/favicon.svg
// 결과물은 커밋한다(빌드 때 실행하지 않음). 워드마크는 시스템 세리프 글꼴로 렌더링한다(폰트 파일을 저장소에 넣지 않음).
//
//   PLAYWRIGHT_MODULE=<playwright 패키지의 index.mjs 경로> node scripts/make-share-images.mjs
//   (또는 npm i --no-save playwright && npx playwright install chromium 후 node scripts/make-share-images.mjs)
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const SERIF = "'Nanum Myeongjo','Noto Serif KR','Noto Serif CJK KR','AppleMyungjo','Batang',serif";
const INK = '#14213a', BRAND = '#173e74', PAPER = '#fbfaf7';

const og = `<html><body style="margin:0;width:1200px;height:630px;background:${PAPER};display:flex;align-items:center;justify-content:center;font-family:${SERIF}">
<div style="width:1040px;text-align:center;color:${INK}">
  <div style="border-top:6px solid ${BRAND};border-bottom:1.5px solid ${BRAND};height:8px"></div>
  <div style="font-size:168px;font-weight:700;letter-spacing:6px;line-height:1.25;margin:34px 0 6px">흑석일보</div>
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:12px;color:${BRAND}">HEUKSEOK ILBO</div>
  <div style="font-size:34px;margin:26px 0 34px;color:#3b4a60">보험·AI·금융 뉴스 모아보기</div>
  <div style="border-top:1.5px solid ${BRAND};border-bottom:6px solid ${BRAND};height:8px"></div>
  <div style="font-family:Georgia,serif;font-size:22px;color:#6b7686;margin-top:22px">heukseoknews.github.io</div>
</div></body></html>`;

const icon = size => `<html><body style="margin:0;width:${size}px;height:${size}px;background:${BRAND};display:flex;align-items:center;justify-content:center">
<span style="font-family:${SERIF};font-weight:700;color:#fff;font-size:${Math.round(size * 0.72)}px;line-height:1;transform:translateY(-${Math.round(size * 0.03)}px)">흑</span></body></html>`;

const browser = await chromium.launch();
const shot = async (html, w, h) => {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  const buf = await p.screenshot({ type: 'png' });
  await p.close();
  return buf;
};

mkdirSync('public', { recursive: true });
writeFileSync('public/og.png', await shot(og, 1200, 630));
writeFileSync('public/apple-touch-icon.png', await shot(icon(180), 180, 180));

// ICO: PNG 데이터를 그대로 담는 형식(Windows Vista 이후·모든 현재 브라우저 지원)
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await shot(icon(s), s, s));
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

// SVG 파비콘: 글자는 보는 기기의 세리프 글꼴로 그려진다(ICO·PNG 가 같은 모양의 대체본)
writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${BRAND}"/><text x="32" y="47" text-anchor="middle" font-family="${SERIF.replace(/'/g, '')}" font-weight="700" font-size="44" fill="#fff">흑</text></svg>\n`);
console.log('public/og.png, apple-touch-icon.png, favicon.ico, favicon.svg 생성');
