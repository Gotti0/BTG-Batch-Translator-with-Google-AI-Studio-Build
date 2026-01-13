import { describe, it, expect } from 'vitest';
import { QualityCheckService } from '../QualityCheckService';

describe('QualityCheckService', () => {
  it('should detect suspicious chunks (hallucinations or omissions)', () => {
    // X값이 다양해야 회귀 분석이 가능함
    const results = [
      { chunkIndex: 0, originalText: 'A'.repeat(100), translatedText: 'B'.repeat(100), success: true },
      { chunkIndex: 1, originalText: 'A'.repeat(200), translatedText: 'B'.repeat(200), success: true },
      { chunkIndex: 2, originalText: 'A'.repeat(300), translatedText: 'B'.repeat(300), success: true },
      { chunkIndex: 3, originalText: 'A'.repeat(400), translatedText: 'B'.repeat(400), success: true },
      { chunkIndex: 4, originalText: 'A'.repeat(500), translatedText: 'B'.repeat(500), success: true },
      { chunkIndex: 5, originalText: 'A'.repeat(600), translatedText: 'B'.repeat(600), success: true },
      { chunkIndex: 6, originalText: 'A'.repeat(700), translatedText: 'B'.repeat(700), success: true },
      { chunkIndex: 7, originalText: 'A'.repeat(800), translatedText: 'B'.repeat(800), success: true },
      { chunkIndex: 8, originalText: 'A'.repeat(900), translatedText: 'B'.repeat(900), success: true },
      // 이 청크는 예상 길이(1000)보다 훨씬 짧음 (누락 의심)
      { chunkIndex: 9, originalText: 'A'.repeat(1000), translatedText: 'B'.repeat(10), success: true },
    ];
    
    const analysis = QualityCheckService.analyzeTranslationQuality(results);
    
    expect(analysis.suspiciousChunks.length).toBeGreaterThan(0);
    expect(analysis.suspiciousChunks.some(c => c.issueType === 'omission')).toBe(true);
  });

  it('should return empty suspicious chunks if all translations are consistent', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      chunkIndex: i,
      originalText: 'A'.repeat(100),
      translatedText: 'B'.repeat(100),
      success: true
    }));
    
    const analysis = QualityCheckService.analyzeTranslationQuality(results);
    expect(analysis.suspiciousChunks.length).toBe(0);
  });
});
