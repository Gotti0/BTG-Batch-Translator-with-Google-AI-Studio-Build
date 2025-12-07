// services/GeminiClient.ts
// 새로운 @google/genai SDK를 사용한 Gemini API 클라이언트
// Gemini 2.0과 함께 출시된 통합 클라이언트 구조 적용

import { GoogleGenAI } from '@google/genai';

/**
 * 생성 설정 인터페이스
 */
export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
}

/**
 * 채팅 메시지 항목
 */
export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

/**
 * 안전 설정 인터페이스
 */
export interface SafetySetting {
  category: string;
  threshold: string;
}

/**
 * API 예외 클래스들
 */
export class GeminiApiException extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'GeminiApiException';
  }
}

export class GeminiRateLimitException extends GeminiApiException {
  constructor(message: string, originalError?: Error) {
    super(message, originalError);
    this.name = 'GeminiRateLimitException';
  }
}

export class GeminiContentSafetyException extends GeminiApiException {
  constructor(message: string, originalError?: Error) {
    super(message, originalError);
    this.name = 'GeminiContentSafetyException';
  }
}

export class GeminiInvalidRequestException extends GeminiApiException {
  constructor(message: string, originalError?: Error) {
    super(message, originalError);
    this.name = 'GeminiInvalidRequestException';
  }
}

/**
 * 콘텐츠 안전 오류 패턴
 */
const CONTENT_SAFETY_PATTERNS = [
  'PROHIBITED_CONTENT',
  'SAFETY',
  'response was blocked',
  'BLOCKED_PROMPT',
  'SAFETY_BLOCKED',
  'blocked due to safety',
  'RECITATION',
  'HARM_CATEGORY',
];

/**
 * Rate Limit 오류 패턴
 */
const RATE_LIMIT_PATTERNS = [
  'rateLimitExceeded',
  '429',
  'Too Many Requests',
  'QUOTA_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'overloaded',
];

/**
 * 잘못된 요청 오류 패턴
 */
const INVALID_REQUEST_PATTERNS = [
  'Invalid API key',
  'API key not valid',
  'Permission denied',
  'Invalid model name',
  'model is not found',
  '400',
  'INVALID_ARGUMENT',
];

/**
 * 오류 타입 판별 함수
 */
function classifyError(error: Error): GeminiApiException {
  const errorMessage = error.message.toLowerCase();

  // 콘텐츠 안전 오류 체크
  for (const pattern of CONTENT_SAFETY_PATTERNS) {
    if (errorMessage.includes(pattern.toLowerCase())) {
      return new GeminiContentSafetyException(error.message, error);
    }
  }

  // Rate Limit 오류 체크
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (errorMessage.includes(pattern.toLowerCase())) {
      return new GeminiRateLimitException(error.message, error);
    }
  }

  // 잘못된 요청 오류 체크
  for (const pattern of INVALID_REQUEST_PATTERNS) {
    if (errorMessage.includes(pattern.toLowerCase())) {
      return new GeminiInvalidRequestException(error.message, error);
    }
  }

  return new GeminiApiException(error.message, error);
}

/**
 * Gemini API 클라이언트 (새로운 @google/genai SDK 사용)
 * 
 * 변경 사항:
 * - GoogleGenerativeAI → GoogleGenAI (통합 클라이언트)
 * - model.generateContent() → client.models.generateContent()
 * - model.startChat() → client.chats.create()
 * - 모델명은 인스턴스화 시점이 아닌 요청 시점에 전달
 */
export class GeminiClient {
  private client: GoogleGenAI;
  
  // RPM 제어
  private requestsPerMinute: number;
  private delayBetweenRequests: number;
  private lastRequestTimestamp: number = 0;

