// services/GeminiClient.ts
// 새로운 @google/genai SDK를 사용한 Gemini API 클라이언트
// Gemini 2.0과 함께 출시된 통합 클라이언트 구조 적용

import { GoogleGenAI, MediaResolution } from '@google/genai';
import { generateUltraCompactPdf, uint8ArrayToBase64, downloadPdfBlob } from '../utils/pdfGenerator';

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
  // 호출자가 RequestGate로 RPM을 이미 통제한 요청이면 클라이언트 내부 대기를 건너뛴다
  skipRpmDelay?: boolean;
  // 프롬프트를 PDF로 바꿔 보낸다 (번역 요청에서만 사용)
  pdfInput?: PdfInputOptions;
}

/**
 * PDF 입력 옵션
 */
export interface PdfInputOptions {
  enabled: boolean;
  /** standard: 본문 프롬프트만 PDF로, extreme: 시스템 지침과 히스토리까지 PDF 하나로 */
  mode: 'standard' | 'extreme';
  /** 요청에 쓴 PDF를 내려받는다 */
  downloadDebug?: boolean;
  /** 디버그 PDF 파일명에 붙일 식별자 (예: 청크 번호) */
  label?: string;
}

const PDF_STANDARD_GUIDANCE =
  'Please read and process the entire text content provided in the attached PDF document according to the guidelines and produce only the final translated output.';
const PDF_EXTREME_GUIDANCE =
  'Execute the translation task completely based on the system instructions, guidelines, and examples embedded in the attached PDF. Provide only the final translated output without any explanation or conversational response.';

/**
 * 프롬프트를 1쪽짜리 PDF로 감싼 요청 본문을 만든다.
 * PDF를 MEDIA_RESOLUTION_LOW로 보내면 긴 프롬프트도 고정된 소수의 토큰으로 계산된다.
 */
export function buildPdfRequest(
  message: string,
  systemInstruction: string | undefined,
  history: ChatMessage[],
  options: PdfInputOptions
): { contents: any[]; systemInstruction?: string } {
  let pdfText: string;
  let guidance: string;
  let effectiveSystemInstruction = systemInstruction;
  let textHistory = history;

  if (options.mode === 'extreme') {
    const sections: string[] = [];
    if (systemInstruction?.trim()) {
      sections.push(`=== [SYSTEM INSTRUCTION] ===\n${systemInstruction.trim()}`);
    }
    if (history.length > 0) {
      sections.push(
        `=== [FEW-SHOT EXAMPLES] ===\n${history
          .map((h, idx) => `[${h.role === 'user' ? 'USER' : 'ASSISTANT'} ${idx + 1}]\n${h.content.trim()}`)
          .join('\n\n')}`
      );
    }
    sections.push(`=== [MAIN TASK] ===\n${message.trim()}`);
    pdfText = sections.join('\n\n');
    guidance = PDF_EXTREME_GUIDANCE;
    effectiveSystemInstruction = undefined;
    textHistory = [];
  } else {
    pdfText = message.trim();
    guidance = PDF_STANDARD_GUIDANCE;
  }

  const pdfBytes = generateUltraCompactPdf(pdfText);
  if (options.downloadDebug) {
    const safeLabel = (options.label || 'request').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const timeStr = new Date().toISOString().replace(/[:.]/g, '-');
    downloadPdfBlob(pdfBytes, `gemini_pdf_input_${timeStr}_${safeLabel}.pdf`);
  }

  return {
    contents: [
      ...textHistory.map((msg) => ({ role: msg.role, parts: [{ text: msg.content }] })),
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: uint8ArrayToBase64(pdfBytes) } },
          { text: guidance },
        ],
      },
    ],
    systemInstruction: effectiveSystemInstruction,
  };
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

/**
 * 429 응답이 어떤 한도에 걸렸는지 구분한 값
 */
export type RateLimitType = 'RPM' | 'RPD' | 'TPM' | 'TPD' | 'CONCURRENCY' | 'QUOTA';

/**
 * 429 응답에서 추출한 한도 정보
 */
