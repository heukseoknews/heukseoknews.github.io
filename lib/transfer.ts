/** URL 해시(#import=…)로 사용자 상태를 넘기는 인코딩: JSON → gzip(CompressionStream) → base64url.
 *  해시는 서버로 전송되지 않는다. 길이 기준은 docs/migration-localstorage.md. */
export const HASH_KEY = 'import';
/** 이보다 긴 해시 링크는 만들지 않고 파일 방식으로 안내한다(문자 수). 근거: docs/migration-localstorage.md */
export const HASH_MAX_CHARS = 32_000;
/** 압축을 풀었을 때 허용하는 최대 크기(바이트). localStorage 한도(약 5MB)를 넘는 입력은 거절한다. */
export const MAX_DECODED_BYTES = 5 * 1024 * 1024;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('데이터가 너무 큽니다.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('잘못된 문자가 있습니다.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodePayload(obj: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  return toBase64Url(await pipe(json, new CompressionStream('gzip')));
}

export async function decodePayload(s: string): Promise<unknown> {
  const raw = await pipe(fromBase64Url(s), new DecompressionStream('gzip'), MAX_DECODED_BYTES);
  return JSON.parse(new TextDecoder().decode(raw));
}

/** '#import=xxx' → 'xxx'. 다른 해시면 null. */
export function readImportHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const p = new URLSearchParams(h).get(HASH_KEY);
  return p ? p.trim() : null;
}
