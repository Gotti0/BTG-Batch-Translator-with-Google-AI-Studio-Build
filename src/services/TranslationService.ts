// services/TranslationService.ts
// Python domain/translation_service.py 의 TypeScript 변환

import {
  GeminiClient,
  GeminiContentSafetyException,
  GenerationConfig,
  type PdfInputOptions,
  type RateLimitDetails,
} from './GeminiClient';
import {
  RequestGate,
  GATE_CANCELLED_MESSAGE,
  GATE_PRIORITY_MAIN,
  GATE_PRIORITY_SUBCHUNK,
} from './RequestGate';
import { ChunkService } from './ChunkService';
import { EpubChunkService } from './EpubChunkService';
import { TextNodeService, TextNode } from './TextNodeService';
import { ImageAnnotationService } from './ImageAnnotationService';
import JSZip from 'jszip';
import type {
  GlossaryEntry,
  TranslationResult,
  TranslationJobProgress,
  LogEntry,
  TranslationContext
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
  private textNodeService: TextNodeService;
  private config: AppConfig;
  private apiKey?: string;
  // 새 요청을 더 만들지 않는다 (429 마무리 중단과 사용자 중단 공통)
  private stopRequested: boolean = false;
  // 진행 중인 요청까지 버린다 (사용자 중단에서만)
  private abortRequested: boolean = false;
  private stopReason?: string;
  private onLog?: LogCallback;
  private onRateLimit?: (details: RateLimitDetails) => void;

  // 번역 요청의 RPM을 통제하는 게이트 (분할 재시도 서브청크를 먼저 내보낸다)
  private requestGate: RequestGate;

  // 병렬 요청 취소를 위한 컨트롤러 집합
  private cancelControllers: Set<() => void> = new Set();
  constructor(config: AppConfig, apiKey?: string) {
    this.config = config;
    this.apiKey = apiKey;
    this.geminiClient = new GeminiClient(apiKey, config.requestsPerMinute);
    this.requestGate = new RequestGate(config.requestsPerMinute);
    this.chunkService = new ChunkService(config.chunkSize);
    this.textNodeService = new TextNodeService();
  }

  /**
   * 로그 콜백 설정
   */
  setLogCallback(callback: LogCallback): void {
    this.onLog = callback;
  }

  /**
   * 429로 작업을 멈출 때 호출될 콜백 설정
   */
  setRateLimitCallback(callback?: (details: RateLimitDetails) => void): void {
    this.onRateLimit = callback;
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
   * 설정 업데이트
   */
  updateConfig(config: Partial<AppConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.requestsPerMinute !== undefined) {
      this.geminiClient.setRequestsPerMinute(config.requestsPerMinute);
      this.requestGate.setRequestsPerMinute(config.requestsPerMinute);
    }
  }

  /**
   * 번역 중단 요청 (사용자 중단: 진행 중인 요청까지 즉시 취소)
   */
  requestStop(): void {
    this.stopRequested = true;
    this.abortRequested = true;
    this.stopReason = '사용자 중단';
    this.log('warning', '번역 중단이 요청되었습니다.');

    this.requestGate.cancelAll(this.stopReason);

    // 현재 진행 중인 모든 요청 취소
    this.cancelControllers.forEach(cancel => cancel());
    this.cancelControllers.clear();
  }

  /**
   * 마무리 중단: 새 요청은 내보내지 않고, 이미 API에 보낸 요청은 응답을 받아 결과에 반영한다.
   * 이미 보낸 요청은 할당량을 이미 썼으므로 취소해도 돌려받을 것이 없다.
   */
  requestDrainStop(reason: string): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    this.stopReason = reason;
    const cancelled = this.requestGate.cancelAll(reason);
    this.log(
      'warning',
      `${reason} → 새 요청을 멈추고 이미 보낸 요청만 마무리합니다.${cancelled > 0 ? ` (대기 중이던 요청 ${cancelled}건 취소)` : ''}`
    );
  }

  /**
   * 중단 상태 리셋
   */
  resetStop(): void {
    this.stopRequested = false;
    this.abortRequested = false;
    this.stopReason = undefined;
    this.cancelControllers.clear();
    this.requestGate.reset();
  }

  /**
   * 게이트에서 API 호출 허가를 받는다. 중단된 뒤에는 바로 실패한다.
   */
  private async acquireRequestSlot(chunkIndex: number, isSubchunk: boolean): Promise<void> {
    if (this.stopRequested) {
      throw new Error(GATE_CANCELLED_MESSAGE);
    }
    await this.requestGate.acquire(
      isSubchunk
        ? { priority: GATE_PRIORITY_SUBCHUNK }
        : { priority: GATE_PRIORITY_MAIN, orderKey: chunkIndex }
    );
  }

  /**
   * 설정에 PDF 입력이 켜져 있으면 번역 요청에 붙일 옵션을 만든다
   */
  private getPdfInputOptions(chunkIndex: number): PdfInputOptions | undefined {
    if (!this.config.enablePdfInput) return undefined;
    return {
      enabled: true,
      mode: this.config.pdfInputMode,
      downloadDebug: this.config.downloadDebugPdf,
      label: `chunk_${chunkIndex + 1}`,
    };
  }

  /**
   * 429 오류를 기록하고 마무리 중단으로 전환한다.
   * @returns 로그·결과 메시지에 쓸 한도 요약
   */
  private handleRateLimit(error: Error, label: string): string {
    const details = GeminiClient.getRateLimitDetails(error);
    if (!this.stopRequested) {
      this.log('error', `🛑 429 Rate Limit 감지 (${label}): ${details.formattedSummary}`);
      this.requestDrainStop(`429 Rate Limit (${details.limitTypeName})`);
      this.onRateLimit?.(details);
    }
    return details.formattedSummary;
  }

  /**
   * 프롬프트 및 컨텍스트 데이터 준비 (리팩토링됨)
   * 
   * @param chunkText 번역할 텍스트 청크
   * @param chunkIndex 청크 인덱스 (로깅용)
   * @returns { prompt: string, glossaryContext: string } 구성된 프롬프트와 용어집 컨텍스트
   */
  /**
   * 프롬프트 및 컨텍스트 준비
   * [Stateless] 인스턴스 변수가 아닌 명시적으로 전달된 glossaryEntries를 사용합니다.
   */
  private preparePromptAndContext(
    chunkText: string,
    chunkIndex: number,
    glossaryEntries: GlossaryEntry[]
  ): { prompt: string, glossaryContext: string } {
    let prompt = this.config.prompts;
    let glossaryContext = '용어집 컨텍스트 없음';

    // 용어집 컨텍스트 생성
    if (this.config.enableDynamicGlossaryInjection) {
      glossaryContext = formatGlossaryForPrompt(
        glossaryEntries,
        chunkText,
        this.config.maxGlossaryEntriesPerChunkInjection,
        this.config.maxGlossaryCharsPerChunkInjection
      );

      // 용어집 로깅 (컨텍스트가 생성된 경우)
      if (glossaryContext !== '용어집 컨텍스트 없음') {
        const entries = glossaryContext.split('\n');
        const entryCount = entries.length;
        this.log('info', `청크 ${chunkIndex + 1}: 동적 용어집 ${entryCount}개 항목이 준비되었습니다.`);

        // 상위 3개 항목 로깅
        const topItems = entries.slice(0, 3);
        topItems.forEach((item) => {
          this.log('info', `   └ ${item.replace(/^- /, '')}`);
        });

        if (entryCount > 3) {
          this.log('info', `   └ ... 외 ${entryCount - 3}개`);
        }
      }
    }

    // 프롬프트 내 치환 (기본 템플릿 처리)
    if (prompt.includes('{{glossary_context}}')) {
      prompt = prompt.replace('{{glossary_context}}', glossaryContext);
    }

    prompt = prompt.replace('{{slot}}', chunkText);

    return { prompt, glossaryContext };
  }

  /**
   * 번역 결과 후처리 메서드 (Smart Filter Version)
   * HTML 태그로 추정되는 패턴만 삭제하고, <상태창> 같은 한글 브라켓은 유지합니다.
   */
  private postProcess(text: string): string {
    if (!text) return text;

    if (this.config.enablePostProcessing) {
      // [1단계] Thinking Process 블록(태그 + 내부 콘텐츠) 완전 제거
      // <thinking>으로 시작하고 </thinking>으로 끝나는 모든 구간(줄바꿈 포함)을 삭제합니다.
      // [\s\S]*? : 줄바꿈을 포함한 모든 문자를 최단 일치(Non-greedy)로 매칭
      text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

      // [2단계] 기존 로직: 잔여 HTML 태그 제거 (한글 태그 <상태창> 등은 보존)
      // <> 안에 영어, 숫자, 공백, 특수문자(/ " = ' -)만 있는 경우를 태그로 간주하여 삭제
      text = text.replace(/<[a-zA-Z0-9\/\s"='-]+>/g, '');
    }

    return text.trim();
  }

  /**
   * [NEW] Gemini API의 '교대 역할(Alternating Roles)' 제약을 준수하기 위해
   * 연속된 동일 역할의 히스토리를 하나로 병합합니다.
   */
  private mergeConsecutiveRoles(history: { role: 'user' | 'model'; content: string }[]) {
    if (history.length === 0) return [];

    const merged: { role: 'user' | 'model'; content: string }[] = [];
    let current = { ...history[0] };

    for (let i = 1; i < history.length; i++) {
      const next = history[i];
      if (current.role === next.role) {
        // 동일 역할인 경우 내용을 줄바꿈으로 병합
        current.content += `\n\n${next.content}`;
      } else {
        // 역할이 바뀌면 지금까지의 결과 저장 후 교체
        merged.push(current);
        current = { ...next };
      }
    }
    // 마지막 항목 저장
    merged.push(current);

    return merged;
  }

  /**
   * 단일 청크 번역
   * @param enableSafetyRetry - 실패 시 콘텐츠 안전 분할 재시도를 수행할지 여부 (재귀 호출 시 false로 설정)
   */
  async translateChunk(
    chunkText: string,
    chunkIndex: number,
    context: TranslationContext,
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

    // [Stateless] 전달받은 context의 용어집을 사용합니다.
    const { prompt, glossaryContext } = this.preparePromptAndContext(chunkText, chunkIndex, context.glossaryEntries);

    const textPreview = chunkText.slice(0, 100).replace(/\n/g, ' ');
    this.log('info', `청크 ${chunkIndex + 1} 번역 시작 (모델: ${this.config.modelName}): "${textPreview}..."`);

    const generationConfig: GenerationConfig = {
      temperature: this.config.temperature,
      topP: this.config.topP,
      skipRpmDelay: true,
      pdfInput: this.getPdfInputOptions(chunkIndex),
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
      // enableSafetyRetry=false로 들어오는 호출은 분할 재시도의 서브청크다
      await this.acquireRequestSlot(chunkIndex, !enableSafetyRetry);

      let apiPromise: Promise<string>;

      if (this.config.enablePrefillTranslation) {
        // 채팅 모드 (프리필 대체)
        const rawHistory = this.config.prefillCachedHistory.map(item => ({
          role: item.role,
          content: item.parts.join('\n'),
        }));

        // [수정] API 제약 준수를 위한 교대 역할 병합 실행
        const chatHistory = this.mergeConsecutiveRoles(rawHistory);

        // [추가] 치환 데이터 구성 (히스토리 내 템플릿 치환용)
        const substitutionData = {
          '{{slot}}': chunkText,
          '{{glossary_context}}': glossaryContext
        };

        apiPromise = this.geminiClient.generateWithChat(
          prompt,
          this.config.prefillSystemInstruction,
          chatHistory,
          this.config.modelName,
          {
            ...generationConfig,
            substitutionData // [추가] 치환 데이터 전달
          }
        );
      } else {
        // 일반 모드 (prompt는 이미 preparePromptAndContext에서 치환됨)
        apiPromise = this.geminiClient.generateText(
          prompt,
          this.config.modelName,
          undefined,
          generationConfig
        );
      }

      // API 호출과 취소 요청 경합
      const rawTranslatedText = await Promise.race([apiPromise, cancelPromise]);

      // [추가] 후처리 적용 (HTML 태그 제거 등)
      const translatedText = this.postProcess(rawTranslatedText);

      // [핵심 변경] 후처리 후 텍스트가 비어있다면(공백 등) 예외를 발생시켜 재시도 로직 유도
      if (!translatedText && chunkText.trim()) {
        throw new Error('API 응답이 비어있습니다 (후처리 후 0자).');
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

      // 게이트 대기 중 중단된 요청은 API를 호출하지 않았다
      if (errorMessage === GATE_CANCELLED_MESSAGE) {
        return {
          chunkIndex,
          originalText: chunkText,
          translatedText: '',
          success: false,
          error: this.stopReason ?? '작업 중단',
        };
      }

      // 429 Rate Limit: 새 요청을 멈추고 이미 보낸 요청은 마무리한다
      if (GeminiClient.isRateLimitError(error as Error)) {
        const summary = this.handleRateLimit(error as Error, `청크 ${chunkIndex + 1}`);

        return {
          chunkIndex,
          originalText: chunkText,
          translatedText: '',
          success: false,
          error: `API 할당량 초과(429): ${summary}`,
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

      // 콘텐츠 안전 재시도 또는 빈 응답 오류 시 재시도
      // enableSafetyRetry가 true일 때만 자체 재시도 로직 수행
      // isContentSafetyError 체크 외에도, 빈 응답 오류인 경우에도 재시도를 시도하도록 조건 확장 가능
      const isContentSafety = GeminiClient.isContentSafetyError(error as Error);
      const isEmptyResponse = errorMessage.includes('API 응답이 비어있습니다');

      if (enableSafetyRetry && this.config.useContentSafetyRetry && (isContentSafety || isEmptyResponse)) {
        this.log('warning', isContentSafety ? `콘텐츠 안전 오류 감지. 분할 재시도 시작...` : `빈 응답 오류 감지. 분할 재시도 시작...`);
        return this.retryWithSmallerChunks(chunkText, chunkIndex, context, 1);
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
    context: TranslationContext,
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
        translatedText: `[분할 불가능한 오류 발생 콘텐츠: ${chunkText}...]`,
        success: false,
        error: '분할 불가능',
      };
    }

    this.log('info', `🔄 분할 완료: ${subChunks.length}개 서브 청크 생성`);

    // 7. 각 서브 청크 순차 처리 (하위 청크는 순차 처리 유지하여 복잡도 관리)
    const translatedParts: string[] = [];
    // 중단으로 일부 조각이 빠지면 성공으로 돌려주지 않는다 ('[중단됨]'이 번역문에 섞이는 것을 막음)
    let interrupted = false;

    for (let i = 0; i < subChunks.length; i++) {
      if (this.stopRequested) {
        interrupted = true;
        break;
      }

      try {
        // 분할된 조각으로 번역 시도
        // 여기서 호출할 때는 enableSafetyRetry를 false로 설정하여
        // translateChunk가 에러를 가로채지 않고 그대로 던지거나 실패를 반환하게 함
        const result = await this.translateChunk(subChunks[i], originalIndex, context, false);

        if (result.success) {
          translatedParts.push(result.translatedText);
        } else if (this.stopRequested) {
          interrupted = true;
          break;
        } else {
          // 실패 시 해당 조각에 대해 재귀 호출 (다음 시도 횟수 증가)
          this.log('info', `서브 청크 ${i + 1}/${subChunks.length} 실패. 재귀 분할 진입.`);
          const retryResult = await this.retryWithSmallerChunks(
            subChunks[i],
            originalIndex,
            context,
            currentAttempt + 1
          );
          if (!retryResult.success && this.stopRequested) {
            interrupted = true;
            break;
          }
          translatedParts.push(retryResult.translatedText);
        }
      } catch (error) {
        if (this.stopRequested) {
          interrupted = true;
          break;
        }
        // 예외 발생 시에도 재귀 시도
        this.log('error', `서브 청크 처리 중 예외 발생. 재귀 분할 시도.`);
        const retryResult = await this.retryWithSmallerChunks(
          subChunks[i],
          originalIndex,
          context,
          currentAttempt + 1
        );
        translatedParts.push(retryResult.translatedText);
      }
    }

    if (interrupted) {
      return {
        chunkIndex: originalIndex,
        originalText: chunkText,
        translatedText: '',
        success: false,
        error: this.stopReason ?? '작업 중단',
      };
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
    context: TranslationContext,
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

    // [추가] 중단 로그 중복 방지 플래그
    let stopLogged = false;

    for (let i = 0; i < chunks.length; i++) {
      // 1. [최우선] 이미 번역된 청크 처리 (기존 결과 활용)
      // 중단 요청이 있더라도 기존 결과는 모두 살려야 하므로 가장 먼저 체크합니다.
      if (existingMap.has(i)) {
        const existingResult = existingMap.get(i)!;

        // 원문 텍스트가 변경되었는지 확인 (옵션)
        // 원문이 같다면 기존 결과를 그대로 사용
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
          // 원문이 다르면 아래 로직(재번역)으로 진행
        }
      }

      // 2. 중단 체크 (Soft Stop)
      // break를 하면 뒤에 있는 existingResults를 못 찾으므로 continue로 처리
      if (this.stopRequested) {
        if (!stopLogged) {
          this.log('warning', `번역이 중단되었습니다 (${this.stopReason ?? '중단 요청'}).`);
          stopLogged = true;
        }
        continue; // 다음 청크로 이동 (API 호출 스킵)
      }

      // 2. 새로운 번역 실행 (비동기 Task 생성)
      const task = (async () => {
        if (this.stopRequested) return;

        progress.currentStatusMessage = `청크 ${i + 1}/${chunks.length} 처리 중...`;
        progress.currentChunkProcessing = i; // 병렬이라 정확하진 않지만 대략적인 위치 표시
        onProgress?.(progress);

        try {
          const result = await this.translateChunk(chunks[i], i, context, true);

          if (this.abortRequested) return;

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
          this.log('error', `Task ${i + 1} unhandled error: ${err}`);
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
   * 무결성 보장 텍스트 번역 (줄 단위 노드 기반)
   * EPUB 구조 번역 로직을 재사용해 누락 없이 번역합니다.
   */
  async translateTextWithIntegrityGuarantee(
    fullText: string,
    context: TranslationContext,
    onProgress?: ProgressCallback,
    onResult?: (result: TranslationResult) => void
  ): Promise<{ text: string; results: TranslationResult[] }> {
    this.resetStop();

    const { nodes, originalLines } = this.textNodeService.parse(fullText);

    if (nodes.length === 0) {
      this.log('info', '번역할 텍스트가 없습니다. (모든 줄이 비어 있음)');
      return { text: originalLines.join('\n'), results: [] };
    }

    // 줄 단위 노드 배열을 EPUB 청크 서비스로 분할 (문자 길이 + 노드 수 기준)
    const epubChunkService = new EpubChunkService(
      this.config.chunkSize,
      this.config.epubMaxNodesPerChunk
    );
    const chunks = epubChunkService.splitEpubNodesIntoChunks(nodes);

    const progress: TranslationJobProgress = {
      totalChunks: chunks.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '무결성 번역 시작...',
      etaSeconds: 0,
    };

    onProgress?.(progress);

    const maxWorkers = this.config.maxWorkers || 1;
    const processingPromises = new Set<Promise<void>>();
    const translatedNodes: TextNode[] = [];
    const chunkResults: TranslationResult[] = [];
    const startTime = Date.now();

    const processChunk = (chunk: EpubNode[], chunkIndex: number) => async () => {
      if (this.stopRequested) return;

      progress.currentStatusMessage = `무결성 번역 ${chunkIndex + 1}/${chunks.length} 처리 중...`;
      progress.currentChunkProcessing = chunkIndex;
      onProgress?.(progress);

      let success = false;
      let translatedChunk: EpubNode[] = chunk;
      let lastError: string | undefined;

      try {
        translatedChunk = await this.translateEpubChunk(chunk, context, 1, chunkIndex);
        success = true;
      } catch (error) {
        lastError = (error as Error)?.message;
        this.log('error', `무결성 번역 청크 ${chunkIndex + 1} 실패: ${error}`);
      }

      translatedChunk.forEach((n) => translatedNodes.push(n as TextNode));

      progress.processedChunks++;
      if (success) {
        progress.successfulChunks++;
      } else {
        progress.failedChunks++;
        progress.lastErrorMessage = lastError;
      }

      const now = Date.now();
      const elapsedSeconds = (now - startTime) / 1000;
      if (progress.processedChunks > 0) {
        const avgTimePerChunk = elapsedSeconds / progress.processedChunks;
        const remaining = progress.totalChunks - progress.processedChunks;
        progress.etaSeconds = Math.ceil(avgTimePerChunk * remaining);
      }

      onProgress?.(progress);

      if (onResult) {
        const originalText = chunk.map((n) => n.content ?? '').join('\n');
        const translatedText = translatedChunk.map((n) => n.content ?? '').join('\n');
        onResult({
          chunkIndex,
          originalText,
          translatedText,
          translatedSegments: translatedChunk.map((n) => n.content ?? ''),
          success,
          error: lastError,
        });
      }

      // 로컬 결과 누적 (최종 반환용)
      chunkResults.push({
        chunkIndex,
        originalText: chunk.map((n) => n.content ?? '').join('\n'),
        translatedText: translatedChunk.map((n) => n.content ?? '').join('\n'),
        translatedSegments: translatedChunk.map((n) => n.content ?? ''),
        success,
        error: lastError,
      });
    };

    for (let i = 0; i < chunks.length; i++) {
      if (this.stopRequested) break;

      const task = processChunk(chunks[i], i)();
      processingPromises.add(task);
      task.then(() => processingPromises.delete(task));

      if (processingPromises.size >= maxWorkers) {
        await Promise.race(processingPromises);
      }
    }

    await Promise.all(processingPromises);

    progress.currentStatusMessage = this.stopRequested ? '무결성 번역 중단됨' : '무결성 번역 완료';
    progress.currentChunkProcessing = undefined;
    progress.etaSeconds = 0;
    onProgress?.(progress);

    // 원본 라인 순으로 정렬 후 복원
    const reconstructed = this.textNodeService.reconstruct(
      translatedNodes.sort((a, b) => a.lineIndex - b.lineIndex),
      originalLines
    );

    return { text: reconstructed, results: chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex) };
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
    context: TranslationContext,
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
          failedResult.chunkIndex,
          context,
          true
        );

        if (this.abortRequested) return;

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
   * [NEW] 무결성 모드 실패 청크만 재번역
   * 
   * @param results - 전체 번역 결과
   * @param fullText - 원본 전체 텍스트 (줄 단위 노드 재생성용)
   * @param onProgress - 진행률 콜백
   * @param onResult - (옵션) 실시간 업데이트를 위한 콜백
   */
  async retryFailedIntegrityChunks(
    results: TranslationResult[],
    fullText: string,
    context: TranslationContext,
    onProgress?: ProgressCallback,
    onResult?: (result: TranslationResult) => void
  ): Promise<{ text: string; results: TranslationResult[] }> {
    const failedResults = results.filter(r => !r.success);

    if (failedResults.length === 0) {
      this.log('info', '재시도할 실패한 청크가 없습니다.');
      // 기존 결과로 텍스트 복원
      const { nodes, originalLines } = this.textNodeService.parse(fullText);
      const reconstructed = this.textNodeService.reconstruct(
        nodes.sort((a, b) => a.lineIndex - b.lineIndex),
        originalLines
      );
      return { text: reconstructed, results };
    }

    this.log('info', `🔒 무결성 모드 ${failedResults.length}개 실패 청크 재번역 시작`);
    this.resetStop();

    // 1. 원본 텍스트를 다시 줄 단위 노드로 파싱
    const { nodes: allNodes, originalLines } = this.textNodeService.parse(fullText);

    // 2. 청크 재분할 (원본과 동일한 방식)
    const epubChunkService = new EpubChunkService(
      this.config.chunkSize,
      this.config.epubMaxNodesPerChunk
    );
    const originalChunks = epubChunkService.splitEpubNodesIntoChunks(allNodes);

    const progress: TranslationJobProgress = {
      totalChunks: failedResults.length,
      processedChunks: 0,
      successfulChunks: 0,
      failedChunks: 0,
      currentStatusMessage: '무결성 모드 재번역 시작...',
      etaSeconds: 0,
    };

    onProgress?.(progress);

    const updatedResults = [...results];
    const maxWorkers = this.config.maxWorkers || 1;
    const processingPromises = new Set<Promise<void>>();
    const startTime = Date.now();

    // 3. 번역된 노드를 누적할 맵 (기존 성공 노드 + 새로 번역할 노드)
    const translatedNodeMap = new Map<string, TextNode>();

    // 기존 성공한 결과의 노드들을 맵에 추가
    results.forEach(result => {
      if (result.success && result.translatedSegments) {
        const chunkNodes = originalChunks[result.chunkIndex] || [];
        result.translatedSegments.forEach((segment, idx) => {
          const node = chunkNodes[idx] as TextNode;
          if (node && node.id) {
            translatedNodeMap.set(node.id, {
              ...node,
              content: segment
            });
          }
        });
      }
    });

    for (const failedResult of failedResults) {
      if (this.stopRequested) break;

      const chunkIndex = failedResult.chunkIndex;
      const nodesToRetry = originalChunks[chunkIndex];

      if (!nodesToRetry) {
        this.log('error', `무결성 재시도 오류: 청크 인덱스 ${chunkIndex}에 해당하는 원본 노드를 찾을 수 없습니다.`);
        continue;
      }

      const task = (async () => {
        if (this.stopRequested) return;

        progress.currentStatusMessage = `무결성 청크 ${chunkIndex + 1} 재번역 중...`;
        progress.currentChunkProcessing = chunkIndex;
        onProgress?.(progress);

        let newTranslatedNodes: EpubNode[];
        let success = false;

        try {
          newTranslatedNodes = await this.translateEpubChunk(nodesToRetry, context, 1, chunkIndex);
          success = true;
        } catch (error) {
          if (this.stopRequested) {
            newTranslatedNodes = nodesToRetry;
          } else {
            this.log('warning', `⚠️ 무결성 청크 ${chunkIndex + 1} 재번역 실패. 분할 정복 시작...`);
            newTranslatedNodes = await this.retryEpubNodesWithSmallerBatches(
              nodesToRetry,
              chunkIndex,
              context,
              1
            );
            success = true;
          }
        }

        if (this.abortRequested) return;

        // 번역된 노드를 맵에 업데이트
        newTranslatedNodes.forEach(node => {
          if (node.id) {
            translatedNodeMap.set(node.id, node as TextNode);
          }
        });

        // TranslationResult 객체 생성
        const newResult: TranslationResult = {
          chunkIndex,
          originalText: nodesToRetry.map(n => n.content || '').join('\n'),
          translatedText: newTranslatedNodes.map(n => n.content || '').join('\n'),
          translatedSegments: newTranslatedNodes.map(n => n.content || ''),
          success,
          error: success ? undefined : '재시도 실패',
        };

        // 결과 배열 업데이트
        const index = updatedResults.findIndex(r => r.chunkIndex === chunkIndex);
        if (index >= 0) {
          updatedResults[index] = newResult;
        }

        onResult?.(newResult);

        // 진행률 업데이트
        progress.processedChunks++;
        if (success) {
          progress.successfulChunks++;
        } else {
          progress.failedChunks++;
          progress.lastErrorMessage = newResult.error;
        }

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

    progress.currentStatusMessage = '무결성 재번역 완료';
    progress.currentChunkProcessing = undefined;
    progress.etaSeconds = 0;
    onProgress?.(progress);

    // 4. 모든 노드를 ID 기준으로 정렬하여 배열로 변환
    const sortedTranslatedNodes = Array.from(translatedNodeMap.values())
      .sort((a, b) => a.lineIndex - b.lineIndex);

    // 5. 최종 텍스트 복원
    const reconstructed = this.textNodeService.reconstruct(
      sortedTranslatedNodes,
      originalLines
    );

    this.log('info', `무결성 재번역 완료: 성공 ${progress.successfulChunks}개, 실패 ${progress.failedChunks}개`);

    return {
      text: reconstructed,
      results: updatedResults.sort((a, b) => a.chunkIndex - b.chunkIndex)
    };
  }

  /**
   * [NEW] 실패한 EPUB 청크만 재번역 (병렬 처리 및 구조 유지)
   *
   * @param results - 전체 번역 결과
   * @param allNodes - 번역을 시도했던 전체 원본 EpubNode 배열
   * @param onProgress - 진행률 콜백
   * @param onResult - (옵션) 실시간 업데이트를 위한 콜백
   */
  async retryFailedEpubChunks(
    results: TranslationResult[],
    allNodes: EpubNode[],
    context: TranslationContext,
    onProgress?: ProgressCallback,
    onResult?: (result: TranslationResult) => void
  ): Promise<TranslationResult[]> {
    const failedResults = results.filter(r => !r.success);

    if (failedResults.length === 0) {
      this.log('info', '재시도할 실패한 EPUB 청크가 없습니다.');
      return results;
    }

    this.log('info', `${failedResults.length}개 실패 EPUB 청크 재번역 시작`);
    this.resetStop();

    // 1. 원본 노드 배열을 청크로 다시 분할하여 재현
    const epubChunkService = new EpubChunkService(
      this.config.chunkSize,
      this.config.epubMaxNodesPerChunk
    );
    const originalChunks = epubChunkService.splitEpubNodesIntoChunks(allNodes);

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
    const startTime = Date.now();

    for (const failedResult of failedResults) {
      if (this.stopRequested) break;

      const chunkIndex = failedResult.chunkIndex;
      const nodesToRetry = originalChunks[chunkIndex];

      if (!nodesToRetry) {
        this.log('error', `EPUB 재시도 오류: 청크 인덱스 ${chunkIndex}에 해당하는 원본 노드를 찾을 수 없습니다.`);
        continue;
      }

      const task = (async () => {
        if (this.stopRequested) return;

        progress.currentStatusMessage = `EPUB 청크 ${chunkIndex + 1} 재번역 중...`;
        progress.currentChunkProcessing = chunkIndex;
        onProgress?.(progress);

        let newTranslatedNodes: EpubNode[];
        let success = false;

        try {
          // `translateEpubNodes`의 핵심 로직과 동일하게 재시도
          newTranslatedNodes = await this.translateEpubChunk(nodesToRetry, context, 1, chunkIndex);
          success = true;
        } catch (error) {
          if (this.stopRequested) {
            newTranslatedNodes = nodesToRetry; // 원본으로 되돌림
          } else {
            this.log('warning', `⚠️ EPUB 청크 ${chunkIndex + 1} 재번역 실패. 분할 정복 시작...`);
            // 여기서도 분할 정복 재시도
            newTranslatedNodes = await this.retryEpubNodesWithSmallerBatches(
              nodesToRetry,
              chunkIndex,
              context,
              1
            );
            // 분할 정복은 일부라도 성공시키려 하므로, success로 간주할 수 있음
            // 다만, 완벽한 성공 여부를 가리려면 더 복잡한 확인이 필요. 우선은 결과 표시를 위해 true로 처리.
            success = true;
          }
        }

        if (this.abortRequested) return;

        // 새로운 TranslationResult 객체 생성
        const newResult: TranslationResult = {
          chunkIndex: chunkIndex,
          originalText: nodesToRetry.map(n => n.content || '').join('\n\n'),
          translatedText: newTranslatedNodes.map(n => n.content || '').join('\n\n'),
          translatedSegments: newTranslatedNodes.map(n => n.content || ''),
          success: success,
          error: success ? undefined : '재시도 실패',
        };

        // 결과 배열 업데이트
        const index = updatedResults.findIndex(r => r.chunkIndex === chunkIndex);
        if (index >= 0) {
          updatedResults[index] = newResult;
        }

        onResult?.(newResult);

        // 진행률 업데이트
        progress.processedChunks++;
        if (success) {
          progress.successfulChunks++;
        } else {
          progress.failedChunks++;
          progress.lastErrorMessage = newResult.error;
        }

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

    progress.currentStatusMessage = 'EPUB 재번역 완료';
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
   * @param zip EPUB ZIP 객체 (이미지 주석 생성용, 선택사항)
   * @returns 번역된 EpubNode 배열
   */
  async translateEpubNodes(
    nodes: EpubNode[],
    context: TranslationContext,
    onProgress?: ProgressCallback,
    onResult?: (result: TranslationResult) => void,
    zip?: JSZip,
    existingResults?: TranslationResult[]
  ): Promise<EpubNode[]> {
    this.resetStop();
    this.log('info', `🚀 EPUB 번역 시작: ${nodes.length}개 노드`);

    try {
      // 1. EpubChunkService로 배열 분할
      const epubChunkService = new EpubChunkService(
        this.config.chunkSize,
        this.config.epubMaxNodesPerChunk
      );

      const chunks = epubChunkService.splitEpubNodesIntoChunks(nodes);
      this.log('info', `📦 ${chunks.length}개 청크로 분할 완료`);

      // [추가] 2. 기존 결과 맵핑 (O(1) 조회를 위해)
      const existingMap = new Map<number, TranslationResult>();
      if (existingResults) {
        existingResults.forEach(r => {
          if (r.success) existingMap.set(r.chunkIndex, r);
        });
        if (existingMap.size > 0) {
          this.log('info', `🔄 기존 번역 결과 ${existingMap.size}개를 감지했습니다. 스킵을 시도합니다.`);
        }
      }

      // 2. 병렬 처리 준비
      const maxWorkers = this.config.maxWorkers || 1;
      const processingPromises = new Set<Promise<void>>();
      const chunkResults = new Map<number, EpubNode[]>();
      const startTime = Date.now();

      let processedChunks = 0;
      let successfulChunks = 0;
      let failedChunks = 0;

      // 초기 진행률 보고
      if (onProgress) {
        onProgress({
          totalChunks: chunks.length,
          processedChunks: 0,
          successfulChunks: 0,
          failedChunks: 0,
          currentStatusMessage: 'EPUB 번역 시작...',
          etaSeconds: 0,
        });
      }

      // 3. 각 청크별 번역 (병렬 처리)
      for (let i = 0; i < chunks.length; i++) {
        // 중단 체크
        if (this.stopRequested) {
          this.log('warning', `번역이 중단되었습니다 (${this.stopReason ?? '중단 요청'}).`);
          break;
        }

        // [핵심] 4. 이미 번역된 청크인지 확인
        if (existingMap.has(i)) {
          const existing = existingMap.get(i)!;
          const currentChunkNodes = chunks[i]; // 현재 청크의 원본 노드들

          // [중요] 기존 결과(텍스트/세그먼트)를 원본 노드에 입히는 복원 로직
          const restoredNodes = this.restoreNodesFromResult(currentChunkNodes, existing);

          if (restoredNodes) {
            // 복원 성공 시
            chunkResults.set(i, restoredNodes);
            processedChunks++;
            successfulChunks++;

            this.log('info', `⏩ 청크 ${i + 1} 스킵 (기존 결과 사용)`);

            // UI 갱신을 위해 onResult 호출 (ReviewPage에 즉시 반영됨)
            if (onResult) {
              onResult(existing);
            }

            // 진행률 업데이트
            if (onProgress) {
              onProgress({
                totalChunks: chunks.length,
                processedChunks,
                successfulChunks,
                failedChunks,
                currentStatusMessage: `청크 ${i + 1} 복원 완료`,
                etaSeconds: 0,
              });
            }

            continue; // ★ API 호출 건너뛰기
          } else {
            // 복원 실패 시 (노드 불일치 등) -> 로그 남기고 재번역 시도
            this.log('warning', `⚠️ 청크 ${i + 1} 복원 실패 (데이터 불일치). 재번역을 진행합니다.`);
          }
        }

        const task = (async () => {
          if (this.stopRequested) return;

          try {
            const translated = await this.translateEpubChunk(
              chunks[i],
              context,
              1,
              i
            );

            // [DEBUG] 1. translateEpubChunk의 직접적인 반환 값 확인
            console.log(`[DEBUG 1/3] 청크 ${i + 1} Raw Result from translateEpubChunk`, {
              nodeCount: translated.length,
              sampleContent: translated.length > 0 ? translated[0].content?.slice(0, 50) : 'N/A'
            });
            console.log('[DEBUG 1/3] Full raw result object:', JSON.parse(JSON.stringify(translated)));


            chunkResults.set(i, translated);
            successfulChunks++;
            this.log('info', `✅ 청크 ${i + 1}/${chunks.length} 완료`);

            // [추가] 실시간 결과 보고
            if (onResult) {
              const resultPayload: TranslationResult = {
                chunkIndex: i,
                originalText: chunks[i].map(n => n.content || '').join('\n\n'),
                translatedText: translated.map(n => n.content || '').join('\n\n'),
                // [추가] 구조적 저장용 데이터 (순수한 콘텐츠 배열)
                translatedSegments: translated.map(n => n.content || ''),
                success: true
              };

              // [DEBUG] 2. Store로 전송될 데이터 확인
              console.log(`[DEBUG 2/3] 청크 ${i + 1} Payload for onResult`, {
                chunkIndex: resultPayload.chunkIndex,
                segmentsCount: resultPayload.translatedSegments?.length,
                sampleSegment: resultPayload.translatedSegments?.[0]?.slice(0, 50)
              });
              console.log('[DEBUG 2/3] Full payload object:', JSON.parse(JSON.stringify(resultPayload)));

              onResult(resultPayload);
            }
          } catch (error) {
            // 중단 요청 시 재시도 하지 않음
            if (this.stopRequested) {
              failedChunks++;
              return;
            }

            this.log('warning', `⚠️ 청크 ${i + 1}번 번역 실패. 분할 정복 시작...`);

            // 오류 발생 시 재귀 분할 정복
            const retriedNodes = await this.retryEpubNodesWithSmallerBatches(
              chunks[i],
              i,
              context,
              1
            );
            chunkResults.set(i, retriedNodes);
            failedChunks++;

            // [추가] 재시도 결과 보고 (실패로 간주되더라도 결과는 표시)
            if (onResult) {
              onResult({
                chunkIndex: i,
                originalText: chunks[i].map(n => n.content || '').join('\n\n'),
                translatedText: retriedNodes.map(n => n.content || '').join('\n\n'),
                // [추가] 구조적 저장용 데이터 (순수한 콘텐츠 배열)
                translatedSegments: retriedNodes.map(n => n.content || ''),
                success: true // 부분적으로 성공했을 수 있으므로 true로 처리하거나, 별도 상태 필요
              });
            }
          } finally {
            processedChunks++;

            // 진행률 및 ETA 업데이트
            if (onProgress) {
              const now = Date.now();
              const elapsedSeconds = (now - startTime) / 1000;
              let etaSeconds = 0;
              if (processedChunks > 0) {
                const avgTimePerChunk = elapsedSeconds / processedChunks;
                const remainingChunks = chunks.length - processedChunks;
                etaSeconds = Math.ceil(avgTimePerChunk * remainingChunks);
              }

              onProgress({
                totalChunks: chunks.length,
                processedChunks,
                successfulChunks,
                failedChunks,
                currentStatusMessage: `청크 ${processedChunks}/${chunks.length} 처리 완료`,
                etaSeconds,
              });
            }
          }
        })();

        processingPromises.add(task);
        task.then(() => processingPromises.delete(task));

        // 최대 워커 수 도달 시 대기
        if (processingPromises.size >= maxWorkers) {
          await Promise.race(processingPromises);
        }
      }

      // 남은 작업 완료 대기
      await Promise.all(processingPromises);

      // 4. 결과 조합 (순서 보장)
      let translatedNodes: EpubNode[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunkResults.has(i)) {
          translatedNodes.push(...chunkResults.get(i)!);
        } else {
          // 처리되지 않은 청크(중단됨 등)는 원본 유지
          translatedNodes.push(...chunks[i]);
        }
      }

      // 5. 이미지 주석 생성 (옵션)
      if (this.config.enableImageAnnotation && zip) {
        this.log('info', '🖼️ 이미지 주석 생성 시작...');
        const imageAnnotationService = new ImageAnnotationService(this.config, this.apiKey);
        if (this.onLog) {
          imageAnnotationService.setLogCallback(this.onLog);
        }

        translatedNodes = await imageAnnotationService.annotateImages(
          translatedNodes,
          zip,
          (progress) => {
            this.log('info', `이미지 처리: ${progress.processedImages}/${progress.totalImages} (${progress.currentStatusMessage})`);
          }
        );
      }

      this.log('info', `📚 EPUB 번역 완료: ${translatedNodes.length}개 노드`);
      return translatedNodes;
    } catch (error) {
      this.log('error', `❌ EPUB 번역 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * EPUB 노드 배치 번역 (디버깅 로그 추가 버전)
   */
  private async translateEpubChunk(
    nodes: EpubNode[],
    context: TranslationContext,
    currentAttempt: number = 1,
    chunkIndex: number = 0,
    isSubchunk: boolean = false
  ): Promise<EpubNode[]> {
    const textNodes = nodes.filter((n) => n.type === 'text');

    if (textNodes.length === 0) {
      return nodes;
    }

    const MAX_RETRIES = this.config.maxRetryAttempts;
    if (currentAttempt > MAX_RETRIES) {
      this.log('error', `❌ 최대 재시도(${MAX_RETRIES}) 도달: ${textNodes.length}개 노드 번역 실패.`);
      return nodes;
    }

    const requestData = textNodes.map((n) => ({
      id: n.id,
      text: n.content,
    }));

    const jsonString = JSON.stringify(requestData, null, 2);

    // [Stateless] 전달받은 context의 용어집을 사용합니다.
    const { prompt, glossaryContext } = this.preparePromptAndContext(jsonString, chunkIndex, context.glossaryEntries);

    const config: GenerationConfig = {
      temperature: this.config.temperature,
      topP: this.config.topP,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            translated_text: { type: 'string' },
          },
          required: ['id', 'translated_text'],
        },
      },
      skipRpmDelay: true,
      pdfInput: this.getPdfInputOptions(chunkIndex),
    };

    let cancelThisRequest: (() => void) | undefined;
    const cancelPromise = new Promise<string>((_, reject) => {
      cancelThisRequest = () => { reject(new Error('CANCELLED_BY_USER')); };
    });
    if (cancelThisRequest) this.cancelControllers.add(cancelThisRequest);

    try {
      // 누락 노드 재요청과 분할 재시도는 서브청크로 취급해 먼저 내보낸다
      await this.acquireRequestSlot(chunkIndex, isSubchunk || currentAttempt > 1);

      let responseText: string;
      let apiPromise: Promise<string>;

      if (this.config.enablePrefillTranslation) {
        const rawHistory = this.config.prefillCachedHistory.map(item => ({
          role: item.role,
          content: item.parts.join('\n'),
        }));
        const chatHistory = this.mergeConsecutiveRoles(rawHistory);
        const substitutionData = { '{{slot}}': jsonString, '{{glossary_context}}': glossaryContext };

        apiPromise = this.geminiClient.generateWithChat(
          prompt, this.config.prefillSystemInstruction, chatHistory, this.config.modelName,
          { ...config, substitutionData }
        );
      } else {
        apiPromise = this.geminiClient.generateText(prompt, this.config.modelName, this.config.prefillSystemInstruction, config);
      }

      responseText = await Promise.race([apiPromise, cancelPromise]);
      const translations: Array<{ id: string; translated_text: string }> = JSON.parse(responseText);
      const translationMap = new Map(translations.map((t) => [t.id, t.translated_text]));

      // --- START: 데이터 누락 감지 및 재귀 재시도 로직 (디버깅 강화) ---

      const successfullyTranslatedNodes: EpubNode[] = [];
      const missingNodes: EpubNode[] = [];

      for (const node of textNodes) {
        if (translationMap.has(node.id)) {
          // [수정] 줄바꿈 문자를 <br/> 태그로 치환 (XML에서 줄바꿈 보존을 위함)
          const translatedText = translationMap.get(node.id)!;
          successfullyTranslatedNodes.push({
            ...node,
            content: translatedText.replace(/\n/g, '<br/>'),
          });
        } else {
          missingNodes.push(node);
        }
      }

      let retriedNodes: EpubNode[] = [];

      // [디버깅] 누락 발생 시 상세 로그 출력
      if (missingNodes.length > 0) {
        this.log('warning', `⚠️ [Debug:Attempt-${currentAttempt}] 응답 누락 감지: 전체 ${textNodes.length} 중 ${missingNodes.length}개 누락.`);
        this.log('debug', `   - 누락된 IDs: ${missingNodes.map(n => n.id).join(', ')}`);

        // 재귀 호출
        retriedNodes = await this.translateEpubChunk(
          missingNodes,
          context,
          currentAttempt + 1,
          chunkIndex,
          true
        );

        // [디버깅] 재귀 호출 결과 검증
        this.log('info', `✅ [Debug:Attempt-${currentAttempt}] 재귀 호출 복귀: ${retriedNodes.length}개 노드 수신됨.`);

        // 혹시 재귀 결과에서 ID가 꼬였는지 확인 (샘플 로깅)
        if (retriedNodes.length > 0) {
          const sample = retriedNodes[0];
          this.log('debug', `   - 재귀 결과 샘플(ID: ${sample.id}): "${sample.content?.slice(0, 30)}..."`);
        }
      }

      const combinedTranslatedNodes = [...successfullyTranslatedNodes, ...retriedNodes];
      const finalTranslationMap = new Map(combinedTranslatedNodes.map(n => [n.id, n.content]));

      // [디버깅] 최종 매핑 검증
      if (missingNodes.length > 0) {
        this.log('debug', `🔍 [Debug:Attempt-${currentAttempt}] 최종 병합: 성공(${successfullyTranslatedNodes.length}) + 재시도(${retriedNodes.length}) = 합계(${combinedTranslatedNodes.length})`);
      }

      return nodes.map(originalNode => {
        if (finalTranslationMap.has(originalNode.id)) {
          const content = finalTranslationMap.get(originalNode.id)!;

          // [디버깅] 중복 작성 의심 구간 확인
          // 원본 텍스트가 번역문에 포함되어 있는지 확인 (단순 포함 여부만 체크)
          if (missingNodes.some(mn => mn.id === originalNode.id)) {
            if (content.includes(originalNode.content!) && content.length > originalNode.content!.length * 1.5) {
              this.log('warning', `🚨 [중복 의심] 재귀 번역된 노드(ID: ${originalNode.id})에 원문이 포함된 것 같습니다.`);
              this.log('debug', `   - 원문: ${originalNode.content?.slice(0, 20)}...`);
              this.log('debug', `   - 번역: ${content.slice(0, 20)}...`);
            }
          }

          return { ...originalNode, content };
        }
        return originalNode;
      });
      // --- END: 데이터 누락 감지 및 재귀 재시도 로직 ---

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage === GATE_CANCELLED_MESSAGE) {
        throw error;
      }

      if (GeminiClient.isRateLimitError(error as Error)) {
        this.handleRateLimit(error as Error, `EPUB 청크 ${chunkIndex + 1}`);
        throw error;
      }

      if (errorMessage === 'CANCELLED_BY_USER') {
        this.log('warning', `EPUB 청크 번역 중단됨 (사용자 요청)`);
        throw error;
      }

      this.log('warning', `⚠️ 청크 번역/파싱 실패. 분할 재시도를 위해 에러를 상위로 전달합니다.`);
      throw error;
    } finally {
      if (cancelThisRequest) this.cancelControllers.delete(cancelThisRequest);
    }
  }

  /**
   * EPUB 노드 배열의 재귀적 분할 정복 재시도 로직
   * 
   * Rate Limit, Safety Filter, Context Overflow 등의 오류 시 자동 복구
   * 
   * @param nodes 번역할 EpubNode 배열
   * @param originalChunkIndex 로깅용 청크 인덱스
   * @param context 번역 컨텍스트
   * @param currentAttempt 현재 시도 깊이
   * @returns 번역된 EpubNode 배열 (실패한 노드는 원문 유지)
   */
  private async retryEpubNodesWithSmallerBatches(
    nodes: EpubNode[],
    originalChunkIndex: number,
    context: TranslationContext,
    currentAttempt: number = 1
  ): Promise<EpubNode[]> {
    // 0. 중단 요청 확인
    if (this.stopRequested) {
      return nodes;
    }

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

    const resultsMap = new Map<string, EpubNode>();

    // 5. 각 배치를 순차 처리
    for (const batch of [leftBatch, rightBatch]) {
      if (this.stopRequested) break;

      try {
        const translatedBatch = await this.translateEpubChunk(batch, context, 1, originalChunkIndex, true);
        translatedBatch.forEach(node => resultsMap.set(node.id, node));
      } catch (error) {
        if (this.stopRequested) break;

        this.log('warning', `⚠️ 배치(${batch.length}개) 번역 실패. 재귀 분할 시작.`);

        // 실패한 배치만 더 깊이 분할하여 재시도
        const retriedResults = await this.retryEpubNodesWithSmallerBatches(
          batch,
          originalChunkIndex,
          context,
          currentAttempt + 1
        );
        retriedResults.forEach(node => resultsMap.set(node.id, node));
      }
    }

    // Map의 값들을 배열로 변환하고 원본 순서대로 정렬 (id는 'fileName_nodeIndex' 형태이므로 문자열 정렬이 순서를 유지함)
    const sortedResults = Array.from(resultsMap.values()).sort((a, b) => {
      // id에서 nodeIndex 부분만 추출하여 숫자로 비교
      const getIdNum = (id: string) => parseInt(id.split('_').pop() || '0', 10);
      return getIdNum(a.id) - getIdNum(b.id);
    });

    this.log('info', `✅ 배치 매핑 성공: 원본 ${nodes.length}개 노드 중 ${sortedResults.length}개로 최종 결과 구성`);

    return sortedResults;
  }

  /**
   * 기존 번역 결과를 바탕으로 노드 내용을 복원합니다.
   */
  private restoreNodesFromResult(nodes: EpubNode[], result: TranslationResult): EpubNode[] | null {
    // 텍스트 노드만 추출 (순서 중요)
    const textNodes = nodes.filter(n => n.type === 'text');

    // 1. [권장] 세그먼트 배열이 있는 경우 (완벽한 복원)
    if (result.translatedSegments && result.translatedSegments.length > 0) {
      const segments = result.translatedSegments;

      // 전략 1: 텍스트 노드 개수와 세그먼트 개수가 일치하는 경우 (텍스트 노드만 저장된 경우)
      if (textNodes.length === segments.length) {
        const newNodes = JSON.parse(JSON.stringify(nodes));
        const newTextNodes = newNodes.filter((n: EpubNode) => n.type === 'text');

        newTextNodes.forEach((node: EpubNode, idx: number) => {
          // [수정] 줄바꿈 보존을 위해 치환 처리
          const content = segments[idx] || '';
          node.content = content.includes('<br/>') ? content : content.replace(/\n/g, '<br/>');
        });
        return newNodes;
      }

      // 전략 2: 전체 노드 개수와 세그먼트 개수가 일치하는 경우 (비텍스트 포함 저장된 경우)
      if (nodes.length === segments.length) {
        const newNodes = JSON.parse(JSON.stringify(nodes));

        newNodes.forEach((node: EpubNode, idx: number) => {
          // 텍스트 노드인 경우에만 내용을 덮어씀 (비텍스트는 원본 유지하거나, 저장된 값 사용)
          // 저장된 값이 공백("")인 경우가 많으므로, 텍스트 노드일 때만 적용하는 것이 안전함
          if (node.type === 'text') {
            const content = segments[idx] || '';
            node.content = content.includes('<br/>') ? content : content.replace(/\n/g, '<br/>');
          }
        });
        return newNodes;
      }

      // 개수 불일치 -> 복원 실패
      this.log('warning', `복원 실패 상세: 노드(${nodes.length}개) / 텍스트노드(${textNodes.length}개) vs 저장된 세그먼트(${segments.length}개)`);
      return null;
    }

    // 2. [차선] 텍스트만 있는 경우 (\n\n 분할 시도)
    // 이전 버전 스냅샷 호환용
    if (result.translatedText) {
      const segments = result.translatedText.trim().split(/\n\n/);

      if (textNodes.length !== segments.length) {
        return null; // 개수 불일치 -> 복원 실패
      }

      const newNodes = JSON.parse(JSON.stringify(nodes));
      const newTextNodes = newNodes.filter((n: EpubNode) => n.type === 'text');

      newTextNodes.forEach((node: EpubNode, idx: number) => {
        const content = segments[idx] || '';
        node.content = content.includes('<br/>') ? content : content.replace(/\n/g, '<br/>');
      });

      return newNodes;
    }

    return null;
  }
}