export interface RateLimitDetails {
  limitType: RateLimitType;
  limitTypeName: string;
  metric?: string;
  limitName?: string;
  limitValue?: string | number;
  retryDelay?: string;
  rawDescription?: string;
  /** 로그와 토스트에 그대로 쓰는 한글 요약 */
  formattedSummary: string;
}

export class GeminiRateLimitException extends GeminiApiException {
  public details?: RateLimitDetails;

  constructor(message: string, originalError?: Error, details?: RateLimitDetails) {
    super(message, originalError);
    this.name = 'GeminiRateLimitException';
    this.details = details;
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
 * 모델 목록 조회에 실패했을 때 표지 생성에 제시할 이미지 모델
 */
const DEFAULT_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
];

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

// 429 메시지·JSON 분석용 정규식 (에러 발생 시에만 쓰이므로 모듈 레벨에서 한 번만 컴파일)
const QUOTA_METRIC_REGEX = /(?:quota\s+)?metric\s*[:=]\s*['"]?([a-zA-Z0-9_./-]+)['"]?|"quota_metric"\s*:\s*"([^"]+)"|quota_metric\s*:\s*([A-Za-z0-9_./-]+)/i;
const QUOTA_LIMIT_VALUE_REGEX = /"quota_limit_value"\s*:\s*"([0-9]+)"|quota_limit_value\s*:\s*([0-9]+)|(?:^|[,\s(])limit\s*[:=]\s*([0-9]+)(?:[,\s)]|$)/i;
const QUOTA_LIMIT_NAME_REGEX = /"quota_limit"\s*:\s*"([^"]+)"|quota_limit\s*:\s*([A-Za-z0-9_-]+)|limit\s*['":]\s*([a-zA-Z][a-zA-Z0-9_-]+)/i;
const RETRY_DELAY_REGEX = /(?:please\s+)?retry\s+(?:in|after)\s+([0-9a-zA-Z._]+)|"retryDelay"\s*:\s*"([^"]+)"|retryDelay\s*:\s*([0-9a-zA-Z._]+)|retry_delay\s*:\s*([0-9a-zA-Z._]+)/i;
const QUOTA_MODEL_REGEX = /(?:^|[,\s(])model\s*[:=]\s*([a-zA-Z0-9_.-]+)/i;

/**
 * '22h47m29.16s', '43.1s', '15' 같은 대기 시간 표기를 '약 22시간 47분 29초' 형태로 바꾼다
 */
function formatRetryDelay(rawDelay: string): string {
  const trimmed = rawDelay.trim().replace(/[.,;:!?]+$/, '');

  const durationMatch = trimmed.match(/^(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9.]+)s)?$/i);
  if (durationMatch && (durationMatch[1] || durationMatch[2] || durationMatch[3])) {
    const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
    const seconds = durationMatch[3] ? Math.round(parseFloat(durationMatch[3])) : 0;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}시간`);
    if (minutes > 0) parts.push(`${minutes}분`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}초`);
    return `약 ${parts.join(' ')}`;
  }

  const secNum = parseFloat(trimmed.replace(/s(?:ec(?:onds?)?)?/i, '').trim());
  if (!isNaN(secNum)) {
    if (secNum >= 3600) {
      const hrs = Math.floor(secNum / 3600);
      const remMins = Math.floor((secNum % 3600) / 60);
      return remMins > 0 ? `약 ${hrs}시간 ${remMins}분` : `약 ${hrs}시간`;
    }
    if (secNum >= 60) {
      const mins = Math.floor(secNum / 60);
      const secs = Math.round(secNum % 60);
      return secs > 0 ? `약 ${mins}분 ${secs}초` : `약 ${mins}분`;
    }
    return `약 ${Math.round(secNum)}초`;
  }

  return trimmed;
}

/**
 * 429 오류 객체나 메시지에서 어떤 한도(RPM/RPD/TPM 등)에 걸렸는지, 한도 수치와 권장 대기 시간을 추출한다.
 * SDK·프록시에 따라 오류가 구조화된 details 배열로 오기도 하고 문자열로 직렬화되어 오기도 하므로
 * 구조화된 값을 먼저 읽고, 빠진 필드는 메시지 정규식으로 보강한다.
 */