  /**
   * GeminiClient 생성자
   * 
   * @param apiKey - API 키 (AI Studio Builder에서는 자동 프록시됨)
   * @param requestsPerMinute - 분당 요청 수 제한 (기본값: 10)
   */
  constructor(apiKey?: string, requestsPerMinute: number = 10) {
    // AI Studio Builder에서는 API 키가 자동으로 프록시됨
    const key = apiKey || (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || '';
    
    if (!key) {
      console.warn('API 키가 제공되지 않았습니다. AI Studio Builder 환경에서 자동 프록시를 기대합니다.');
    }
    
    // 새로운 통합 클라이언트 생성
    this.client = new GoogleGenAI({ apiKey: key });
    
    this.requestsPerMinute = requestsPerMinute;
    this.delayBetweenRequests = requestsPerMinute > 0 ? 60000 / requestsPerMinute : 0;
    
    console.log(`GeminiClient 초기화 완료 (GenAI SDK). RPM: ${requestsPerMinute}`);
  }

  /**
   * RPM 제어를 위한 딜레이 적용
   */
  private async applyRpmDelay(): Promise<void> {
    if (this.delayBetweenRequests <= 0) return;

    const currentTime = Date.now();
    const nextSlot = Math.max(this.lastRequestTimestamp + this.delayBetweenRequests, currentTime);
    const sleepTime = nextSlot - currentTime;

    this.lastRequestTimestamp = nextSlot;

    if (sleepTime > 0) {
      if (sleepTime >= 1000) {
        console.log(`RPM(${this.requestsPerMinute}) 제어: ${(sleepTime / 1000).toFixed(2)}초 대기`);
      }
      await this.sleep(sleepTime);
    }
  }

  /**
   * 대기 유틸리티
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 텍스트 생성 (새로운 SDK 방식)
   * 
   * @param prompt - 프롬프트 텍스트
   * @param modelName - 모델 이름 (기본값: gemini-2.0-flash)
   * @param systemInstruction - 시스템 지침 (선택)
   * @param config - 생성 설정 (선택)
   * @returns 생성된 텍스트
   */
  async generateText(
    prompt: string,
    modelName: string = 'gemini-2.0-flash',
    systemInstruction?: string,
    config?: GenerationConfig
  ): Promise<string> {
    await this.applyRpmDelay();

    try {
      // 새로운 SDK: client.models.generateContent() 사용
      // 모델명은 요청 시점에 전달
      const response = await this.client.models.generateContent({
        model: modelName,
        contents: systemInstruction 
          ? `${systemInstruction}\n\n${prompt}`
          : prompt,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 8192,
          ...(config?.stopSequences && { stopSequences: config.stopSequences }),
        },
      });

      // 응답에서 텍스트 추출
      const text = response.text;
      
      if (!text && prompt.trim()) {
        throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
      }

      return text || '';
    } catch (error) {
      if (error instanceof GeminiApiException) {
        throw error;
      }
      throw classifyError(error as Error);
    }
  }

