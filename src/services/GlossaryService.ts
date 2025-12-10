
// services/GlossaryService.ts
// Python domain/glossary_service.py 의 TypeScript 변환
// 텍스트에서 용어집 항목을 AI로 추출하고 관리하는 서비스

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GeminiClient, GeminiApiException } from './GeminiClient';
import { ChunkService } from './ChunkService';
import type { GlossaryEntry, GlossaryExtractionProgress, LogEntry } from '../types/dtos';
import type { AppConfig } from '../types/config';
import type { EpubNode } from '../types/epub';

/**
 * 로그 콜백 타입
 */
export type GlossaryLogCallback = (entry: LogEntry) => void;

/**
 * 진행률 콜백 타입
 */
export type GlossaryProgressCallback = (progress: GlossaryExtractionProgress) => void;

/**
 * 중지 체크 함수 타입
 */
export type StopCheckCallback = () => boolean;

/**
 * Zod를 사용한 용어집 스키마 정의
 * 문서에 나온대로 describe를 상세히 적어주면 AI 인식률이 높아집니다.
 */
const glossaryItemSchema = z.object({
  keyword: z.string().describe("The original term exactly as it appears in the text."),
  translated_keyword: z.string().describe("The translated term in the target language (Korean). Follow the Sino-Korean reading rules unless it is a foreign transliteration."),
  target_language: z.string().describe("BCP-47 language code (e.g., 'ko')."),
  occurrence_count: z.number().int().describe("Estimated number of times this term appears in the segment.")
});

// 배열 형태의 응답을 받기 위한 래퍼 스키마
const glossaryResponseSchema = z.object({
  terms: z.array(glossaryItemSchema).describe("List of extracted glossary terms.")
});

/**
 * 용어집 서비스 클래스
 * 
 * 텍스트에서 AI를 활용하여 용어집 항목을 추출하고 관리합니다.
 */
export class GlossaryService {
  private geminiClient: GeminiClient;
  private chunkService: ChunkService;
  private config: AppConfig;
  private stopRequested: boolean = false;
  private onLog?: GlossaryLogCallback;

  constructor(config: AppConfig, apiKey?: string) {
    this.config = config;
    this.geminiClient = new GeminiClient(apiKey, config.requestsPerMinute);
    this.chunkService = new ChunkService(config.glossaryChunkSize || config.chunkSize);
  }

  /**
   * 로그 콜백 설정
   */
  setLogCallback(callback: GlossaryLogCallback): void {
    this.onLog = callback;
  }

  /**
   * 로그 출력
   */
  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { level, message, timestamp: new Date() };
    console.log(`[GlossaryService][${level.toUpperCase()}] ${message}`);
    this.onLog?.(entry);
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
   * 중단 요청
   */
  requestStop(): void {
    this.stopRequested = true;
    this.log('warning', '용어집 추출 중단이 요청되었습니다.');
  }

  /**
   * 중단 상태 리셋
   */
  resetStop(): void {
    this.stopRequested = false;
  }

  /**
   * 용어집 추출 프롬프트 생성 (Structured Output 용)
   * JSON 형식을 요청하는 문구를 제거하고, 언어적 규칙에 집중합니다.
   */
  private getExtractionPrompt(
    segmentText: string,
    userOverridePrompt?: string
  ): string {
    // 사용자가 프롬프트를 오버라이드 했으면 그것을 우선 사용하되, 
    // 스키마가 강제되므로 출력 형식을 설명하는 부분은 제거해도 됩니다.
    if (userOverridePrompt?.trim()) {
      return `${userOverridePrompt}\n\nText to analyze:\n${segmentText}`;
    }

    const targetLangCode = this.config.novelLanguage || 'ko';
    const targetLangName = this.getLanguageName(targetLangCode);

    return `
Analyze the following text to extract specific proper nouns for a glossary.

**Target Scope:**
- **People (Characters)**: Names of protagonists, antagonists, side characters.
- **Proper Nouns**: Unique items, artifacts, skill names, martial arts titles.
- **Place Names**: Cities, sects, mountains, specific buildings.
- **Organizations**: Sects, guilds, schools, companies.

**Translation Rules for ${targetLangName} (${targetLangCode}):**
1. **Sino-Korean Reading (Rule 1)**: For traditional Chinese names/nouns, use the Korean Hanja reading (e.g., 北京 -> 북경).
2. **Foreign Transliteration (Rule 2 - Exception)**: If the term is a transliteration of a non-Chinese name (e.g., English, Japanese), represent the sound (e.g., 宝马 -> BMW, not 보마).

Text to analyze:
\`\`\`
${segmentText}
\`\`\`
`.trim();
  }