export function extractRateLimitDetails(source: any): RateLimitDetails {
  let metric: string | undefined;
  let limitName: string | undefined;
  let limitValue: string | number | undefined;
  let retryDelay: string | undefined;
  let rawDescription: string | undefined;
  let modelName: string | undefined;

  const rawMsg: string = typeof source === 'string' ? source : (source?.message || String(source || ''));

  const detailsArray: any[] = [
    ...(source?.details || source?.errorDetails || source?.error?.details || source?.response?.details || []),
  ];

  // 메시지 안에 Google RPC 오류 JSON이 통째로 들어 있는 경우
  if (detailsArray.length === 0 && rawMsg.includes('{')) {
    try {
      const firstBrace = rawMsg.indexOf('{');
      const lastBrace = rawMsg.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = JSON.parse(rawMsg.slice(firstBrace, lastBrace + 1));
        const found = parsed?.error?.details || parsed?.details || [];
        if (Array.isArray(found)) {
          detailsArray.push(...found);
        }
      }
    } catch {
      // JSON이 잘려 있으면 아래 정규식 경로로 처리한다
    }
  }

  for (const item of detailsArray) {
    const type: string = item?.['@type'] || item?.type || '';

    if (type.includes('QuotaFailure') && Array.isArray(item.violations) && item.violations.length > 0) {
      const v = item.violations[0];
      if (v.description) rawDescription = v.description;
      if (!metric && v.quotaMetric) metric = v.quotaMetric;
      if (!limitName && v.quotaId) limitName = v.quotaId;
      if (limitValue === undefined && v.quotaValue !== undefined) limitValue = v.quotaValue;
      if (!modelName && v.quotaDimensions?.model) modelName = v.quotaDimensions.model;
    }

    if (type.includes('ErrorInfo') && item.metadata) {
      const meta = item.metadata;
      if (meta.quota_limit) limitName = meta.quota_limit;
      if (meta.quota_limit_value) limitValue = meta.quota_limit_value;
      if (meta.quota_metric) metric = meta.quota_metric;
    }

    if (type.includes('RetryInfo')) {
      if (typeof item.retryDelay === 'string') {
        retryDelay = item.retryDelay;
      } else if (typeof item.retryDelay === 'number') {
        retryDelay = `${item.retryDelay}s`;
      } else if (item.retry_delay?.seconds !== undefined) {
        retryDelay = `${item.retry_delay.seconds}s`;
      }
    }
  }

  const combinedText = `${rawMsg} ${rawDescription || ''} ${limitName || ''}`;

  if (!rawDescription) {
    const descMatch = combinedText.match(/Quota exceeded for [^.\n]+/i);
    if (descMatch) rawDescription = descMatch[0];
  }
  if (limitValue === undefined) {
    const valMatch = combinedText.match(QUOTA_LIMIT_VALUE_REGEX);
    if (valMatch) limitValue = valMatch[1] || valMatch[2] || valMatch[3];
  }
  if (!limitName) {
    const nameMatch = combinedText.match(QUOTA_LIMIT_NAME_REGEX);
    if (nameMatch) limitName = nameMatch[1] || nameMatch[2] || nameMatch[3]?.trim();
  }
  if (!metric) {
    const metricMatch = combinedText.match(QUOTA_METRIC_REGEX);
    if (metricMatch) metric = metricMatch[1] || metricMatch[2] || metricMatch[3]?.trim();
  }
  if (!modelName) {
    const modelMatch = combinedText.match(QUOTA_MODEL_REGEX);
    if (modelMatch) modelName = modelMatch[1]?.trim();
  }
  if (!retryDelay) {
    const delayMatch = combinedText.match(RETRY_DELAY_REGEX);
    if (delayMatch) retryDelay = delayMatch[1] || delayMatch[2] || delayMatch[3] || delayMatch[4];
  }

  // 한도 종류 분류: 토큰 > 요청 순으로, 기간(일/분)은 그다음에 본다
  const corpus = `${metric || ''} ${limitName || ''} ${rawDescription || ''} ${rawMsg}`.toLowerCase();
  const isRequest = corpus.includes('request');
  const isToken = corpus.includes('token') || corpus.includes('tpm');
  const isMinute = corpus.includes('minute') || corpus.includes('rpm') || corpus.includes('per_minute');
  const isDay = corpus.includes('day') || corpus.includes('rpd') || corpus.includes('per_day') || corpus.includes('daily');
  const isConcurrency = corpus.includes('concurren') || corpus.includes('simultaneous');

  let limitType: RateLimitType;
  if (isToken && isDay) limitType = 'TPD';
  else if (isToken) limitType = 'TPM';
  else if (isRequest && isDay) limitType = 'RPD';
  else if (isRequest && isMinute) limitType = 'RPM';
  else if (isDay) limitType = 'RPD';
  else if (isMinute) limitType = 'RPM';
  else if (isConcurrency) limitType = 'CONCURRENCY';
  else limitType = 'QUOTA';

  const limitTypeNames: Record<RateLimitType, string> = {
    RPM: '분당 요청 수 제한 (RPM)',
    RPD: '일일 요청 수 제한 (RPD)',
    TPM: '분당 토큰 수 제한 (TPM)',
    TPD: '일일 토큰 수 제한 (TPD)',
    CONCURRENCY: '동시 요청 수 제한 (Concurrency)',
    QUOTA: 'API 할당량 제한 (Quota)',
  };
  const limitTypeName = limitTypeNames[limitType];
  const formattedDelay = retryDelay ? formatRetryDelay(retryDelay) : undefined;

  let formattedValue = '';
  if (limitValue !== undefined) {
    const num = Number(limitValue);
    const numStr = !isNaN(num) ? num.toLocaleString() : String(limitValue);
    const units: Partial<Record<RateLimitType, string>> = {
      RPM: '회/분',
      RPD: '회/일',
      TPM: ' 토큰/분',
      TPD: ' 토큰/일',
    };
    formattedValue = `${numStr}${units[limitType] ?? ''}`;
  }

  const summaryParts: string[] = [limitTypeName];
  if (formattedValue) summaryParts.push(`한도: ${formattedValue}`);
  if (formattedDelay) {
    summaryParts.push(`권장 대기 시간: ${formattedDelay}`);
  } else if (limitType === 'RPD' || limitType === 'TPD') {
    summaryParts.push('오늘 할당량 소진');
  }
  if (metric) {
    const shortMetric = metric.includes('/') ? metric.split('/').pop() : metric;
    if (shortMetric) summaryParts.push(`메트릭: ${shortMetric}`);
  }
  if (modelName) summaryParts.push(`모델: ${modelName}`);

  return {
    limitType,
    limitTypeName,
    metric,
    limitName,
    limitValue,
    retryDelay: formattedDelay || retryDelay,
    rawDescription,
    formattedSummary: summaryParts.join(' | '),
  };
}

