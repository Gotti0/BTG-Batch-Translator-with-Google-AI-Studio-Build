// server/geminiService.ts
import { GoogleGenAI, MediaResolution, Modality, type LiveServerMessage } from '@google/genai';
import { generateUltraCompactPdf, uint8ArrayToBase64 } from '../src/utils/pdfGenerator';
import type { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY || '';

export const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export const DEFAULT_SAFETY_SETTINGS: any = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface PdfInputOptions {
  enabled: boolean;
  mode: 'standard' | 'extreme';
  downloadDebug?: boolean;
  label?: string;
}

export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  responseJsonSchema?: object;
  substitutionData?: Record<string, string>;
  enableThinking?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  skipRpmDelay?: boolean;
  pdfInput?: PdfInputOptions;
}

const PDF_STANDARD_GUIDANCE =
  'Please read and process the entire text content provided in the attached PDF document according to the guidelines and produce only the final translated output.';
const PDF_EXTREME_GUIDANCE =
  'Execute the translation task completely based on the system instructions, guidelines, and examples embedded in the attached PDF. Provide only the final translated output without any explanation or conversational response.';

export function buildServerPdfRequest(
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

export function getThinkingConfig(modelName: string, config?: GenerationConfig): any {
  if (config?.enableThinking === false) return undefined;

  if (modelName.includes('gemini-3')) {
    return { thinkingLevel: config?.thinkingLevel || 'HIGH' };
  } else if (modelName.includes('gemini-2.5')) {
    const budget =
      config?.thinkingBudget !== undefined && config.thinkingBudget >= 0
        ? config.thinkingBudget
        : -1;
    return { thinkingBudget: budget };
  }
  return undefined;
}

export async function generateTextOnServer(params: {
  prompt: string;
  modelName?: string;
  systemInstruction?: string;
  config?: GenerationConfig;
  contents?: any[];
}): Promise<string> {
  const modelName = params.modelName || 'gemini-2.0-flash';
  const thinkingConfig = getThinkingConfig(modelName, params.config);

  let finalContents: any;
  let effectiveSystemInstruction = params.systemInstruction;
  let isPdf = false;

  if (params.contents) {
    finalContents = params.contents;
    isPdf = true;
  } else if (params.config?.pdfInput?.enabled) {
    const pdfRequest = buildServerPdfRequest(
      params.prompt,
      params.systemInstruction,
      [],
      params.config.pdfInput
    );
    finalContents = pdfRequest.contents;
    effectiveSystemInstruction = pdfRequest.systemInstruction;
    isPdf = true;
  } else {
    finalContents = params.prompt;
  }

  const response = await ai.models.generateContent({
    model: modelName,
    contents: finalContents,
    config: {
      temperature: params.config?.temperature ?? 0.7,
      topP: params.config?.topP ?? 0.9,
      topK: params.config?.topK ?? 40,
      maxOutputTokens: params.config?.maxOutputTokens ?? 65536,
      ...(params.config?.stopSequences && { stopSequences: params.config.stopSequences }),
      responseMimeType: params.config?.responseMimeType,
      responseSchema: params.config?.responseJsonSchema,
      ...(effectiveSystemInstruction && { systemInstruction: effectiveSystemInstruction }),
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      ...(thinkingConfig && { thinkingConfig }),
      ...(isPdf && { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }),
    },
  });

  const text = response.text;
  if (!text && params.prompt.trim()) {
    throw new Error('API가 빈 응답을 반환했습니다. (PROHIBITED_CONTENT or EMPTY)');
  }
  return text || '';
}

export async function generateWithChatOnServer(params: {
  prompt: string;
  systemInstruction: string;
  history: ChatMessage[];
  modelName?: string;
  config?: GenerationConfig;
}): Promise<string> {
  const modelName = params.modelName || 'gemini-2.0-flash';
  const thinkingConfig = getThinkingConfig(modelName, params.config);

  const chatHistory = (params.history || []).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const replacements = { ...(params.config?.substitutionData || {}) };
  if (!replacements['{{slot}}']) {
    replacements['{{slot}}'] = params.prompt;
  }

  let replacementOccurred = false;
  chatHistory.forEach((msg) => {
    for (const [key, value] of Object.entries(replacements)) {
      if (msg.content.includes(key)) {
        msg.content = msg.content.split(key).join(value);
        replacementOccurred = true;
      }
    }
  });

  let messageToSend = ' ';
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
    messageToSend = params.prompt;
  }

  if (params.config?.pdfInput?.enabled) {
    const pdfRequest = buildServerPdfRequest(
      messageToSend,
      params.systemInstruction,
      chatHistory,
      params.config.pdfInput
    );
    const pdfResponse = await ai.models.generateContent({
      model: modelName,
      contents: pdfRequest.contents,
      config: {
        temperature: params.config?.temperature ?? 0.7,
        topP: params.config?.topP ?? 0.9,
        topK: params.config?.topK ?? 40,
        maxOutputTokens: params.config?.maxOutputTokens ?? 65536,
        ...(pdfRequest.systemInstruction && { systemInstruction: pdfRequest.systemInstruction }),
        responseMimeType: params.config?.responseMimeType,
        responseSchema: params.config?.responseJsonSchema,
        safetySettings: DEFAULT_SAFETY_SETTINGS,
        ...(thinkingConfig && { thinkingConfig }),
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      },
    });
    const pdfText = pdfResponse.text;
    if (!pdfText && messageToSend.trim()) {
      throw new Error('API가 빈 응답을 반환했습니다.');
    }
    return pdfText || '';
  }

  const chat = ai.chats.create({
    model: modelName,
    config: {
      temperature: params.config?.temperature ?? 0.7,
      topP: params.config?.topP ?? 0.9,
      topK: params.config?.topK ?? 40,
      maxOutputTokens: params.config?.maxOutputTokens ?? 65536,
      ...(params.systemInstruction && { systemInstruction: params.systemInstruction }),
      responseMimeType: params.config?.responseMimeType,
      responseSchema: params.config?.responseJsonSchema,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      ...(thinkingConfig && { thinkingConfig }),
    },
    history: chatHistory.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    })),
  });

  const response = await chat.sendMessage({ message: messageToSend });
  const text = response.text;
  if (!text && messageToSend.trim()) {
    throw new Error('API가 빈 응답을 반환했습니다.');
  }
  return text || '';
}

