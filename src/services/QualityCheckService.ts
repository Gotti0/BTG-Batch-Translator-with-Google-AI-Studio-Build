// services/QualityCheckService.ts
// Python utils/quality_check_service.py 의 TypeScript 변환
// 선형 회귀 분석을 통해 번역 품질 이상치를 탐지합니다.

/**
 * 의심 청크 정보 인터페이스
 */
export interface SuspiciousChunk {
  /** 청크 인덱스 */
  chunkIndex: number;
  /** 이슈 타입: 누락 또는 환각 */
  issueType: 'omission' | 'hallucination';
  /** 원문 길이 */
  sourceLength: number;
  /** 번역된 길이 */
  translatedLength: number;
  /** 예상 길이 */
  expectedLength: number;
  /** 길이 비율 */
  ratio: number;
  /** Z-Score */
  zScore: number;
}

/**
 * 선형 회귀 분석 결과 인터페이스
 */
export interface RegressionAnalysis {
  /** 회귀 계수 (기울기) */
  slope: number;
  /** 절편 */
  intercept: number;
  /** 표준편차 */
  stdDev: number;
  /** 의심 청크 목록 */
  suspiciousChunks: SuspiciousChunk[];
}

/**
 * 데이터 포인트 타입
 */
interface DataPoint {
  index: number;
  sourceLength: number;
  translatedLength: number;
}

/**
 * 번역 품질 이상 감지 서비스
 * 선형 회귀 분석을 통해 번역 누락(Omission) 및 환각(Hallucination) 의심 구간을 탐지합니다.
 */
export class QualityCheckService {
  /**
   * 번역 결과들을 분석하여 품질 통계를 반환합니다.
   *
   * @param translatedResults - 번역된 청크들 ({ chunkIndex, originalText, translatedText, success })
   * @returns 회귀 분석 결과
   */
  static analyzeTranslationQuality(translatedResults: Array<{
    chunkIndex: number;
    originalText: string;
    translatedText: string;
    success: boolean;
  }>): RegressionAnalysis {
    // 데이터 포인트 수집 (청크 인덱스, 원문 길이, 번역 길이)
    const dataPoints: DataPoint[] = [];

    for (const result of translatedResults) {
      // 성공한 결과만 분석
      if (!result.success) continue;

      const sourceLength = result.originalText.length;
      const translatedLength = result.translatedText.length;

      // 길이가 0인 경우 제외
      if (sourceLength > 0 && translatedLength > 0) {
        dataPoints.push({
          index: result.chunkIndex,
          sourceLength,
          translatedLength,
        });
      }
    }

    const n = dataPoints.length;

    // 데이터가 너무 적으면 분석 신뢰도가 낮으므로 기본값 반환 (최소 5개)
    if (n < 5) {
      return {
        slope: 0,
        intercept: 0,
        stdDev: 0,
        suspiciousChunks: [],
      };
    }

    // 1. 선형 회귀 파라미터 계산 (최소제곱법)
    // y = ax + b
    const sumX = dataPoints.reduce((sum, p) => sum + p.sourceLength, 0);
    const sumY = dataPoints.reduce((sum, p) => sum + p.translatedLength, 0);
    const sumXY = dataPoints.reduce((sum, p) => sum + p.sourceLength * p.translatedLength, 0);
    const sumX2 = dataPoints.reduce((sum, p) => sum + p.sourceLength ** 2, 0);

    const denominator = n * sumX2 - sumX ** 2;

    if (denominator === 0) {
      // 모든 x값이 동일한 경우 등 회귀 분석 불가능
      return {
        slope: 0,
        intercept: 0,
        stdDev: 0,
        suspiciousChunks: [],
      };
    }

    const a = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY - a * sumX) / n;

    // 2. 잔차(Residual) 및 표준편차 계산
    const residuals: number[] = [];
    for (const point of dataPoints) {
      const predictedY = a * point.sourceLength + b;
      const residual = point.translatedLength - predictedY;
      residuals.push(residual);
    }

    const meanResidual = residuals.reduce((sum, r) => sum + r, 0) / n;
    const variance = residuals.reduce((sum, r) => sum + (r - meanResidual) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return {
        slope: a,
        intercept: b,
        stdDev: 0,
        suspiciousChunks: [],
      };
    }

    // 3. 이상치 탐지 (Z-Score)
    const suspiciousChunks: SuspiciousChunk[] = [];

    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      const residual = residuals[i];
      const zScore = residual / stdDev;

      let issueType: 'omission' | 'hallucination' | null = null;

      // 임계값 설정 (표준편차의 2배)
      if (zScore < -2.0) {
        issueType = 'omission'; // 예상보다 짧음 (누락 의심)
      } else if (zScore > 2.0) {
        issueType = 'hallucination'; // 예상보다 김 (환각 의심)
      }

      if (issueType) {
        const expectedLength = a * point.sourceLength + b;
        const ratio = point.sourceLength > 0 ? point.translatedLength / point.sourceLength : 0;

        suspiciousChunks.push({
          chunkIndex: point.index,
          issueType,
          sourceLength: point.sourceLength,
          translatedLength: point.translatedLength,
          expectedLength: Math.round(expectedLength * 100) / 100,
          ratio: Math.round(ratio * 10000) / 10000,
          zScore: Math.round(zScore * 100) / 100,
        });
      }
    }

    // 청크 인덱스 순으로 정렬
    suspiciousChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return {
      slope: Math.round(a * 10000) / 10000,
      intercept: Math.round(b * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      suspiciousChunks,
    };
  }

  /**
   * 분석 결과를 읽기 쉬운 형식의 문자열로 포맷팅합니다.
   *
   * @param analysis - 회귀 분석 결과
   * @returns 포맷된 문자열
   */
  static formatAnalysisResult(analysis: RegressionAnalysis): string {
    const lines: string[] = [];

    lines.push('📊 번역 품질 분석 결과');
    lines.push('─'.repeat(50));
    lines.push(`회귀식: y = ${analysis.slope.toFixed(4)}x + ${analysis.intercept.toFixed(2)}`);
    lines.push(`표준편차: ${analysis.stdDev.toFixed(2)}`);
    lines.push('');

    if (analysis.suspiciousChunks.length === 0) {
      lines.push('✅ 의심 구간 없음 - 모든 청크가 정상 범위입니다.');
    } else {
      lines.push(`⚠️  의심 구간: ${analysis.suspiciousChunks.length}개`);
      lines.push('');

      for (const chunk of analysis.suspiciousChunks) {
        const icon = chunk.issueType === 'omission' ? '❌' : '⚡';
        const typeLabel = chunk.issueType === 'omission' ? '누락' : '환각';
        lines.push(
          `${icon} 청크 #${chunk.chunkIndex + 1} (${typeLabel}) | ` +
          `원문: ${chunk.sourceLength}자, 번역: ${chunk.translatedLength}자 ` +
          `(예상: ${chunk.expectedLength}자) | Z-Score: ${chunk.zScore}`
        );
      }
    }

    return lines.join('\n');
  }
}
