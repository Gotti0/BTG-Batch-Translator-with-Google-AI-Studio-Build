// services/GlossaryService.ts
// Python domain/glossary_service.py 의 TypeScript 변환
// 텍스트에서 용어집 항목을 AI로 추출하고 관리하는 서비스

import { GeminiClient, GeminiApiException } from './GeminiClient';
import { ChunkService } from './ChunkService';
import type { GlossaryEntry, GlossaryExtractionProgress, LogEntry } from '../types/dtos';
import type { AppConfig } from '../types/config';

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
 * API에서 반환되는 원시 용어집 항목
 */
interface ApiGlossaryTerm {
  keyword: string;
  translated_keyword: string;
  target_language: string;
  occurrence_count: number;
}

/**
 * 용어집 추출 기본 프롬프트 템플릿
 */
const DEFAULT_GLOSSARY_EXTRACTION_PROMPT = `Analyze the following text. Identify key terms, focusing specifically on:
- **People (characters)**: Names of characters, protagonists, antagonists
- **Proper nouns**: Unique items, titles, artifacts, special terms
- **Place names**: Locations, cities, countries, specific buildings
- **Organization names**: Companies, groups, factions, schools

For each identified term, provide:
1. The original keyword as it appears in the text
2. Its translation into {target_lang_name} (BCP-47: {target_lang_code})
3. Estimated occurrence count in this segment

Respond with a JSON array of objects with these exact fields:
- "keyword": string (original term)
- "translated_keyword": string (translated term)
- "target_language": string (BCP-47 code, e.g., "ko")
- "occurrence_count": number

Text to analyze:
\`\`\`
{novelText}
\`\`\`

Respond ONLY with the JSON array, no additional text.`;

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
   * 용어집 추출 프롬프트 생성
   */
  private getExtractionPrompt(
    segmentText: string,
    userOverridePrompt?: string
  ): string {
    const template = userOverridePrompt?.trim() || 
      this.config.glossaryExtractionPrompt || 
      DEFAULT_GLOSSARY_EXTRACTION_PROMPT;

    const targetLangCode = this.config.novelLanguage || 'ko';
    const targetLangName = this.getLanguageName(targetLangCode);

    return template
      .replace(/{target_lang_code}/g, targetLangCode)
      .replace(/{target_lang_name}/g, targetLangName)
      .replace(/{novelText}/g, segmentText);
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
   * API 응답 파싱
   */
  private parseApiResponse(responseText: string): ApiGlossaryTerm[] {
    try {
      // JSON 배열 추출 시도
      let jsonStr = responseText.trim();
      
      // 코드 블록 제거
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      // JSON 배열 찾기
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        this.log('warning', 'API 응답에서 JSON 배열을 찾을 수 없습니다.');
        return [];
      }

      const parsed = JSON.parse(arrayMatch[0]);
      
      if (!Array.isArray(parsed)) {
        this.log('warning', 'API 응답이 배열이 아닙니다.');
        return [];
      }

      // 유효한 항목만 필터링
      return parsed.filter((item: any) => 
        typeof item === 'object' &&
        item !== null &&
        typeof item.keyword === 'string' &&
        typeof item.translated_keyword === 'string' &&
        item.keyword.trim() !== ''
      ).map((item: any) => ({
        keyword: item.keyword.trim(),
        translated_keyword: item.translated_keyword.trim(),
        target_language: item.target_language || this.config.novelLanguage || 'ko',
        occurrence_count: typeof item.occurrence_count === 'number' 
          ? item.occurrence_count 
          : 1,
      }));
    } catch (error) {
      this.log('error', `API 응답 파싱 실패: ${error}`);
      return [];
    }
  }

  /**
   * API 용어를 GlossaryEntry DTO로 변환
   */
  private apiTermsToEntries(apiTerms: ApiGlossaryTerm[]): GlossaryEntry[] {
    return apiTerms.map((term, index) => ({
      id: `extracted-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      keyword: term.keyword,
      translatedKeyword: term.translated_keyword,
      targetLanguage: term.target_language,
      occurrenceCount: term.occurrence_count,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }

  /**
   * 단일 세그먼트에서 용어집 추출
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
      const responseText = await this.geminiClient.generateText(
        prompt,
        this.config.modelName,
        undefined,
        {
          temperature: this.config.glossaryExtractionTemperature || 0.3,
          maxOutputTokens: 4096,
        }
      );

      const apiTerms = this.parseApiResponse(responseText);
      const entries = this.apiTermsToEntries(apiTerms);
      
      this.log('debug', `세그먼트에서 ${entries.length}개 용어 추출됨`);
      return entries;
    } catch (error) {
      if (error instanceof GeminiApiException) {
        this.log('error', `용어집 추출 API 오류: ${error.message}`);
      } else {
        this.log('error', `용어집 추출 중 오류: ${error}`);
      }
      return [];
    }
  }

  /**
   * 표본 세그먼트 선택
   */
  private selectSampleSegments(allSegments: string[]): string[] {
    const samplingRatio = (this.config.glossarySamplingRatio || 10) / 100;
    const totalSegments = allSegments.length;
    
    if (totalSegments === 0) return [];
    
    const sampleSize = Math.max(1, Math.floor(totalSegments * samplingRatio));
    
    if (sampleSize >= totalSegments) {
      return allSegments;
    }

    // 균등 샘플링
    const step = totalSegments / sampleSize;
    const selectedIndices: number[] = [];
    
    for (let i = 0; i < sampleSize; i++) {
      const index = Math.floor(i * step);
      if (!selectedIndices.includes(index)) {
        selectedIndices.push(index);
      }
    }

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

    // 초기 진행률 콜백
    progressCallback?.({
      totalSegments,
      processedSegments: 0,
      currentStatusMessage: '추출 시작 중...',
      extractedEntriesCount: allExtractedEntries.length,
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
          // 진행률 콜백
          progressCallback?.({
            totalSegments,
            processedSegments: processedCount,
            currentStatusMessage: `세그먼트 ${processedCount}/${totalSegments} 처리 완료`,
            extractedEntriesCount: allExtractedEntries.length,
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
    });

    this.log('info', `용어집 추출 완료. 최종 ${finalEntries.length}개 항목.`);
    return finalEntries;
  }

  /**
   * 용어집을 JSON 문자열로 내보내기 (Snake Case 변환 적용)
   */
  exportToJson(entries: GlossaryEntry[]): string {
    // [수정] 등장 횟수 정렬
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
    // [수정] 등장 횟수 정렬
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

// 싱글톤 인스턴스
let defaultGlossaryService: GlossaryService | null = null;

/**
 * 기본 GlossaryService 인스턴스 가져오기
 */
export function getGlossaryService(config: AppConfig, apiKey?: string): GlossaryService {
  if (!defaultGlossaryService) {
    defaultGlossaryService = new GlossaryService(config, apiKey);
  }
  return defaultGlossaryService;
}

/**
 * 기본 서비스 리셋
 */
export function resetGlossaryService(): void {
  defaultGlossaryService = null;
}

/**
 * 새 인스턴스 생성
 */
export function createGlossaryService(config: AppConfig, apiKey?: string): GlossaryService {
  return new GlossaryService(config, apiKey);
}