export async function generateTextStreamOnServer(params: {
  prompt: string;
  modelName?: string;
  systemInstruction?: string;
  config?: GenerationConfig;
}) {
  const modelName = params.modelName || 'gemini-2.0-flash';
  const thinkingConfig = getThinkingConfig(modelName, params.config);

  return ai.models.generateContentStream({
    model: modelName,
    contents: params.prompt,
    config: {
      temperature: params.config?.temperature ?? 0.7,
      topP: params.config?.topP ?? 0.9,
      topK: params.config?.topK ?? 40,
      maxOutputTokens: params.config?.maxOutputTokens ?? 65536,
      ...(params.systemInstruction && { systemInstruction: params.systemInstruction }),
      safetySettings: DEFAULT_SAFETY_SETTINGS,
      ...(thinkingConfig && { thinkingConfig }),
    },
  });
}

export async function generateImageDescriptionOnServer(params: {
  imageData: string; // base64
  mimeType: string;
  prompt?: string;
  modelName?: string;
}): Promise<string> {
  const modelName = params.modelName || 'gemini-2.5-flash';
  const prompt = params.prompt || 'Describe this image in detail.';

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.imageData,
            },
          },
        ],
      },
    ],
    config: {
      temperature: 0.4,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('API가 빈 응답을 반환했습니다.');
  }
  return text;
}

export async function generateOrEditCoverImageOnServer(params: {
  model: string;
  prompt: string;
  originalImageDataUrl?: string;
  aspectRatio?: string;
  thinkingLevel?: 'MINIMAL' | 'HIGH';
}): Promise<{ imageUrl: string; mimeType: string; text?: string }> {
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
    ai.models.generateContent({
      model: params.model,
      contents: [{ role: 'user', parts }],
      config: { ...baseConfig, responseModalities },
    });

  let response: any;
  try {
    response = await callApi(['IMAGE']);
  } catch (err: any) {
    if (/modality|responseModalities/i.test(err?.message || '')) {
      response = await callApi(['TEXT', 'IMAGE']);
    } else {
      throw err;
    }
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
    if (!detail && finishReason && finishReason !== 'STOP')
      detail = `응답이 비정상 종료되었습니다 (finishReason: ${finishReason})`;
    throw new Error(`이미지가 생성되지 않았습니다.\n[모델 응답]: ${detail || '빈 응답'}`);
  }

  return {
    imageUrl: `data:${imageMimeType};base64,${imageBase64}`,
    mimeType: imageMimeType,
    text: responseText || undefined,
  };
}

const DEFAULT_TEXT_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
];

const DEFAULT_IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-nano-banana-2.1',
];

export async function getAvailableModelsOnServer(): Promise<string[]> {
  try {
    const response = await ai.models.list();
    const models: string[] = [];
    let modelList: any[] = [];

    if (response && typeof response === 'object') {
      if (Array.isArray(response)) {
        modelList = response;
      } else if ('models' in response && Array.isArray((response as any).models)) {
        modelList = (response as any).models;
      } else if (Symbol.asyncIterator in response) {
        for await (const model of response as any) {
          modelList.push(model);
        }
      }
    }

    for (const model of modelList) {
      const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
      if (name && name.includes('gemini')) {
        models.push(name);
      }
    }
    return models.length > 0 ? models : DEFAULT_TEXT_MODELS;
  } catch (error) {
    console.error('모델 목록 조회 실패 (server):', error);
    return DEFAULT_TEXT_MODELS;
  }
}

