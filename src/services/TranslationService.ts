// services/TranslationService.ts
// Python domain/translation_service.py 의 TypeScript 변환

import { GeminiClient, GeminiContentSafetyException, GenerationConfig } from './GeminiClient';
import { ChunkService } from './ChunkService';
import type { 
  GlossaryEntry, 
  TranslationResult, 
  TranslationJobProgress,
  LogEntry 
} from '../types/dtos';
import type { AppConfig, PrefillHistoryItem } from '../types/config';

/**
 * 번역 진행 콜백 타입
 */
export type ProgressCallback = (progress: TranslationJobProgress) => void;

/**
 * 로그 콜백 타입
 */
export type LogCallback = (entry: LogEntry) => void;

/**
 * 용어집 항목을 프롬프트 형식으로 포맷팅
 */
function formatGlossaryForPrompt(
  glossaryEntries: GlossaryEntry[],
  chunkText: string,
  maxEntries: number = 30,
  maxChars: number = 2000
): string {
  if (!glossaryEntries.length) {
    return '용어집 컨텍스트 없음';
  }

  const chunkLower = chunkText.toLowerCase();

  // 현재 청크에 등장하는 용어만 필터링 + 등장 횟수 순 정렬
  const relevantEntries = glossaryEntries
    .filter(e => chunkLower.includes(e.keyword.toLowerCase()))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  const selected: string[] = [];
  let currentChars = 0;

  for (const entry of relevantEntries) {
    if (selected.length >= maxEntries) break;

    const entryStr = `- ${entry.keyword} → ${entry.translatedKeyword} (${entry.targetLanguage})`;
    
    // 최대 글자 수 초과 시 중단 (단, 최소 1개는 포함)
    if (currentChars + entryStr.length > maxChars && selected.length > 0) break;

    selected.push(entryStr);
    currentChars += entryStr.length + 1;
  }

  return selected.length ? selected.join('\n') : '용어집 컨텍스트 없음';
}

/**
 * 번역 서비스 클래스
 */
export class TranslationService {
  private geminiClient: GeminiClient;
  private chunkService: ChunkService;
  private config: AppConfig;
  private glossaryEntries: GlossaryEntry[] = [];
  private stopRequested: boolean = false;
  private onLog?: LogCallback;

  constructor(config: AppConfig, apiKey?: string) {
    this.config = config;
    this.geminiClient = new GeminiClient(apiKey, config.requestsPerMinute);
    this.chunkService = new ChunkService(config.chunkSize);
  }

  /**
   * 로그 콜백 설정
   */
  setLogCallback(callback: LogCallback): void {
    this.onLog = callback;
  }

