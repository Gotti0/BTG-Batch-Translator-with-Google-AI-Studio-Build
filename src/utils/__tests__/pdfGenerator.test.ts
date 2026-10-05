// pdfGenerator 단위 테스트. HOW/WHAT
// 한국어, 중국어, 특수문자 텍스트를 단일 페이지 PDF로 인코딩하고 규격 유효성을 검증합니다. HOW/WHAT
// Gemini API에 전달될 PDF의 생성 무결성 및 Base64 변환 성능을 보증하기 위해 작성되었습니다. WHY

import { describe, it, expect } from 'vitest';
import { generateUltraCompactPdf, uint8ArrayToBase64 } from '../pdfGenerator';

describe('pdfGenerator', () => {
  it('초경량 PDF 바이너리를 생성하고 유효한 PDF 1.4 헤더 및 트레일러를 포함해야 한다', () => {
    const sampleText = '안녕하세요! Hello World! 这是中文测试。';
    const pdfBytes = generateUltraCompactPdf(sampleText);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    const pdfString = new TextDecoder().decode(pdfBytes);
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString.includes('%%EOF')).toBe(true);
    expect(pdfString.includes('/Type /Page')).toBe(true);
    expect(pdfString.includes('/ToUnicode')).toBe(true);
    expect(pdfString.includes('/Identity-H')).toBe(true);
  });

  it('대용량 소설 텍스트도 단일 페이지로 오류 없이 고속 변환되어야 한다', () => {
    const longText = '제1장 바람의 소리\n' + '한 소년이 산골마을을 걸어가고 있었다. 少年默默地看着前方。\n'.repeat(500);
    const startTime = performance.now();
    const pdfBytes = generateUltraCompactPdf(longText);
    const duration = performance.now() - startTime;

    expect(pdfBytes.length).toBeGreaterThan(1000);
    expect(duration).toBeLessThan(100); // 100ms 이내 초고속 생성 보장 (N100 호환)

    const base64 = uint8ArrayToBase64(pdfBytes);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(1000);
  });
});
