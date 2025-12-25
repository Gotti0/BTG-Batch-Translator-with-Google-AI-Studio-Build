// services/GeminiClient.ts
// 새로운 @google/genai SDK를 사용한 Gemini API 클라이언트
// Gemini 2.0과 함께 출시된 통합 클라이언트 구조 적용

import { GoogleGenAI } from '@google/genai';

/**
 * 기본 안전 설정 (모두 허용)
 * 소설 번역 등 창작물 작업 시 문맥상 필요한 표현이 차단되는 것을 방지합니다.
 * @note SDK의 SafetySetting 타입과 호환되도록 any로 캐스팅합니다.
 */
const DEFAULT_SAFETY_SETTINGS: any = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

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
  // [추가] 구조화된 출력을 위한 설정
  responseMimeType?: string;
  responseJsonSchema?: object; 
  // [추가] 템플릿 치환을 위한 데이터 맵 (예: { '{{slot}}': '원문', '{{glossary_context}}': '용어...' })
  substitutionData?: Record<string, string>;
  // [추가] Thinking 모델 파라미터
  enableThinking?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: 'MINIMAL'| 'LOW'| 'MEDIUM'| 'HIGH';
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
  '500',
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
   * 모델 이름에 따라 적절한 Thinking Config를 반환하는 헬퍼 메서드
   */
  private getThinkingConfig(modelName: string, config?: GenerationConfig): any {
    // UI에서 명시적으로 비활성화한 경우
    if (config?.enableThinking === false) return undefined;
    
    if (modelName.includes("gemini-3")) {
      return { thinkingLevel: config?.thinkingLevel || "HIGH" };
    } else if (modelName.includes("gemini-2.5")) {
      // thinkingBudget이 0 또는 양수일 경우 해당 값 사용, 그렇지 않으면 -1 (Dynamic) 사용
      const budget = (config?.thinkingBudget !== undefined && config.thinkingBudget >= 0) ? config.thinkingBudget : -1;
      return { thinkingBudget: budget };
    }
    return undefined;
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

    const thinkingConfig = this.getThinkingConfig(modelName, config);

    try {
      // 새로운 SDK: client.models.generateContent() 사용
      // 모델명은 요청 시점에 전달
      const response = await this.client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 65536,
          ...(config?.stopSequences && { stopSequences: config.stopSequences }),
          responseMimeType: config?.responseMimeType,
          responseSchema: config?.responseJsonSchema,
          ...(systemInstruction && { systemInstruction }),
          safetySettings: DEFAULT_SAFETY_SETTINGS,
          ...(thinkingConfig && { thinkingConfig }), 
        },
      });

      // 응답에서 텍스트 추출
      const text = response.text;
      
      if (!text && prompt.trim()) {
        throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
      }

      return text || '';
    } catch (error) {
      console.error("API 호출 중 오류 발생 (generateText):", error);
      if (error instanceof GeminiApiException) {
        throw error;
      }
      throw classifyError(error as Error);
    }
  }

  /**
   * 이미지 설명 생성 (멀티모달)
   * 
   * @param imageData - 이미지 바이너리 데이터 (Uint8Array)
   * @param mimeType - 이미지 MIME 타입 (예: 'image/jpeg')
   * @param prompt - 프롬프트 
   * @param modelName - 모델 이름 (기본값: gemini-2.5-flash)
   * @returns 생성된 설명 텍스트
   */
  async generateImageDescription(
    imageData: Uint8Array,
    mimeType: string,
    prompt: string = "Describe this image in detail.",
    modelName: string = 'gemini-2.5-flash'
  ): Promise<string> {
    await this.applyRpmDelay();

    try {
      // Base64 인코딩 (브라우저 호환)
      let base64Image = '';
      const len = imageData.byteLength;
      for (let i = 0; i < len; i++) {
        base64Image += String.fromCharCode(imageData[i]);
      }
      base64Image = btoa(base64Image);

      const response = await this.client.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Image,
                },
              },
            ],
          },
        ],
        config: {
          temperature: 0.4, // 설명은 사실적이어야 하므로 낮게 설정
          // [중요] 안전 설정: BLOCK_NONE 적용
          safetySettings: DEFAULT_SAFETY_SETTINGS,
        },
      });

      const text = response.text;
      
      if (!text) {
        throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
      }

      return text;
    } catch (error) {
      console.error("API 호출 중 오류 발생 (generateImageDescription):", error);
      if (error instanceof GeminiApiException) {
        throw error;
      }
      throw classifyError(error as Error);
    }
  }

  /**
   * 채팅 세션을 사용한 텍스트 생성 (다중 치환 지원)
   * * [변경 사항]
   * 1. config.substitutionData가 있으면 히스토리 내의 해당 키들을 값으로 모두 치환합니다.
   * 2. 기본적으로 prompt 인자는 '{{slot}}'의 값으로 사용됩니다 (substitutionData에 명시되지 않은 경우).
   * 3. 히스토리의 마지막 User 메시지를 트리거로 사용합니다.
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
    
    const thinkingConfig = this.getThinkingConfig(modelName, config);

    try {
      // 1. 히스토리 깊은 복사 (원본 오염 방지)
      const chatHistory = history.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // 2. 치환 데이터 준비
      const replacements = { ...(config?.substitutionData || {}) };
      if (!replacements['{{slot}}']) {
        replacements['{{slot}}'] = prompt;
      }

      // 3. 히스토리 내 치환 수행
      let replacementOccurred = false;
      chatHistory.forEach(msg => {
        for (const [key, value] of Object.entries(replacements)) {
          if (msg.content.includes(key)) {
            msg.content = msg.content.split(key).join(value);
            replacementOccurred = true;
          }
        }
      });
      if (replacementOccurred) {
         console.log(`[GeminiClient] 히스토리 내 템플릿 치환 완료 (${Object.keys(replacements).join(', ')})`);
      }

      // 4. 실제 전송할 메시지 결정
      let messageToSend = " "; 
      if (replacementOccurred) {
        const lastIndex = chatHistory.length - 1;
        if (lastIndex >= 0) {
            const lastMessage = chatHistory[lastIndex];
            if (lastMessage.role === 'user') {
                messageToSend = lastMessage.content;
                chatHistory.pop(); 
            } 
        }
      } else {
        messageToSend = prompt;
      }

      // 5. 채팅 세션 생성
      const chat = this.client.chats.create({
        model: modelName,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 65536,
          ...(systemInstruction && { systemInstruction }),
          responseMimeType: config?.responseMimeType,
          responseSchema: config?.responseJsonSchema,
          safetySettings: DEFAULT_SAFETY_SETTINGS,
          ...(thinkingConfig && { thinkingConfig }), 
        },
        history: chatHistory.map(msg => ({
          role: msg.role,
          parts: [{ text: msg.content }],
        })),
      });

      const response = await chat.sendMessage({ message: messageToSend });
      const text = response.text;
      
      if (!text && messageToSend.trim()) {
        throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
      }

      return text || '';
    } catch (error) {
      console.error("API 호출 중 오류 발생 (generateWithChat):", error);
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
    
    const thinkingConfig = this.getThinkingConfig(modelName, config);

    try {
      // 새로운 SDK: generateContentStream 사용
      const stream = await this.client.models.generateContentStream({
        model: modelName,
        contents: prompt,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 65536,
          ...(systemInstruction && { systemInstruction }),
          safetySettings: DEFAULT_SAFETY_SETTINGS,
          ...(thinkingConfig && { thinkingConfig }), 
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
      console.error("API 호출 중 오류 발생 (generateTextStream):", error);
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
      const response = await this.client.models.list();
      const models: string[] = [];
      let modelList: any[] = [];
      
      if (response && typeof response === 'object') {
        if (Array.isArray(response)) {
            modelList = response;
        } 
        else if ('models' in response && Array.isArray((response as any).models)) {
            modelList = (response as any).models;
        }
        else if (Symbol.asyncIterator in response) {
          try {
             for await (const model of (response as any)) {
               if (model.name?.includes('gemini')) {
                 models.push(model.name.replace('models/', ''));
               }
             }
             return models.length > 0 ? models : this.getDefaultModels();
          } catch (e) {
             console.warn('Error iterating models:', e);
          }
        }
      }

      for (const model of modelList) {
        if (model.name?.includes('gemini')) {
          models.push(model.name.replace('models/', ''));
        }
      }
      
      return models.length > 0 ? models : this.getDefaultModels();
    } catch (error) {
      console.error('모델 목록 조회 실패:', error);
      return this.getDefaultModels();
    }
  }

  private getDefaultModels(): string[] {
    return [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
    ];
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