/**
 * 오류 타입 판별 함수
 */
function classifyError(error: Error): GeminiApiException {
  const errorMessage = error.message.toLowerCase();

  // Rate Limit을 콘텐츠 안전보다 먼저 본다.
  // 429 본문에는 'limit: 1500' 같은 수치가 들어가 콘텐츠 안전 패턴 '500'에 걸리면 분할 재시도가 연쇄로 터진다.
  const isRateLimit =
    (error as any)?.status === 429 ||
    RATE_LIMIT_PATTERNS.some((pattern) => errorMessage.includes(pattern.toLowerCase()));
  if (isRateLimit) {
    const details = extractRateLimitDetails(error);
    return new GeminiRateLimitException(`[${details.formattedSummary}] ${error.message}`, error, details);
  }

  // 콘텐츠 안전 오류 체크
  for (const pattern of CONTENT_SAFETY_PATTERNS) {
    if (errorMessage.includes(pattern.toLowerCase())) {
      return new GeminiContentSafetyException(error.message, error);
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
    if (!config?.skipRpmDelay) await this.applyRpmDelay();

    const thinkingConfig = this.getThinkingConfig(modelName, config);
    const pdfRequest = config?.pdfInput?.enabled
      ? buildPdfRequest(prompt, systemInstruction, [], config.pdfInput)
      : null;
    const effectiveSystemInstruction = pdfRequest ? pdfRequest.systemInstruction : systemInstruction;

    try {
      // 새로운 SDK: client.models.generateContent() 사용
      // 모델명은 요청 시점에 전달
      const response = await this.client.models.generateContent({
        model: modelName,
        contents: pdfRequest ? pdfRequest.contents : prompt,
        config: {
          temperature: config?.temperature ?? 0.7,
          topP: config?.topP ?? 0.9,
          topK: config?.topK ?? 40,
          maxOutputTokens: config?.maxOutputTokens ?? 65536,
          ...(config?.stopSequences && { stopSequences: config.stopSequences }),
          responseMimeType: config?.responseMimeType,
          responseSchema: config?.responseJsonSchema,
          ...(effectiveSystemInstruction && { systemInstruction: effectiveSystemInstruction }),
          safetySettings: DEFAULT_SAFETY_SETTINGS,
          ...(thinkingConfig && { thinkingConfig }),
          ...(pdfRequest && { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }),
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
    if (!config?.skipRpmDelay) await this.applyRpmDelay();
    
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

      // 5-a. PDF 입력: 채팅 세션 대신 히스토리를 contents로 펼쳐 한 번에 보낸다
      if (config?.pdfInput?.enabled) {
        const pdfRequest = buildPdfRequest(messageToSend, systemInstruction, chatHistory, config.pdfInput);
        const pdfResponse = await this.client.models.generateContent({
          model: modelName,
          contents: pdfRequest.contents,
          config: {
            temperature: config?.temperature ?? 0.7,
            topP: config?.topP ?? 0.9,
            topK: config?.topK ?? 40,
            maxOutputTokens: config?.maxOutputTokens ?? 65536,
            ...(pdfRequest.systemInstruction && { systemInstruction: pdfRequest.systemInstruction }),
            responseMimeType: config?.responseMimeType,
            responseSchema: config?.responseJsonSchema,
            safetySettings: DEFAULT_SAFETY_SETTINGS,
            ...(thinkingConfig && { thinkingConfig }),
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
          },
        });
        const pdfText = pdfResponse.text;
        if (!pdfText && messageToSend.trim()) {
          throw new GeminiContentSafetyException('API가 빈 응답을 반환했습니다.');
        }
        return pdfText || '';
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
    if (!config?.skipRpmDelay) await this.applyRpmDelay();
    
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
    const models = await this.listModelNames((name) => name.includes('gemini'));
    return models.length > 0 ? models : this.getDefaultModels();
  }

  /**
   * 표지 생성에 쓸 수 있는 이미지 모델 목록 조회
   */
  async getImageModels(): Promise<string[]> {
    const models = await this.listModelNames((name) => name.toLowerCase().includes('image'));
    return models.length > 0 ? models : DEFAULT_IMAGE_MODELS;
  }

  /**
   * 모델 목록 API를 조회해 조건에 맞는 모델명만 돌려준다 (실패하면 빈 배열)
   */
  private async listModelNames(predicate: (name: string) => boolean): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      const models: string[] = [];
      let modelList: any[] = [];

      if (response && typeof response === 'object') {
        if (Array.isArray(response)) {
          modelList = response;
        } else if ('models' in response && Array.isArray((response as any).models)) {
          modelList = (response as any).models;
        } else if (Symbol.asyncIterator in response) {
          for await (const model of (response as any)) {
            modelList.push(model);
          }
        }
      }

      for (const model of modelList) {
        const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
        if (name && predicate(name)) {
          models.push(name);
        }
      }
      return models;
    } catch (error) {
      console.error('모델 목록 조회 실패:', error);
      return [];
    }
  }

  /**
   * 표지 이미지를 새로 만들거나, 원본 표지를 바탕으로 수정한다.
   * 이미지 모델이 설명 텍스트만 돌려주고 이미지를 빠뜨리는 경우가 있어 응답 형식을 이미지로 고정하고,
   * 이미지가 없으면 모델이 돌려준 텍스트를 오류 메시지에 담아 원인을 볼 수 있게 한다.
   */
  async generateOrEditCoverImage(params: {
    model: string;
    prompt: string;
    originalImageDataUrl?: string;
    aspectRatio?: string;
    thinkingLevel?: 'MINIMAL' | 'HIGH';
  }): Promise<{ imageUrl: string; mimeType: string; text?: string }> {
    await this.applyRpmDelay();

    const outputInstruction =
      '\n\n[출력 지침]: 텍스트 설명이나 계획만 답변하지 마십시오. 반드시 요청된 수정/생성 결과 이미지를 직접 생성하여 반환하십시오.';
    const effectivePrompt = params.prompt.includes('결과 이미지를 직접 생성')
      ? params.prompt
      : `${params.prompt}${outputInstruction}`;

    const parts: any[] = [];
    if (params.originalImageDataUrl) {
      const match = params.originalImageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      parts.push({
        inlineData: {
          data: match ? match[2] : params.originalImageDataUrl,
          mimeType: match ? match[1] : 'image/png',
        },
      });
    }
    parts.push({ text: effectivePrompt });

    const baseConfig: any = {
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      imageConfig: { aspectRatio: params.aspectRatio || '3:4' },
      systemInstruction:
        'You are a professional web novel cover image generator and editor. When asked to create or modify a cover image, you MUST ALWAYS generate and return the resulting image. Do not reply with text explanations without an image.',
      ...(params.thinkingLevel && { thinkingConfig: { thinkingLevel: params.thinkingLevel } }),
    };

    const callApi = async (responseModalities: string[]) =>
      this.client.models.generateContent({
        model: params.model,
        contents: [{ role: 'user', parts }],
        config: { ...baseConfig, responseModalities },
      });

    let response: any;
    try {
      try {
        response = await callApi(['IMAGE']);
      } catch (err: any) {
        // 이미지 단독 응답을 지원하지 않는 모델은 텍스트+이미지로 다시 요청한다
        if (/modality|responseModalities/i.test(err?.message || '')) {
          response = await callApi(['TEXT', 'IMAGE']);
        } else {
          throw err;
        }
      }
    } catch (error) {
      console.error('API 호출 중 오류 발생 (generateOrEditCoverImage):', error);
      if (error instanceof GeminiApiException) throw error;
      throw classifyError(error as Error);
    }

    let imageBase64: string | undefined;
    let imageMimeType = 'image/png';
    let responseText = '';
    const candidate = response?.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        if (part.inlineData.mimeType) imageMimeType = part.inlineData.mimeType;
      } else if (part.text && !part.thought) {
        responseText += (responseText ? '\n' : '') + part.text;
      }
    }

    if (!imageBase64) {
      const blockReason = response?.promptFeedback?.blockReason;
      const finishReason = candidate?.finishReason;
      let detail = responseText.trim();
      if (!detail && blockReason) detail = `안전 정책에 의해 차단되었습니다 (blockReason: ${blockReason})`;
      if (!detail && finishReason && finishReason !== 'STOP') detail = `응답이 비정상 종료되었습니다 (finishReason: ${finishReason})`;
      throw new GeminiApiException(`이미지가 생성되지 않았습니다.\n[모델 응답]: ${detail || '빈 응답'}`);
    }

    return {
      imageUrl: `data:${imageMimeType};base64,${imageBase64}`,
      mimeType: imageMimeType,
      text: responseText || undefined,
    };
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
    // 429 본문의 한도 수치('1500' 등)가 콘텐츠 안전 패턴 '500'에 걸리지 않도록 먼저 제외한다
    if (error instanceof GeminiRateLimitException) return false;
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

  /**
   * 429 오류의 한도 정보 조회 (분류 전 원본 오류가 와도 동작)
   */
  static getRateLimitDetails(error: Error): RateLimitDetails {
    if (error instanceof GeminiRateLimitException && error.details) {
      return error.details;
    }
    return extractRateLimitDetails(error);
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