  /**
   * 언어 코드를 이름으로 변환
   */
  private getLanguageName(code: string): string {
    const languageNames: Record<string, string> = {
      'ko': 'Korean',
      'en': 'English',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'zh-CN': 'Simplified Chinese',
      'zh-TW': 'Traditional Chinese',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ru': 'Russian',
      'pt': 'Portuguese',
      'it': 'Italian',
      'vi': 'Vietnamese',
      'th': 'Thai',
      'id': 'Indonesian',
    };
    return languageNames[code] || code;
  }

  /**
   * 단일 세그먼트에서 용어집 추출 (Structured Output 적용)
   */
  private async extractFromSegment(
    segmentText: string,
    userOverridePrompt?: string
  ): Promise<GlossaryEntry[]> {
    if (!segmentText.trim()) {
      return [];
    }

    const prompt = this.getExtractionPrompt(segmentText, userOverridePrompt);

    try {
      // [핵심 변경] responseJsonSchema를 사용하여 구조화된 출력 요청
      const rawSchema = zodToJsonSchema(glossaryResponseSchema as any);
      
      // Gemini API 호환성을 위해 $schema 제거 (INVALID_ARGUMENT 방지)
      const { $schema, ...jsonSchema } = rawSchema as any;

      const responseText = await this.geminiClient.generateText(
        prompt,
        this.config.modelName,
        undefined,
        {
          temperature: this.config.glossaryExtractionTemperature || 0.1, // 구조화된 출력은 낮은 온도가 유리함
          maxOutputTokens: 8192,
          responseMimeType: "application/json", // 필수 설정
          responseJsonSchema: jsonSchema, // 정제된 스키마 전달
        }
      );

      // 응답은 이미 JSON 문자열임이 보장됨 (하지만 짤릴 수 있음)
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(responseText);
      } catch (error) {
        this.log('warning', `⚠️ 용어집 JSON 파싱 실패.`);
        
        if (responseText.length > 500) {
             this.log('debug', `📝 원본 응답(앞부분): ${responseText.slice(0, 200)} ...`);
             this.log('debug', `📝 원본 응답(뒷부분): ... ${responseText.slice(-200)}`);
        } else {
             this.log('debug', `📝 원본 응답: ${responseText}`);
        }
        
        throw error; // 용어집은 복구보다는 일단 에러를 던져서 재시도 로직이나 로그 확인 유도
      }
      
      // Zod 스키마로 유효성 검증 및 타입 추론
      const validatedData = glossaryResponseSchema.parse(parsedJson);

      // DTO로 변환
      const entries = validatedData.terms.map((item, index) => ({
        id: `extracted-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        keyword: item.keyword,
        translatedKeyword: item.translated_keyword,
        targetLanguage: item.target_language,
        occurrenceCount: item.occurrence_count,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      
      this.log('debug', `세그먼트에서 ${entries.length}개 용어 추출됨 (Structured Output)`);
      return entries;

    } catch (error) {
      if (GeminiClient.isRateLimitError(error as Error)) {
        this.log('error', `API 할당량 초과(429) 감지. 용어집 추출을 중단합니다.`);
        this.requestStop();
        return [];
      }

      // Zod 파싱 에러 처리
      if (error instanceof z.ZodError) {
        this.log('error', `스키마 검증 실패: ${JSON.stringify(error.issues)}`);
      } else if (error instanceof GeminiApiException) {
        this.log('error', `용어집 추출 API 오류: ${error.message}`);
      } else {
        this.log('error', `용어집 추출 중 오류: ${error}`);
      }
      return [];
    }
  }

  /**
   * 표본 세그먼트 선택 (무작위 샘플링으로 변경됨)
   */
  private selectSampleSegments(allSegments: string[]): string[] {
    const samplingRatio = (this.config.glossarySamplingRatio || 10) / 100;
    const totalSegments = allSegments.length;
    
    if (totalSegments === 0) return [];
    
    // 샘플 크기 계산
    const sampleSize = Math.max(1, Math.floor(totalSegments * samplingRatio));
    
    // 전체보다 샘플이 크거나 같으면 전체 반환
    if (sampleSize >= totalSegments) {
      return allSegments;
    }

    // [변경] 무작위 샘플링 (Fisher-Yates Shuffle)
    
    // 1. 전체 인덱스 배열 생성 [0, 1, 2, ..., n]
    const indices = Array.from({ length: totalSegments }, (_, i) => i);

    // 2. 인덱스 배열 무작위 섞기
    for (let i = totalSegments - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]]; // Swap
    }

    // 3. 앞에서부터 sampleSize만큼 자르기
    const selectedIndices = indices.slice(0, sampleSize);

    // 4. 처리 순서를 원문 흐름대로 하기 위해 인덱스 오름차순 정렬
    selectedIndices.sort((a, b) => a - b);

    this.log('debug', `무작위 샘플링 완료: ${selectedIndices.length}개 세그먼트 선택됨 (인덱스: ${selectedIndices.slice(0, 5).join(', ')}...)`);

    return selectedIndices.map(i => allSegments[i]);
  }

  /**
   * 용어집 충돌 해결 (중복 제거 및 등장 횟수 합산)
   */
  private resolveConflicts(entries: GlossaryEntry[]): GlossaryEntry[] {
    if (entries.length === 0) return [];

    this.log('info', `용어집 충돌 해결 시작. 총 ${entries.length}개 항목 검토 중...`);

    // (keyword, targetLanguage)를 키로 그룹화
    const entryMap = new Map<string, GlossaryEntry>();

    for (const entry of entries) {
      const key = `${entry.keyword.toLowerCase()}::${entry.targetLanguage.toLowerCase()}`;
      
      if (!entryMap.has(key)) {
        entryMap.set(key, { ...entry });
      } else {
        const existing = entryMap.get(key)!;
        existing.occurrenceCount += entry.occurrenceCount;
        existing.updatedAt = new Date();
      }
    }

    // 등장 횟수 순으로 정렬
    const finalEntries = Array.from(entryMap.values());
    finalEntries.sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) {
        return b.occurrenceCount - a.occurrenceCount;
      }
      return a.keyword.toLowerCase().localeCompare(b.keyword.toLowerCase());
    });

    this.log('info', `용어집 충돌 해결 완료. 최종 ${finalEntries.length}개 항목.`);
    return finalEntries;
  }

  /**
   * 시드 용어집 로드
   */
  loadSeedEntries(seedData: any[]): GlossaryEntry[] {
    const entries: GlossaryEntry[] = [];
    
    for (const item of seedData) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof item.keyword === 'string' &&
        typeof item.translatedKeyword === 'string'
      ) {
        entries.push({
          id: item.id || `seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          keyword: item.keyword,
          translatedKeyword: item.translatedKeyword,
          targetLanguage: item.targetLanguage || this.config.novelLanguage || 'ko',
          occurrenceCount: item.occurrenceCount || 0,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        });
      }
    }