  /**
   * 채팅 세션을 사용한 텍스트 생성
   * 
   * @param prompt - 현재 프롬프트
   * @param systemInstruction - 시스템 지침
   * @param history - 대화 히스토리
   * @param modelName - 모델 이름
   * @param config - 생성 설정
   * @returns 생성된 텍스트
   */
  async generateWithChat(
    prompt: string,
    systemInstruction: string,
    history: ChatMessage[],
    modelName: string = 'gemini-2.0-flash',
    config?: GenerationConfig
  ): Promise<string> {
    await this.applyRpmDelay();

    try {
      // 새로운 SDK: client.chats.create() 사용
      const chat = this.client.chats.create({
        model: modelName,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 8192,
        },
        history: history.map(msg => ({
          role: msg.role,
          parts: [{ text: msg.content }],
        })),
      });

      // 시스템 지침이 있으면 프롬프트에 포함
      const fullPrompt = systemInstruction 
        ? `${systemInstruction}\n\n${prompt}`
        : prompt;

      const response = await chat.sendMessage({ message: fullPrompt });
      const text = response.text;
      
      if (!text && prompt.trim()) {
        throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
      }

      return text || '';
    } catch (error) {
      if (error instanceof GeminiApiException) {
        throw error;
      }
      throw classifyError(error as Error);
    }
  }

  /**
   * 스트리밍 텍스트 생성
   * 
   * @param prompt - 프롬프트 텍스트
   * @param modelName - 모델 이름
   * @param systemInstruction - 시스템 지침 (선택)
   * @param config - 생성 설정 (선택)
   * @param onChunk - 청크 수신 콜백
   * @returns 전체 생성된 텍스트
   */
  async generateTextStream(
    prompt: string,
    modelName: string = 'gemini-2.0-flash',
    systemInstruction?: string,
    config?: GenerationConfig,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    await this.applyRpmDelay();

    try {
      // 새로운 SDK: generateContentStream 사용
      const stream = await this.client.models.generateContentStream({
        model: modelName,
        contents: systemInstruction 
          ? `${systemInstruction}\n\n${prompt}`
          : prompt,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 8192,
        },
      });

      let fullText = '';
      
      // 스트림 청크 처리
      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        fullText += chunkText;
        if (onChunk) {
          onChunk(chunkText);
        }
      }

      return fullText;
    } catch (error) {
      if (error instanceof GeminiApiException) {
        throw error;
      }
      throw classifyError(error as Error);
    }
  }

  /**
   * 사용 가능한 모델 목록 조회
   * 
   * @returns 모델 이름 목록
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      // 새로운 SDK: client.models.list() 사용
      const response = await this.client.models.list();
      
      const models: string[] = [];
      
      // Response handling for different SDK versions/responses
      if (response && typeof response === 'object') {
        // 1. Array in .models property (Standard response)
        if ('models' in response && Array.isArray((response as any).models)) {
           const modelList = (response as any).models;
           for (const model of modelList) {
             if (model.name?.includes('gemini')) {
               models.push(model.name.replace('models/', ''));
             }
           }
        } 
        // 2. Async Iterable (Pagination or older SDK)
        else if (Symbol.asyncIterator in response) {
          try {
            for await (const model of (response as any)) {
                if (model.name?.includes('gemini')) {
                  models.push(model.name.replace('models/', ''));
                }
            }
          } catch (e) {
            console.warn('Error iterating models:', e);
          }
        }
      }
      
      return models.length > 0 ? models : [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
      ];
    } catch (error) {
      console.error('모델 목록 조회 실패:', error);
      // 기본 모델 목록 반환
      return [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
      ];
    }
  }

  /**
   * RPM 설정 변경
   */
  setRequestsPerMinute(rpm: number): void {
    this.requestsPerMinute = rpm;
    this.delayBetweenRequests = rpm > 0 ? 60000 / rpm : 0;
    console.log(`RPM 설정 변경: ${rpm}`);
  }

  /**
   * 현재 RPM 설정 조회
   */
  getRequestsPerMinute(): number {
    return this.requestsPerMinute;
  }

  /**
   * 콘텐츠 안전 오류인지 확인
   */
  static isContentSafetyError(error: Error): boolean {
    return error instanceof GeminiContentSafetyException ||
      CONTENT_SAFETY_PATTERNS.some(pattern => 
        error.message.toLowerCase().includes(pattern.toLowerCase())
      );
  }

  /**
   * Rate Limit 오류인지 확인
   */
  static isRateLimitError(error: Error): boolean {
    return error instanceof GeminiRateLimitException ||
      RATE_LIMIT_PATTERNS.some(pattern => 
        error.message.toLowerCase().includes(pattern.toLowerCase())
      );
  }
}

// 싱글톤 인스턴스 관리
let defaultClient: GeminiClient | null = null;

/**
 * 기본 GeminiClient 인스턴스 가져오기
 */
export function getGeminiClient(apiKey?: string, rpm?: number): GeminiClient {
  if (!defaultClient) {
    defaultClient = new GeminiClient(apiKey, rpm);
  }
  return defaultClient;
}

/**
 * 기본 클라이언트 재설정
 */
export function resetGeminiClient(): void {
  defaultClient = null;
}

/**
 * 새로운 클라이언트 인스턴스 생성 (기본 클라이언트와 별개)
 */
export function createGeminiClient(apiKey?: string, rpm?: number): GeminiClient {
  return new GeminiClient(apiKey, rpm);
}