export async function getImageModelsOnServer(): Promise<string[]> {
  try {
    const response = await ai.models.list();
    const models: string[] = [];
    let modelList: any[] = [];

    if (response && typeof response === 'object') {
      if (Array.isArray(response)) {
        modelList = response;
      } else if ('models' in response && Array.isArray((response as any).models)) {
        modelList = (response as any).models;
      } else if (Symbol.asyncIterator in response) {
        for await (const model of response as any) {
          modelList.push(model);
        }
      }
    }

    for (const model of modelList) {
      const name = typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : '';
      if (name && name.toLowerCase().includes('image')) {
        models.push(name);
      }
    }
    return models.length > 0 ? models : DEFAULT_IMAGE_MODELS;
  } catch (error) {
    console.error('이미지 모델 목록 조회 실패 (server):', error);
    return DEFAULT_IMAGE_MODELS;
  }
}

// 429 분석용
const RATE_LIMIT_PATTERNS = [
  'ratelimitexceeded',
  '429',
  'too many requests',
  'quota_exceeded',
  'resource_exhausted',
  'overloaded',
];

const CONTENT_SAFETY_PATTERNS = [
  'prohibited_content',
  'safety',
  'response was blocked',
  'blocked_prompt',
  'safety_blocked',
  'blocked due to safety',
  'recitation',
  'harm_category',
];

const INVALID_REQUEST_PATTERNS = [
  'invalid api key',
  'api key not valid',
  'permission denied',
  'invalid model name',
  'model is not found',
  '400',
  'invalid_argument',
];

export function classifyServerError(error: any): {
  status: number;
  type: 'RATE_LIMIT' | 'CONTENT_SAFETY' | 'INVALID_REQUEST' | 'GENERIC';
  message: string;
  details?: any;
} {
  const msg = (error?.message || String(error || '')).toLowerCase();
  const rawMsg = error?.message || String(error || '');

  const isRateLimit =
    error?.status === 429 ||
    error?.code === 429 ||
    RATE_LIMIT_PATTERNS.some((p) => msg.includes(p));

  if (isRateLimit) {
    return {
      status: 429,
      type: 'RATE_LIMIT',
      message: rawMsg,
      details: error?.details || error?.error?.details,
    };
  }

  for (const p of CONTENT_SAFETY_PATTERNS) {
    if (msg.includes(p)) {
      return {
        status: 200, // or 400
        type: 'CONTENT_SAFETY',
        message: rawMsg,
      };
    }
  }

  for (const p of INVALID_REQUEST_PATTERNS) {
    if (msg.includes(p)) {
      return {
        status: 400,
        type: 'INVALID_REQUEST',
        message: rawMsg,
      };
    }
  }

  return {
    status: 500,
    type: 'GENERIC',
    message: rawMsg,
  };
}

export function handleLiveSession(clientWs: WebSocket): void {
  let session: any = null;

  ai.live
    .connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        systemInstruction:
          'You are a helpful bilingual translation assistant and conversational partner.',
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio) {
            clientWs.send(JSON.stringify({ audio }));
          }
          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
          const textPart = message.serverContent?.modelTurn?.parts?.find((p: any) => p.text);
          if (textPart?.text) {
            clientWs.send(JSON.stringify({ text: textPart.text }));
          }
        },
        onerror: (err: any) => {
          console.error('Gemini Live session error:', err);
          clientWs.send(JSON.stringify({ error: err?.message || 'Live session error' }));
        },
        onclose: () => {
          clientWs.send(JSON.stringify({ closed: true }));
        },
      },
    })
    .then((s) => {
      session = s;

      clientWs.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.audio) {
            session.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: parsed.mimeType || 'audio/pcm;rate=16000' },
            });
          } else if (parsed.video) {
            session.sendRealtimeInput({
              video: { data: parsed.video, mimeType: parsed.mimeType || 'image/jpeg' },
            });
          } else if (parsed.text) {
            session.sendRealtimeInput({
              text: parsed.text,
            });
          }
        } catch (err: any) {
          console.error('Error handling client message:', err);
        }
      });
    })
    .catch((err) => {
      console.error('Failed to establish Gemini Live connection:', err);
      clientWs.send(JSON.stringify({ error: err?.message || 'Failed to start Live session' }));
      clientWs.close();
    });

  clientWs.on('close', () => {
    try {
      if (session) {
        session.close();
      }
    } catch {
      // ignore
    }
  });
}