    this.log('info', `${entries.length}개의 시드 용어집 항목 로드됨`);
    return entries;
  }

  /**
   * 전체 텍스트에서 용어집 추출 (병렬 처리 지원)
   * 
   * @param textContent - 분석할 텍스트
   * @param progressCallback - 진행률 콜백
   * @param seedEntries - 기존 시드 용어집 항목
   * @param userOverridePrompt - 사용자 정의 프롬프트
   * @param stopCheck - 중지 확인 콜백
   * @returns 추출된 용어집 항목 목록
   */
  async extractGlossary(
    textContent: string,
    progressCallback?: GlossaryProgressCallback,
    seedEntries?: GlossaryEntry[],
    userOverridePrompt?: string,
    stopCheck?: StopCheckCallback
  ): Promise<GlossaryEntry[]> {
    this.resetStop();
    const allExtractedEntries: GlossaryEntry[] = [];

    // 시드 항목 추가
    if (seedEntries && seedEntries.length > 0) {
      allExtractedEntries.push(...seedEntries);
      this.log('info', `${seedEntries.length}개의 시드 항목 로드됨`);
    }

    // 텍스트가 없는 경우
    if (!textContent.trim()) {
      if (seedEntries && seedEntries.length > 0) {
        this.log('info', '입력 텍스트가 비어있습니다. 시드 용어집만 반환합니다.');
        return this.resolveConflicts(allExtractedEntries);
      }
      this.log('warning', '입력 텍스트가 비어있고 시드 용어집도 없습니다.');
      return [];
    }

    // 청크로 분할
    const chunkSize = this.config.glossaryChunkSize || this.config.chunkSize || 8000;
    const allSegments = this.chunkService.createChunksFromFileContent(textContent, chunkSize);
    
    // 표본 선택
    const sampleSegments = this.selectSampleSegments(allSegments);
    const totalSegments = sampleSegments.length;

    this.log('info', `총 ${allSegments.length}개 세그먼트 중 ${totalSegments}개의 표본으로 용어집 추출 시작...`);

    const startTime = Date.now(); // [추가] 시작 시간 기록

    // 초기 진행률 콜백
    progressCallback?.({
      totalSegments,
      processedSegments: 0,
      currentStatusMessage: '추출 시작 중...',
      extractedEntriesCount: allExtractedEntries.length,
      etaSeconds: 0,
    });

    // 병렬 처리를 위한 설정
    const maxWorkers = this.config.maxWorkers || 1;
    const processingPromises = new Set<Promise<void>>();
    let processedCount = 0;

    // 각 세그먼트 처리 (병렬)
    for (let i = 0; i < sampleSegments.length; i++) {
      // 중지 확인
      if (this.stopRequested || (stopCheck && stopCheck())) {
        this.log('warning', '사용자 요청으로 용어집 추출 중단. 현재까지의 결과를 반환합니다.');
        break;
      }

      // 비동기 태스크 생성
      const task = (async () => {
        if (this.stopRequested) return;

        const segment = sampleSegments[i];
        const segmentPreview = segment.slice(0, 50).replace(/\n/g, ' ');
        
        this.log('info', `세그먼트 ${i + 1}/${totalSegments} 처리 중: "${segmentPreview}..."`);

        try {
          const entries = await this.extractFromSegment(segment, userOverridePrompt);
          
          if (this.stopRequested) return;

          allExtractedEntries.push(...entries);
        } catch (error) {
          this.log('error', `세그먼트 ${i + 1} 처리 중 오류: ${error}`);
        } finally {
          processedCount++;
          
          // [추가] ETA 계산
          const now = Date.now();
          const elapsedSeconds = (now - startTime) / 1000;
          let eta = 0;
          if (processedCount > 0) {
             const avgTimePerSegment = elapsedSeconds / processedCount;
             const remainingSegments = totalSegments - processedCount;
             eta = Math.ceil(avgTimePerSegment * remainingSegments);
          }

          // 진행률 콜백
          progressCallback?.({
            totalSegments,
            processedSegments: processedCount,
            currentStatusMessage: `세그먼트 ${processedCount}/${totalSegments} 처리 완료`,
            extractedEntriesCount: allExtractedEntries.length,
            etaSeconds: eta,
          });
        }
      })();

      // 태스크 관리
      processingPromises.add(task);
      task.then(() => processingPromises.delete(task));

      // 최대 워커 수 도달 시 대기
      if (processingPromises.size >= maxWorkers) {
        await Promise.race(processingPromises);
      }
    }

    // 남은 작업 대기
    await Promise.all(processingPromises);

    // 충돌 해결 (마지막 메시지 업데이트)
    progressCallback?.({
      totalSegments,
      processedSegments: totalSegments,
      currentStatusMessage: '충돌 해결 및 정리 중...',
      extractedEntriesCount: allExtractedEntries.length,
      etaSeconds: 0,
    });

    let finalEntries = this.resolveConflicts(allExtractedEntries);

    // 최대 항목 수 제한
    const maxEntries = this.config.glossaryMaxTotalEntries || 500;
    if (finalEntries.length > maxEntries) {
      this.log('info', `용어집 항목(${finalEntries.length}개)이 최대 제한(${maxEntries}개)을 초과하여 상위 항목만 유지합니다.`);
      finalEntries = finalEntries.slice(0, maxEntries);
    }

    // 최종 진행률 콜백
    progressCallback?.({
      totalSegments,
      processedSegments: totalSegments,
      currentStatusMessage: `추출 완료: ${finalEntries.length}개 항목`,
      extractedEntriesCount: finalEntries.length,
      etaSeconds: 0,
    });

    this.log('info', `용어집 추출 완료. 최종 ${finalEntries.length}개 항목.`);
    return finalEntries;
  }

  /**
   * EPUB 노드에서 용어집 추출 (병렬 처리 지원)
   * 
   * @param nodes - 분석할 EPUB 노드 배열
   * @param progressCallback - 진행률 콜백
   * @param seedEntries - 기존 시드 용어집 항목
   * @param userOverridePrompt - 사용자 정의 프롬프트
   * @param stopCheck - 중지 확인 콜백
   * @returns 추출된 용어집 항목 목록
   */
  async extractGlossaryFromEpub(
    nodes: EpubNode[],
    progressCallback?: GlossaryProgressCallback,
    seedEntries?: GlossaryEntry[],
    userOverridePrompt?: string,
    stopCheck?: StopCheckCallback
  ): Promise<GlossaryEntry[]> {
    // 1. 텍스트 노드만 추출하여 하나의 문자열로 병합
    // (단, 너무 길어지면 안되므로 적절히 처리해야 하지만, 
    //  기존 extractGlossary가 텍스트를 받아 청크로 나누므로 여기서는 텍스트만 모아서 넘겨도 됨)
    //  하지만 EPUB은 챕터별로 나뉘어 있을 수 있으므로, 
    //  단순 병합보다는 의미 단위(문단)로 줄바꿈하여 합치는 것이 좋음.
    
    const textContent = nodes
      .filter(n => n.type === 'text' && n.content && n.content.trim().length > 0)
      .map(n => n.content)
      .join('\n\n');

    this.log('info', `EPUB 노드에서 텍스트 추출 완료 (${textContent.length}자)`);

    // 2. 기존 텍스트 기반 추출 메서드 재사용
    return this.extractGlossary(
      textContent,
      progressCallback,
      seedEntries,
      userOverridePrompt,
      stopCheck
    );
  }

  /**
   * 용어집을 JSON 문자열로 내보내기 (Snake Case 변환 적용)
   */
  exportToJson(entries: GlossaryEntry[]): string {
    // 등장 횟수 정렬
    const sortedEntries = [...entries].sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) {
        return b.occurrenceCount - a.occurrenceCount;
      }
      return a.keyword.localeCompare(b.keyword);
    });

    const exportData = sortedEntries.map(entry => ({
      keyword: entry.keyword,
      translated_keyword: entry.translatedKeyword,
      target_language: entry.targetLanguage,
      occurrence_count: entry.occurrenceCount,
    }));
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 용어집을 CSV 문자열로 내보내기
   */
  exportToCsv(entries: GlossaryEntry[]): string {
    // 등장 횟수 정렬
    const sortedEntries = [...entries].sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) {
        return b.occurrenceCount - a.occurrenceCount;
      }
      return a.keyword.localeCompare(b.keyword);
    });

    const header = 'keyword,translatedKeyword,targetLanguage,occurrenceCount';
    const rows = sortedEntries.map(entry => 
      `"${entry.keyword.replace(/"/g, '""')}","${entry.translatedKeyword.replace(/"/g, '""')}","${entry.targetLanguage}",${entry.occurrenceCount}`
    );
    return [header, ...rows].join('\n');
  }
}

// 싱글톤 인스턴스 관리
let defaultGlossaryService: GlossaryService | null = null;

/**
 * 기본 GlossaryService 인스턴스 가져오기
 */
export function getGlossaryService(config: AppConfig, apiKey?: string): GlossaryService {
  if (!defaultGlossaryService) {
    defaultGlossaryService = new GlossaryService(config, apiKey);
  } else {
    // 설정이 변경되었을 수 있으므로 업데이트 시도
    defaultGlossaryService.updateConfig(config);
  }
  return defaultGlossaryService;
}

/**
 * 기본 서비스 재설정
 */
export function resetGlossaryService(): void {
  defaultGlossaryService = null;
}

/**
 * 새로운 서비스 인스턴스 생성
 */
export function createGlossaryService(config: AppConfig, apiKey?: string): GlossaryService {
  return new GlossaryService(config, apiKey);
}
