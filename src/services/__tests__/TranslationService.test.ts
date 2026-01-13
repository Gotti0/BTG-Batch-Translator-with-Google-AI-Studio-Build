import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationService } from '../TranslationService';
import type { AppConfig } from '../../types/config';
import type { TranslationContext } from '../../types/dtos';

// Mock 변수들을 vi.hoisted로 감싸서 호이스팅 이슈 방지
const { mockGenerateText, mockGenerateWithChat, mockGetAvailableModels, mockSetRequestsPerMinute } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGenerateWithChat: vi.fn(),
  mockGetAvailableModels: vi.fn().mockResolvedValue(['gemini-pro']),
  mockSetRequestsPerMinute: vi.fn(),
}));

vi.mock('../GeminiClient', () => {
  const MockGeminiClient = vi.fn().mockImplementation(function (this: any) {
    this.generateText = mockGenerateText;
    this.generateWithChat = mockGenerateWithChat;
    this.getAvailableModels = mockGetAvailableModels;
    this.setRequestsPerMinute = mockSetRequestsPerMinute;
  });

  // static 메서드 추가
  (MockGeminiClient as any).isRateLimitError = vi.fn().mockReturnValue(false);
  (MockGeminiClient as any).isContentSafetyError = vi.fn().mockReturnValue(false);
  (MockGeminiClient as any).isQuotaError = vi.fn().mockReturnValue(false);

  return {
    GeminiClient: MockGeminiClient,
    GeminiContentSafetyException: class extends Error {},
    GeminiRateLimitException: class extends Error {},
    GeminiApiException: class extends Error {},
  };
});

describe('TranslationService Pipelines', () => {
  let service: TranslationService;
  const defaultConfig: AppConfig = {
    modelName: 'gemini-pro',
    temperature: 0.7,
    requestsPerMinute: 10,
    chunkSize: 1000,
    prompts: 'Glossary: {{glossary_context}}\nText: {{slot}}',
    prefillSystemInstruction: '',
    prefillCachedHistory: [],
    enablePrefillTranslation: false,
    enableDynamicGlossaryInjection: false,
    maxGlossaryEntriesPerChunkInjection: 30,
    maxGlossaryCharsPerChunkInjection: 2000,
    epubMaxNodesPerChunk: 30,
    maxWorkers: 1,
    maxRetryAttempts: 3,
    enableImageAnnotation: false,
    topP: 1,
    enableThinking: false,
    thinkingBudget: 0,
    thinkingLevel: 'MINIMAL',
    novelLanguage: 'Japanese',
    novelLanguageFallback: 'English',
    useContentSafetyRetry: true,
    minContentSafetyChunkSize: 100,
    contentSafetySplitBySentences: true,
    glossaryExtractionTemperature: 0,
    glossarySamplingRatio: 1,
    glossaryMaxTotalEntries: 100,
    glossaryTargetLanguageCode: 'ko',
    glossaryTargetLanguageName: 'Korean',
    glossaryChunkSize: 1000,
    glossaryExtractionPrompt: '',
    enableGlossaryPrefill: false,
    glossaryPrefillSystemInstruction: '',
    glossaryPrefillCachedHistory: [],
    enablePostProcessing: true,
    removeTranslationHeaders: true,
    removeMarkdownBlocks: true,
    removeChunkIndexes: true,
    cleanHtmlTags: true
  };

  const context: TranslationContext = {
    glossaryEntries: [
      { id: '1', keyword: 'Apple', translatedKeyword: '사과', targetLanguage: 'Korean', occurrenceCount: 0 }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TranslationService(defaultConfig, 'fake-api-key');
  });

  describe('Standard Text Pipeline (translateText)', () => {
    it('should split text into chunks and translate each', async () => {
      const text = 'Hello world. This is a test.';
      const mockResult = '안녕하세요 세계. 테스트입니다.';
      
      mockGenerateText.mockResolvedValue(mockResult);

      const result = await service.translateText(text, context);

      // translateText returns TranslationResult[]
      expect(result[0].translatedText).toBe(mockResult);
      expect(mockGenerateText).toHaveBeenCalled();
    });

    it('should inject glossary if enabled', async () => {
      const configWithGlossary = { ...defaultConfig, enableDynamicGlossaryInjection: true };
      const serviceWithGlossary = new TranslationService(configWithGlossary, 'fake-api-key');
      const text = 'I like Apple.';
      
      mockGenerateText.mockResolvedValue('나는 사과를 좋아한다.');

      await serviceWithGlossary.translateText(text, context);

      const lastCall = mockGenerateText.mock.calls[0];
      const prompt = lastCall[0];
      expect(prompt).toContain('Apple');
      expect(prompt).toContain('사과');
    });
  });

  describe('Integrity Pipeline (translateTextWithIntegrityGuarantee)', () => {
    it('should wrap lines in JSON and handle the response', async () => {
      const text = 'Line 1\nLine 2';
      // Integrity mode expects JSON output from Gemini
      // The IDs are generated as text_00000, text_00001 etc.
      const mockJsonResponse = JSON.stringify([
        { id: 'text_00000', translated_text: '라인 1' },
        { id: 'text_00001', translated_text: '라인 2' }
      ]);

      mockGenerateText.mockResolvedValue(mockJsonResponse);

      const result = await service.translateTextWithIntegrityGuarantee(text, context);

      expect(result.text).toContain('라인 1');
      expect(result.text).toContain('라인 2');
    });
  });
});