  /**
   * 로그 출력
   */
  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { level, message, timestamp: new Date() };
    console.log(`[${level.toUpperCase()}] ${message}`);
    this.onLog?.(entry);
  }

  /**
   * 용어집 설정
   */
  setGlossaryEntries(entries: GlossaryEntry[]): void {
    this.glossaryEntries = entries;
    this.log('info', `용어집 ${entries.length}개 항목 로드됨`);
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<AppConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.requestsPerMinute !== undefined) {
      this.geminiClient.setRequestsPerMinute(config.requestsPerMinute);
    }
  }

  /**
   * 번역 중단 요청
   */
  requestStop(): void {
    this.stopRequested = true;
    this.log('warning', '번역 중단이 요청되었습니다.');
  }

  /**
   * 중단 상태 리셋
   */
  resetStop(): void {
    this.stopRequested = false;
  }

  /**
   * 프롬프트 구성
   */
  private constructPrompt(chunkText: string): string {
    let prompt = this.config.prompts;

    // 용어집 컨텍스트 주입
    if (this.config.enableDynamicGlossaryInjection && prompt.includes('{{glossary_context}}')) {
      const glossaryContext = formatGlossaryForPrompt(
        this.glossaryEntries,
        chunkText,
        this.config.maxGlossaryEntriesPerChunkInjection,
        this.config.maxGlossaryCharsPerChunkInjection
      );
      prompt = prompt.replace('{{glossary_context}}', glossaryContext);
    } else if (prompt.includes('{{glossary_context}}')) {
      prompt = prompt.replace('{{glossary_context}}', '용어집 컨텍스트 없음');
    }

    // 본문 삽입
    prompt = prompt.replace('{{slot}}', chunkText);

    return prompt;
  }

  /**
   * 단일 청크 번역
   */
  async translateChunk(chunkText: string, chunkIndex: number): Promise<TranslationResult> {
    if (!chunkText.trim()) {
      return {
        chunkIndex,
        originalText: chunkText,
        translatedText: '',
        success: true,
      };
    }

    const prompt = this.constructPrompt(chunkText);
    const textPreview = chunkText.slice(0, 100).replace(/\n/g, ' ');
    this.log('info', `청크 ${chunkIndex + 1} 번역 시작: "${textPreview}..."`);

    const generationConfig: GenerationConfig = {
      temperature: this.config.temperature,
      topP: this.config.topP,
    };

    try {
      let translatedText: string;

      if (this.config.enablePrefillTranslation) {
        // 채팅 모드 (프리필 대체)
        // PrefillHistoryItem을 ChatMessage 형식으로 변환
        const chatHistory = this.config.prefillCachedHistory.map(item => ({
          role: item.role,
          content: item.parts.join('\n'),
        }));
        
        translatedText = await this.geminiClient.generateWithChat(
          prompt,
          this.config.prefillSystemInstruction,
          chatHistory,
          this.config.modelName,
          generationConfig
        );
      } else {
        // 일반 모드
        translatedText = await this.geminiClient.generateText(
          prompt,
          this.config.modelName,
          undefined,
          generationConfig
        );
      }

      this.log('info', `청크 ${chunkIndex + 1} 번역 완료 (${translatedText.length}자)`);

      return {
        chunkIndex,
        originalText: chunkText,
        translatedText,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `청크 ${chunkIndex + 1} 번역 실패: ${errorMessage}`);

      // 콘텐츠 안전 재시도
      if (this.config.useContentSafetyRetry && GeminiClient.isContentSafetyError(error as Error)) {
        this.log('warning', `콘텐츠 안전 오류 감지. 분할 재시도 시작...`);
        return this.retryWithSmallerChunks(chunkText, chunkIndex);
      }

      return {
        chunkIndex,
        originalText: chunkText,
        translatedText: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 작은 청크로 분할하여 재시도
   */
  private async retryWithSmallerChunks(
    chunkText: string,
    originalIndex: number,
    currentAttempt: number = 1
  ): Promise<TranslationResult> {
    if (currentAttempt > this.config.maxContentSafetySplitAttempts) {
      this.log('error', `최대 분할 시도 횟수(${this.config.maxContentSafetySplitAttempts}) 초과`);
      return {
        chunkIndex: originalIndex,
        originalText: chunkText,
        translatedText: `[번역 실패: 최대 분할 시도 초과]`,
        success: false,
        error: '콘텐츠 안전 문제로 인한 최대 분할 시도 초과',
      };
    }

    if (chunkText.trim().length <= this.config.minContentSafetyChunkSize) {
      this.log('warning', `최소 청크 크기 도달. 번역 불가: ${chunkText.slice(0, 50)}...`);
      return {
        chunkIndex: originalIndex,
        originalText: chunkText,
        translatedText: `[번역 실패: ${chunkText.slice(0, 30)}...]`,
        success: false,
        error: '최소 청크 크기에서도 번역 실패',
      };
    }

    this.log('info', `청크 분할 시도 #${currentAttempt}`);

    // 분할
    const subChunks = this.config.contentSafetySplitBySentences
      ? this.chunkService.splitChunkBySentences(chunkText, 2)
      : this.chunkService.splitChunkRecursively(
          chunkText,
          Math.ceil(chunkText.length / 2),
          this.config.minContentSafetyChunkSize,
          this.config.maxContentSafetySplitAttempts
        );

    if (subChunks.length <= 1) {
      // 분할 실패 시 강제 분할
      const halfLength = Math.ceil(chunkText.length / 2);
      subChunks.length = 0;
      subChunks.push(chunkText.slice(0, halfLength), chunkText.slice(halfLength));
    }

    this.log('info', `${subChunks.length}개 서브 청크로 분할됨`);

    const translatedParts: string[] = [];

    for (let i = 0; i < subChunks.length; i++) {
      if (this.stopRequested) {
        translatedParts.push('[중단됨]');
        break;
      }

      try {
        const result = await this.translateChunk(subChunks[i], originalIndex);
        if (result.success) {
          translatedParts.push(result.translatedText);
        } else {
          // 재귀적 재시도
          const retryResult = await this.retryWithSmallerChunks(
            subChunks[i],
            originalIndex,
            currentAttempt + 1
          );
          translatedParts.push(retryResult.translatedText);
        }
      } catch (error) {
        const retryResult = await this.retryWithSmallerChunks(
          subChunks[i],
          originalIndex,
          currentAttempt + 1
        );
        translatedParts.push(retryResult.translatedText);
      }
    }

    return {
      chunkIndex: originalIndex,
      originalText: chunkText,
      translatedText: translatedParts.join('\n'),
      success: true,
    };
  }

  /**
   * 전체 텍스트 번역
   */
  async translateText(
    fullText: string,
    onProgress?: ProgressCallback
  ): Promise<TranslationResult[]> {
    this.stopRequested = false;

    // 청크 분할
    const chunks = this.chunkService.splitTextIntoChunks(fullText, this.config.chunkSize);
    this.log('info', `총 ${chunks.length}개 청크로 분할됨`);

    const results: TranslationResult[] = [];

    const progress: TranslationJobProgress = {
      totalChunks: chunks.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '번역 시작...',
    };

    onProgress?.(progress);

    for (let i = 0; i < chunks.length; i++) {
      // 중단 체크
      if (this.stopRequested) {
        progress.currentStatusMessage = '사용자에 의해 중단됨';
        onProgress?.(progress);
        this.log('warning', '번역이 사용자에 의해 중단되었습니다.');
        break;
      }

      // 진행 상황 업데이트
      progress.currentStatusMessage = `청크 ${i + 1}/${chunks.length} 번역 중...`;
      progress.currentChunkProcessing = i;
      onProgress?.(progress);

      // 번역 실행
      const result = await this.translateChunk(chunks[i], i);
      results.push(result);

      // 결과 반영
      progress.processedChunks++;
      if (result.success) {
        progress.successfulChunks++;
      } else {
        progress.failedChunks++;
        progress.lastErrorMessage = result.error;
      }

      onProgress?.(progress);
    }

    // 완료
    progress.currentStatusMessage = this.stopRequested ? '번역 중단됨' : '번역 완료';
    progress.currentChunkProcessing = undefined;
    onProgress?.(progress);

    this.log('info', `번역 완료: 성공 ${progress.successfulChunks}, 실패 ${progress.failedChunks}`);

    return results;
  }

  /**
   * 번역 결과를 텍스트로 합치기
   */
  static combineResults(results: TranslationResult[]): string {
    return results
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(r => r.translatedText)
      .join('');
  }

  /**
   * 실패한 청크만 재번역
   */
  async retryFailedChunks(
    results: TranslationResult[],
    onProgress?: ProgressCallback
  ): Promise<TranslationResult[]> {
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length === 0) {
      this.log('info', '재시도할 실패한 청크가 없습니다.');
      return results;
    }

    this.log('info', `${failedResults.length}개 실패 청크 재번역 시작`);

    const progress: TranslationJobProgress = {
      totalChunks: failedResults.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '실패 청크 재번역 시작...',
    };

    onProgress?.(progress);

    const updatedResults = [...results];

    for (const failedResult of failedResults) {
      if (this.stopRequested) break;

      progress.currentStatusMessage = `청크 ${failedResult.chunkIndex + 1} 재번역 중...`;
      progress.currentChunkProcessing = failedResult.chunkIndex;
      onProgress?.(progress);

      const newResult = await this.translateChunk(
        failedResult.originalText,
        failedResult.chunkIndex
      );

      // 결과 업데이트
      const index = updatedResults.findIndex(r => r.chunkIndex === failedResult.chunkIndex);
      if (index >= 0) {
        updatedResults[index] = newResult;
      }

      progress.processedChunks++;
      if (newResult.success) {
        progress.successfulChunks++;
      } else {
        progress.failedChunks++;
        progress.lastErrorMessage = newResult.error;
      }

      onProgress?.(progress);
    }

    progress.currentStatusMessage = '재번역 완료';
    progress.currentChunkProcessing = undefined;
    onProgress?.(progress);

    return updatedResults;
  }
}
