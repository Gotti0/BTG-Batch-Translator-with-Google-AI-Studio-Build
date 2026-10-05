import { describe, it, expect, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
    this.models = { generateContent: mockGenerateContent };
  }),
  MediaResolution: { MEDIA_RESOLUTION_LOW: 'MEDIA_RESOLUTION_LOW' },
}));

import {
  GeminiClient,
  GeminiRateLimitException,
  buildPdfRequest,
  extractRateLimitDetails,
} from '../GeminiClient';

// Gemini API가 실제로 돌려주는 429 본문 형식
const RPD_429_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaDimensions: { location: 'global', model: 'gemini-2.5-flash' },
            quotaValue: '1500',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '22h47m29s' },
    ],
  },
});

describe('extractRateLimitDetails', () => {
  it('QuotaFailure/RetryInfo가 담긴 429 본문에서 일일 요청 한도를 읽는다', () => {
    const details = extractRateLimitDetails(new Error(`got status: 429 Too Many Requests. ${RPD_429_BODY}`));

    expect(details.limitType).toBe('RPD');
    expect(details.limitValue).toBe('1500');
    expect(details.retryDelay).toBe('약 22시간 47분 29초');
    expect(details.formattedSummary).toContain('일일 요청 수 제한 (RPD)');
    expect(details.formattedSummary).toContain('한도: 1,500회/일');
    expect(details.formattedSummary).toContain('모델: gemini-2.5-flash');
  });

  it('토큰 한도는 TPM으로 분류한다', () => {
    const details = extractRateLimitDetails(
      'Quota exceeded for quota metric generate_content_paid_tier_input_token_count and limit GenerateContentInputTokensPerModelPerMinute, retryDelay: 15s'
    );
    expect(details.limitType).toBe('TPM');
    expect(details.retryDelay).toBe('약 15초');
  });

  it('구조화된 정보가 없는 메시지도 분당 요청 한도로 분류한다', () => {
    const details = extractRateLimitDetails('429 Resource exhausted: requests per minute, limit: 15, please retry in 43.2s');
    expect(details.limitType).toBe('RPM');
    expect(details.limitValue).toBe('15');
    expect(details.formattedSummary).toContain('한도: 15회/분');
    expect(details.formattedSummary).toContain('권장 대기 시간: 약 43초');
  });
});

describe('PDF 입력', () => {
  const history = [
    { role: 'user' as const, content: '예시 질문' },
    { role: 'model' as const, content: '예시 답변' },
  ];

  it('standard 모드는 본문만 PDF로 보내고 시스템 지침과 히스토리는 텍스트로 둔다', () => {
    const req = buildPdfRequest('번역할 본문', '시스템 지침', history, { enabled: true, mode: 'standard' });

    expect(req.systemInstruction).toBe('시스템 지침');
    expect(req.contents).toHaveLength(3);
    const last = req.contents[2];
    expect(last.parts[0].inlineData.mimeType).toBe('application/pdf');
    const pdf = atob(last.parts[0].inlineData.data);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  });

  it('extreme 모드는 시스템 지침과 히스토리까지 PDF 하나에 담는다', () => {
    const req = buildPdfRequest('번역할 본문', '시스템 지침', history, { enabled: true, mode: 'extreme' });

    expect(req.systemInstruction).toBeUndefined();
    expect(req.contents).toHaveLength(1);
  });

  it('PDF 입력을 켜면 generateText가 MEDIA_RESOLUTION_LOW로 PDF를 보낸다', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: '번역 결과' });
    const client = new GeminiClient('test-key', 0);

    const text = await client.generateText('본문', 'gemini-2.5-flash', '지침', {
      pdfInput: { enabled: true, mode: 'standard' },
    });

    expect(text).toBe('번역 결과');
    const request = mockGenerateContent.mock.calls.at(-1)![0];
    expect(request.config.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');
    expect(request.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
  });
});

describe('GeminiClient 오류 분류', () => {
  it("본문에 'limit: 1500'이 있어도 콘텐츠 안전이 아니라 Rate Limit으로 분류한다", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error(`got status: 429. ${RPD_429_BODY}`));
    const client = new GeminiClient('test-key', 0);

    const error = await client.generateText('원문', 'gemini-2.5-flash').catch((e) => e);

    expect(error).toBeInstanceOf(GeminiRateLimitException);
    expect(error.details.limitType).toBe('RPD');
    expect(error.message).toContain('[일일 요청 수 제한 (RPD)');
    expect(GeminiClient.isContentSafetyError(error)).toBe(false);
  });
});
