
// services/TranslationService.ts
// Python domain/translation_service.py 의 TypeScript 변환

import { GeminiClient, GeminiContentSafetyException, GenerationConfig } from './GeminiClient';
import { ChunkService } from './ChunkService';
import { EpubChunkService } from './EpubChunkService';
import type { 
  GlossaryEntry, 
  TranslationResult, 
  TranslationJobProgress, 
  LogEntry 
} from '../types/dtos';
import type { AppConfig, PrefillHistoryItem } from '../types/config';
import type { EpubNode, EpubChapter } from '../types/epub';

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
  
  // 병렬 요청 취소를 위한 컨트롤러 집합
  private cancelControllers: Set<() => void> = new Set();

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
    
    // 현재 진행 중인 모든 요청 취소
    this.cancelControllers.forEach(cancel => cancel());
    this.cancelControllers.clear();
  }

  /**
   * 중단 상태 리셋
   */
  resetStop(): void {
    this.stopRequested = false;
    this.cancelControllers.clear();
  }

  /**
   * 프롬프트 구성
   */
  private constructPrompt(chunkText: string, chunkIndex: number): string {
    let prompt = this.config.prompts;

    // 용어집 컨텍스트 주입
    if (this.config.enableDynamicGlossaryInjection && prompt.includes('{{glossary_context}}')) {
      const glossaryContext = formatGlossaryForPrompt(
        this.glossaryEntries,
        chunkText,
        this.config.maxGlossaryEntriesPerChunkInjection,
        this.config.maxGlossaryCharsPerChunkInjection
      );

      // 용어집 주입 로깅
      if (glossaryContext !== '용어집 컨텍스트 없음') {
        const entries = glossaryContext.split('\n');
        const entryCount = entries.length;
        this.log('info', `청크 ${chunkIndex + 1}: 동적 용어집 ${entryCount}개 항목이 주입되었습니다.`);
        
        // 상위 3개 항목 로깅 (추가된 기능)
        const topItems = entries.slice(0, 3);
        topItems.forEach((item) => {
          // "- " 제거하여 깔끔하게 출력
          this.log('info', `   └ ${item.replace(/^- /, '')}`);
        });

        if (entryCount > 3) {
          this.log('info', `   └ ... 외 ${entryCount - 3}개`);
        }
      }

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
   * @param enableSafetyRetry - 실패 시 콘텐츠 안전 분할 재시도를 수행할지 여부 (재귀 호출 시 false로 설정)
   */
  async translateChunk(
    chunkText: string, 
    chunkIndex: number, 
    enableSafetyRetry: boolean = true
  ): Promise<TranslationResult> {
    if (!chunkText.trim()) {
      return {
        chunkIndex,
        originalText: chunkText,
        translatedText: '',
        success: true,
      };
    }

    const prompt = this.constructPrompt(chunkText, chunkIndex);
    const textPreview = chunkText.slice(0, 100).replace(/\n/g, ' ');
    this.log('info', `청크 ${chunkIndex + 1} 번역 시작 (모델: ${this.config.modelName}): "${textPreview}..."`);

    const generationConfig: GenerationConfig = {
      temperature: this.config.temperature,
      topP: this.config.topP,
    };

    // 취소 함수 정의
    let cancelThisRequest: (() => void) | undefined;

    // 취소 프로미스 생성
    const cancelPromise = new Promise<string>((_, reject) => {
      cancelThisRequest = () => {
        reject(new Error('CANCELLED_BY_USER'));
      };
    });

    // 취소 컨트롤러 등록
    if (cancelThisRequest) {
      this.cancelControllers.add(cancelThisRequest);
    }

    try {
      let apiPromise: Promise<string>;

      if (this.config.enablePrefillTranslation) {
        // 채팅 모드 (프리필 대체)
        const chatHistory = this.config.prefillCachedHistory.map(item => ({
          role: item.role,
          content: item.parts.join('\n'),
        }));
        
        apiPromise = this.geminiClient.generateWithChat(
          prompt,
          this.config.prefillSystemInstruction,
          chatHistory,
          this.config.modelName,
          generationConfig
        );
      } else {
        // 일반 모드
        apiPromise = this.geminiClient.generateText(
          prompt,
          this.config.modelName,
          undefined,
          generationConfig
        );
      }

      // API 호출과 취소 요청 경합
      const translatedText = await Promise.race([apiPromise, cancelPromise]);
      
      this.log('info', `청크 ${chunkIndex + 1} 번역 완료 (${translatedText.length}자)`);

      return {
        chunkIndex,
        originalText: chunkText,
        translatedText,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // [추가] 429 Rate Limit 에러 감지 시 번역 중단
      if (GeminiClient.isRateLimitError(error as Error)) {
        this.log('error', `API 할당량 초과(429) 감지. 번역 작업을 중단합니다.`);
        this.requestStop(); // 전체 작업 중단 요청
        
        return {
          chunkIndex,
          originalText: chunkText,
          translatedText: '',
          success: false,
          error: 'API 할당량 초과(429)로 인한 자동 중단',
        };
      }

      // 사용자 중단 처리
      if (errorMessage === 'CANCELLED_BY_USER') {
        this.log('warning', `청크 ${chunkIndex + 1} 번역 중단됨 (사용자 요청)`);
        return {
          chunkIndex,
          originalText: chunkText,
          translatedText: '',
          success: false,
          error: '사용자 중단',
        };
      }

      this.log('error', `청크 ${chunkIndex + 1} 번역 실패: ${errorMessage}`);

      // 콘텐츠 안전 재시도
      // enableSafetyRetry가 true일 때만 자체 재시도 로직 수행
      if (enableSafetyRetry && this.config.useContentSafetyRetry && GeminiClient.isContentSafetyError(error as Error)) {
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
    } finally {
      // 완료 후 취소 핸들러 제거
      if (cancelThisRequest) {
        this.cancelControllers.delete(cancelThisRequest);
      }
    }
  }

  /**
   * 작은 청크로 분할하여 재시도 (개선된 하이브리드 로직)
   */
  private async retryWithSmallerChunks(
    chunkText: string,
    originalIndex: number,
    currentAttempt: number = 1
  ): Promise<TranslationResult> {
    // 1. 최대 시도 횟수 초과 체크
    if (currentAttempt > this.config.maxRetryAttempts) {
      this.log('error', `최대 분할 시도 횟수(${this.config.maxRetryAttempts}) 도달. 번역 실패.`);
      return {
        chunkIndex: originalIndex,
        originalText: chunkText,
        translatedText: `[번역 오류로 인한 실패: 최대 분할 시도 초과]`,
        success: false,
        error: '콘텐츠 안전 문제로 인한 최대 분할 시도 초과',
      };
    }

    // 2. 최소 청크 크기 체크
    if (chunkText.trim().length <= this.config.minContentSafetyChunkSize) {
      const preview = chunkText.slice(0, 50).replace(/\n/g, ' ');
      this.log('warning', `최소 청크 크기에 도달했지만 여전히 오류 발생: ${preview}...`);
      return {
        chunkIndex: originalIndex,
        originalText: chunkText,
        translatedText: `[번역 오류로 인한 실패: ${chunkText.slice(0, 30)}...]`,
        success: false,
        error: '최소 청크 크기에서도 번역 실패',
      };
    }

    // 3. 상세 로깅
    this.log('info', `📊 청크 분할 시도 #${currentAttempt} (깊이: ${currentAttempt - 1})`);
    this.log('info', `   📏 원본 크기: ${chunkText.length} 글자`);
    this.log('info', `   🎯 목표 크기: ${Math.floor(chunkText.length / 2)} 글자`);
    const contentPreview = chunkText.slice(0, 100).replace(/\n/g, ' ');
    this.log('info', `   📝 내용 미리보기: ${contentPreview}...`);

    // 4. 분할 시도 (1단계: 크기 기반 재귀 분할)
    // 우선 줄바꿈 기준으로 절반 크기로 나누기를 시도합니다.
    let subChunks = this.chunkService.splitChunkRecursively(
      chunkText,
      Math.floor(chunkText.length / 2),
      this.config.minContentSafetyChunkSize,
      1, // 1단계만 깊이 제한 (여기서 재귀하지 않고 리스트만 받음)
      0
    );

    // 5. 분할 시도 (2단계: 문장 기반 분할)
    // 크기 기반 분할이 효과가 없었다면(덩어리가 그대로라면), 문장 단위로 강제 분할합니다.
    if (subChunks.length <= 1) {
      this.log('info', "크기 기반 분할 실패. 문장 기반 분할 시도.");
      subChunks = this.chunkService.splitChunkBySentences(chunkText, 1);
    }

    // 6. 분할 시도 (3단계: 강제 하드 분할)
    // 문장 분할조차 실패했다면(문장부호가 없는 경우 등), 강제로 문자열을 반으로 자릅니다.
    if (subChunks.length <= 1) {
      this.log('warning', "문장 기반 분할 실패. 강제 하드 분할 시도.");
      const halfLength = Math.ceil(chunkText.length / 2);
      subChunks = [chunkText.slice(0, halfLength), chunkText.slice(halfLength)];
    }
    
    // 여전히 분할되지 않았다면 포기
    if (subChunks.length <= 1) {
        this.log('error', "청크 분할 실패. 번역 포기.");
        return {
            chunkIndex: originalIndex,
            originalText: chunkText,
            translatedText: `[분할 불가능한 오류 발생 콘텐츠: ${chunkText.slice(0, 30)}...]`,
            success: false,
            error: '분할 불가능',
        };
    }

    this.log('info', `🔄 분할 완료: ${subChunks.length}개 서브 청크 생성`);

    // 7. 각 서브 청크 순차 처리 (하위 청크는 순차 처리 유지하여 복잡도 관리)
    const translatedParts: string[] = [];

    for (let i = 0; i < subChunks.length; i++) {
      if (this.stopRequested) {
        translatedParts.push('[중단됨]');
        break;
      }

      try {
        // 분할된 조각으로 번역 시도
        // 여기서 호출할 때는 enableSafetyRetry를 false로 설정하여
        // translateChunk가 에러를 가로채지 않고 그대로 던지거나 실패를 반환하게 함
        const result = await this.translateChunk(subChunks[i], originalIndex, false);
        
        if (this.stopRequested) {
            translatedParts.push('[중단됨]');
            break;
        }

        if (result.success) {
          translatedParts.push(result.translatedText);
        } else {
          // 실패 시 해당 조각에 대해 재귀 호출 (다음 시도 횟수 증가)
          this.log('info', `서브 청크 ${i+1}/${subChunks.length} 실패. 재귀 분할 진입.`);
          const retryResult = await this.retryWithSmallerChunks(
            subChunks[i],
            originalIndex,
            currentAttempt + 1
          );
          translatedParts.push(retryResult.translatedText);
        }
      } catch (error) {
        // 예외 발생 시에도 재귀 시도
        this.log('error', `서브 청크 처리 중 예외 발생. 재귀 분할 시도.`);
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
      translatedText: translatedParts.join('\n'), // 문장 간 자연스러운 연결을 위해 줄바꿈 사용
      success: true,
    };
  }

  /**
   * 전체 텍스트 번역 (병렬 처리 적용)
   * 
   * @param fullText - 전체 원문 텍스트
   * @param onProgress - 진행률 콜백
   * @param existingResults - (옵션) 이미 번역된 결과. 제공되면 해당 청크는 스킵합니다.
   * @param onResult - (옵션) 개별 청크 번역 완료 시 호출될 콜백 (실시간 업데이트용)
   */
  async translateText(
    fullText: string,
    onProgress?: ProgressCallback,
    existingResults?: TranslationResult[],
    onResult?: (result: TranslationResult) => void
  ): Promise<TranslationResult[]> {
    this.resetStop();

    // 청크 분할
    const chunks = this.chunkService.splitTextIntoChunks(fullText, this.config.chunkSize);
    this.log('info', `총 ${chunks.length}개 청크로 분할됨`);

    // 기존 결과 맵핑 (청크 인덱스 -> 결과)
    const existingMap = new Map<number, TranslationResult>();
    if (existingResults) {
      for (const res of existingResults) {
        if (res.success) {
          existingMap.set(res.chunkIndex, res);
        }
      }
      if (existingMap.size > 0) {
        this.log('info', `${existingMap.size}개의 기존 번역 결과를 발견했습니다. 스킵합니다.`);
      }
    }

    const results: TranslationResult[] = [];
    const maxWorkers = this.config.maxWorkers || 1;
    const startTime = Date.now(); // [추가] 시작 시간 기록

    const progress: TranslationJobProgress = {
      totalChunks: chunks.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '번역 시작...',
      etaSeconds: 0,
    };

    // 초기 상태 보고
    onProgress?.(progress);
    
    // 현재 처리 중인 Promise 집합 (병렬 처리 제어용)
    const processingPromises = new Set<Promise<void>>();

    for (let i = 0; i < chunks.length; i++) {
      // 중단 체크
      if (this.stopRequested) {
        this.log('warning', '번역이 사용자에 의해 중단되었습니다.');
        break;
      }

      // 1. 이미 번역된 청크 처리 (기존 결과 활용)
      if (existingMap.has(i)) {
        const existingResult = existingMap.get(i)!;
        
        // 원문 텍스트가 변경되었는지 확인 (옵션)
        if (existingResult.originalText.length === chunks[i].length) {
          results.push(existingResult);
          
          // [중요] 기존 결과도 실시간 반영을 위해 콜백 호출
          onResult?.(existingResult);

          // 진행률 업데이트
          progress.processedChunks++;
          progress.successfulChunks++;
          
          // 기존 항목 스킵 시 ETA 계산 (빠르게 넘어가므로 0으로 수렴할 수 있지만 계산은 수행)
          const now = Date.now();
          const elapsedSeconds = (now - startTime) / 1000;
          if (progress.processedChunks > 0) {
            const avgTimePerChunk = elapsedSeconds / progress.processedChunks;
            const remainingChunks = progress.totalChunks - progress.processedChunks;
            progress.etaSeconds = Math.ceil(avgTimePerChunk * remainingChunks);
          }
          
          onProgress?.(progress);

          this.log('debug', `청크 ${i + 1} 스킵 (이미 완료됨)`);
          continue; // Worker를 점유하지 않고 넘어감
        } else {
          this.log('warning', `청크 ${i + 1}의 기존 결과가 있으나 원문 길이가 일치하지 않아 재번역합니다.`);
        }
      }

      // 2. 새로운 번역 실행 (비동기 Task 생성)
      const task = (async () => {
        if (this.stopRequested) return;

        progress.currentStatusMessage = `청크 ${i + 1}/${chunks.length} 처리 중...`;
        progress.currentChunkProcessing = i; // 병렬이라 정확하진 않지만 대략적인 위치 표시
        onProgress?.(progress);

        try {
          const result = await this.translateChunk(chunks[i], i);
          
          if (this.stopRequested) return;

          results.push(result);
          onResult?.(result);

          // 결과 반영
          progress.processedChunks++;
          if (result.success) {
            progress.successfulChunks++;
          } else {
            progress.failedChunks++;
            progress.lastErrorMessage = result.error;
          }
          
          // [추가] ETA 계산
          const now = Date.now();
          const elapsedSeconds = (now - startTime) / 1000;
          if (progress.processedChunks > 0) {
            const avgTimePerChunk = elapsedSeconds / progress.processedChunks;
            const remainingChunks = progress.totalChunks - progress.processedChunks;
            progress.etaSeconds = Math.ceil(avgTimePerChunk * remainingChunks);
          }

          onProgress?.(progress);
        } catch (err) {
            // translateChunk 내부에서 대부분 처리되지만 안전망
            this.log('error', `Task ${i+1} unhandled error: ${err}`);
        }
      })();

      // Worker Pool 관리
      processingPromises.add(task);
      task.then(() => processingPromises.delete(task));

      // 최대 워커 수 도달 시 대기
      if (processingPromises.size >= maxWorkers) {
        await Promise.race(processingPromises);
      }
    }

    // 남은 작업 완료 대기
    await Promise.all(processingPromises);

    // 완료
    progress.currentStatusMessage = this.stopRequested ? '번역 중단됨' : '번역 완료';
    progress.currentChunkProcessing = undefined;
    progress.etaSeconds = 0; // 완료 시 ETA 0
    onProgress?.(progress);

    this.log('info', `번역 완료: 성공 ${progress.successfulChunks}, 실패 ${progress.failedChunks}`);

    // 병렬 처리로 인해 순서가 섞였을 수 있으므로 정렬
    return results.sort((a, b) => a.chunkIndex - b.chunkIndex);
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
   * 실패한 청크만 재번역 (병렬 처리 적용)
   * 
   * @param results - 전체 번역 결과
   * @param onProgress - 진행률 콜백
   * @param onResult - (옵션) 실시간 업데이트를 위한 콜백
   */
  async retryFailedChunks(
    results: TranslationResult[],
    onProgress?: ProgressCallback,
    onResult?: (result: TranslationResult) => void
  ): Promise<TranslationResult[]> {
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length === 0) {
      this.log('info', '재시도할 실패한 청크가 없습니다.');
      return results;
    }

    this.log('info', `${failedResults.length}개 실패 청크 재번역 시작`);
    this.resetStop();

    const progress: TranslationJobProgress = {
      totalChunks: failedResults.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '실패 청크 재번역 시작...',
      etaSeconds: 0,
    };

    onProgress?.(progress);

    const updatedResults = [...results];
    const maxWorkers = this.config.maxWorkers || 1;
    const processingPromises = new Set<Promise<void>>();
    const startTime = Date.now(); // [추가] 시작 시간

    for (const failedResult of failedResults) {
      if (this.stopRequested) break;

      const task = (async () => {
        if (this.stopRequested) return;

        progress.currentStatusMessage = `청크 ${failedResult.chunkIndex + 1} 재번역 중...`;
        progress.currentChunkProcessing = failedResult.chunkIndex;
        onProgress?.(progress);

        const newResult = await this.translateChunk(
          failedResult.originalText,
          failedResult.chunkIndex
        );

        if (this.stopRequested) return;

        // 결과 업데이트
        const index = updatedResults.findIndex(r => r.chunkIndex === failedResult.chunkIndex);
        if (index >= 0) {
          updatedResults[index] = newResult;
        }

        // [중요] 재번역 결과 실시간 전송
        onResult?.(newResult);

        progress.processedChunks++;
        if (newResult.success) {
          progress.successfulChunks++;
        } else {
          progress.failedChunks++;
          progress.lastErrorMessage = newResult.error;
        }

        // [추가] ETA 계산
        const now = Date.now();
        const elapsedSeconds = (now - startTime) / 1000;
        if (progress.processedChunks > 0) {
          const avgTimePerChunk = elapsedSeconds / progress.processedChunks;
          const remainingChunks = progress.totalChunks - progress.processedChunks;
          progress.etaSeconds = Math.ceil(avgTimePerChunk * remainingChunks);
        }

        onProgress?.(progress);
      })();

      processingPromises.add(task);
      task.then(() => processingPromises.delete(task));

      if (processingPromises.size >= maxWorkers) {
        await Promise.race(processingPromises);
      }
    }

    await Promise.all(processingPromises);

    progress.currentStatusMessage = '재번역 완료';
    progress.currentChunkProcessing = undefined;
    progress.etaSeconds = 0;
    onProgress?.(progress);

    return updatedResults.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  /**
   * EPUB 노드 배열 번역 (공개 메서드)
   * 
   * @param nodes 번역할 EpubNode 배열
   * @param glossaryEntries 용어집 (선택사항)
   * @param onProgress 진행 콜백 (선택사항)
   * @returns 번역된 EpubNode 배열
   */
  async translateEpubNodes(
    nodes: EpubNode[],
    glossaryEntries?: GlossaryEntry[],
    onProgress?: ProgressCallback
  ): Promise<EpubNode[]> {
    this.log('info', `🚀 EPUB 번역 시작: ${nodes.length}개 노드`);

    try {
      // 1. EpubChunkService로 배열 분할
      const epubChunkService = new EpubChunkService(
        this.config.epubChunkSize,
        this.config.epubMaxNodesPerChunk
      );

      const chunks = epubChunkService.splitEpubNodesIntoChunks(nodes);
      this.log('info', `📦 ${chunks.length}개 청크로 분할 완료`);

      // 2. 각 청크별 번역
      const translatedNodes: EpubNode[] = [];
      let processedChunks = 0;
      let failedChunks = 0;

      for (let i = 0; i < chunks.length; i++) {
        try {
          const translated = await this.translateEpubChunk(
            chunks[i],
            glossaryEntries
          );
          translatedNodes.push(...translated);
          processedChunks++;

          // 진행률 업데이트
          if (onProgress) {
            onProgress({
              totalChunks: chunks.length,
              processedChunks,
              successfulChunks: processedChunks,
              failedChunks,
              currentStatusMessage: `청크 ${i + 1}/${chunks.length} 번역 완료`,
            });
          }

          this.log('info', `✅ 청크 ${i + 1}/${chunks.length} 완료`);
        } catch (error) {
          this.log('warning', `⚠️ 청크 ${i}번 번역 실패. 분할 정복 시작...`);

          // 오류 발생 시 재귀 분할 정복
          const retriedNodes = await this.retryEpubNodesWithSmallerBatches(
            chunks[i],
            i,
            glossaryEntries,
            1
          );
          translatedNodes.push(...retriedNodes);
          failedChunks++;

          if (onProgress) {
            onProgress({
              totalChunks: chunks.length,
              processedChunks: i + 1,
              successfulChunks: processedChunks,
              failedChunks,
              currentStatusMessage: `청크 ${i + 1}/${chunks.length} 재시도 완료`,
            });
          }
        }
      }

      this.log('info', `📚 EPUB 번역 완료: ${translatedNodes.length}개 노드`);
      return translatedNodes;
    } catch (error) {
      this.log('error', `❌ EPUB 번역 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * EPUB 노드 배치 번역 (통합된 프롬프트 및 프리필 적용 버전)
   * 
   * @param nodes 번역할 노드 배열 (type='text'인 항목만)
   * @param glossaryEntries 용어집 (선택사항)
   * @returns 번역된 노드 배열
   */
  private async translateEpubChunk(
    nodes: EpubNode[],
    glossaryEntries?: GlossaryEntry[]
  ): Promise<EpubNode[]> {
    // 1. 텍스트 노드만 필터링
    const textNodes = nodes.filter((n) => n.type === 'text');

    if (textNodes.length === 0) {
      return nodes; // 텍스트 노드 없음 → 원본 반환
    }

    // 2. 요청 데이터 구성 (JSON 변환)
    const requestData = textNodes.map((n) => ({
      id: n.id,
      text: n.content,
    }));
    
    // 텍스트 노드들을 JSON 문자열로 직렬화 (이것이 {{slot}}에 들어감)
    const jsonString = JSON.stringify(requestData, null, 2);

    // 3. 프롬프트 구성
    // 사용자 설정 프롬프트 템플릿 사용 (용어집 자동 주입 포함)
    const prompt = this.constructPrompt(jsonString, 0);

    // 4. JSON Schema 설정 (구조화된 출력 강제)
    const config: GenerationConfig = {
      temperature: this.config.temperature,
      topP: this.config.topP,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            translated_text: { type: 'STRING' },
          },
          required: ['id', 'translated_text'],
        },
      },
    };

    try {
      let responseText: string;

      // 5. API 호출 (Prefill 설정 적용)
      if (this.config.enablePrefillTranslation) {
        // 채팅 모드 (프리필 히스토리 주입)
        const chatHistory = this.config.prefillCachedHistory.map(item => ({
          role: item.role,
          content: item.parts.join('\n'),
        }));
        
        responseText = await this.geminiClient.generateWithChat(
          prompt,
          this.config.prefillSystemInstruction,
          chatHistory,
          this.config.modelName,
          config
        );
      } else {
        // 일반 모드
        responseText = await this.geminiClient.generateText(
          prompt,
          this.config.modelName,
          this.config.prefillSystemInstruction,
          config
        );
      }

      // 6. 응답 파싱 및 적용
      const translations: Array<{ id: string; translated_text: string }> = JSON.parse(responseText);

      // ID 기준 매핑
      const translationMap = new Map(
        translations.map((t) => [t.id, t.translated_text])
      );

      // 원본 노드에 번역 결과 병합
      return nodes.map((node) => {
        if (node.type === 'text' && translationMap.has(node.id)) {
          return {
            ...node,
            content: translationMap.get(node.id),
          };
        }
        return node;
      });

    } catch (error) {
      this.log('error', `❌ EPUB 청크 번역 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * EPUB 노드 배열의 재귀적 분할 정복 재시도 로직
   * 
   * Rate Limit, Safety Filter, Context Overflow 등의 오류 시 자동 복구
   * 
   * @param nodes 번역할 EpubNode 배열
   * @param originalChunkIndex 로깅용 청크 인덱스
   * @param glossaryEntries 용어집 (선택사항)
   * @param currentAttempt 현재 시도 깊이
   * @returns 번역된 EpubNode 배열 (실패한 노드는 원문 유지)
   */
  private async retryEpubNodesWithSmallerBatches(
    nodes: EpubNode[],
    originalChunkIndex: number,
    glossaryEntries?: GlossaryEntry[],
    currentAttempt: number = 1
  ): Promise<EpubNode[]> {
    // 1. 탈출 조건: 빈 배열
    if (nodes.length === 0) {
      return [];
    }

    // 2. 탈출 조건: 단일 노드인데도 실패한 경우
    if (nodes.length === 1) {
      this.log('error', `❌ 노드 ID ${nodes[0].id} 번역 실패 (개별 격리됨). 원문 유지.`);
      return [nodes[0]]; // 원문 그대로 반환
    }

    // 3. 탈출 조건: 최대 깊이 도달
    const maxRetryDepth = this.config.maxRetryAttempts;
    if (currentAttempt > maxRetryDepth) {
      this.log('error', `⚠️ 최대 분할 시도 ${maxRetryDepth}회 초과. 해당 배치 원문 반환.`);
      return nodes;
    }

    // 4. 배열을 이진 분할 (Binary Split)
    const mid = Math.floor(nodes.length / 2);
    const leftBatch = nodes.slice(0, mid);
    const rightBatch = nodes.slice(mid);

    this.log('info', `🔄 배치 분할 재시도 #${currentAttempt}: ${nodes.length}개 노드 → ${leftBatch.length}개 + ${rightBatch.length}개`);

    const results: EpubNode[] = [];

    // 5. 각 배치를 순차 처리
    for (const batch of [leftBatch, rightBatch]) {
      try {
        const translatedBatch = await this.translateEpubChunk(batch, glossaryEntries);
        results.push(...translatedBatch);
      } catch (error) {
        this.log('warning', `⚠️ 배치(${batch.length}개) 번역 실패. 재귀 분할 시작.`);

        // 실패한 배치만 더 깊이 분할하여 재시도
        const retriedResults = await this.retryEpubNodesWithSmallerBatches(
          batch,
          originalChunkIndex,
          glossaryEntries,
          currentAttempt + 1
        );
        results.push(...retriedResults);
      }
    }

    return results;
  }
}
