// utils/sourceHashUtils.ts
// 원본 파일 내용의 SHA-256 해시와 원본 저장소 키
// 파일명과 무관하게 내용이 같으면 같은 키가 나오므로, 여러 스냅샷이 같은 원본을 한 벌만 저장해 공유한다.

export const SOURCE_HASH_VERSION = 1;
export const SOURCE_HASH_PREFIX = `src_v${SOURCE_HASH_VERSION}_`;

// 해시를 원본 저장소 키로 변환 (해시 방식이 바뀔 때 구분하도록 버전 접두어를 붙인다)
export function getSourceRecordKey(hash: string): string {
  if (hash.startsWith(SOURCE_HASH_PREFIX)) return hash;
  return `${SOURCE_HASH_PREFIX}${hash}`;
}

// 저장소 키에서 해시만 꺼낸다
export function extractHashFromKey(key: string): string {
  if (key.startsWith(SOURCE_HASH_PREFIX)) {
    return key.substring(SOURCE_HASH_PREFIX.length);
  }
  return key;
}

// 텍스트 내용의 SHA-256 hex 해시
export async function calculateContentHash(content: string): Promise<string> {
  if (!content) {
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // 빈 문자열 SHA-256
  }

  const subtle = typeof window !== 'undefined' && window.crypto?.subtle
    ? window.crypto.subtle
    : (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle ? (globalThis as any).crypto.subtle : undefined);

  if (subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('[sourceHashUtils] SubtleCrypto digest 실패, 폴백 사용:', e);
    }
  }

  // 결정적 64자리 폴백 해시 (SHA-256 미지원 특수 환경 대비)
  let h1 = 0xdeadbeef ^ content.length;
  let h2 = 0x41c6ce57 ^ content.length;
  let h3 = 0x85ebca6b ^ content.length;
  let h4 = 0xc2b2ae35 ^ content.length;

  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const p3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const p4 = (h4 >>> 0).toString(16).padStart(8, '0');
  return (p1 + p2 + p3 + p4).padEnd(64, '0').slice(0, 64);
}

// 바이너리(EPUB 등)의 SHA-256 hex 해시
export async function calculateBinaryHash(data: ArrayBuffer): Promise<string> {
  const subtle = (globalThis as any).crypto?.subtle as SubtleCrypto | undefined;
  if (subtle) {
    const hashBuffer = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // SubtleCrypto가 없는 환경: 바이트를 문자열로 바꿔 텍스트 해시의 대체 경로를 쓴다
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return calculateContentHash(binary);
}
