// services/ImageAnnotationService.ts
// EPUB 내 이미지에 대한 AI 주석 생성 서비스

import JSZip from 'jszip';
import { GeminiClient, GeminiApiException } from './GeminiClient';
import { epubService } from './EpubService';
import type { EpubNode } from '../types/epub';
import type { AppConfig } from '../types/config';
import type { LogEntry } from '../types/dtos';

/**
 * 이미지 주석 진행 콜백 타입
 */
export interface ImageAnnotationProgress {
  totalImages: number;
  processedImages: number;
  successfulImages: number;
  failedImages: number;
  currentStatusMessage: string;
}

export type ImageAnnotationProgressCallback = (progress: ImageAnnotationProgress) => void;
export type LogCallback = (entry: LogEntry) => void;

export class ImageAnnotationService {
  private geminiClient: GeminiClient;
  private config: AppConfig;
  private stopRequested: boolean = false;
  private onLog?: LogCallback;

  constructor(config: AppConfig, apiKey?: string) {
    this.config = config;
    this.geminiClient = new GeminiClient(apiKey, config.requestsPerMinute);
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
    console.log(`[ImageAnnotation][${level.toUpperCase()}] ${message}`);
    this.onLog?.(entry);
  }

  /**
   * 중단 요청
   */
  requestStop(): void {
    this.stopRequested = true;
    this.log('warning', '이미지 주석 생성 중단이 요청되었습니다.');
  }

  /**
   * 중단 상태 리셋
   */
  resetStop(): void {
    this.stopRequested = false;
  }

  /**
   * MIME 타입 추론
   */
  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      default:
        return 'image/jpeg'; // 기본값
    }
  }

  /**
   * EPUB 노드 배열에 이미지 주석 추가
   * 
   * @param nodes 원본 EPUB 노드 배열
   * @param zip EPUB ZIP 객체 (이미지 데이터 로드용)
   * @param onProgress 진행률 콜백
   * @returns 주석이 추가된 새로운 노드 배열
   */
  async annotateImages(
    nodes: EpubNode[],
    zip: JSZip,
    onProgress?: ImageAnnotationProgressCallback
  ): Promise<EpubNode[]> {
    this.resetStop();
    
    // 이미지 노드 식별
    const imageNodes = nodes.filter(n => n.type === 'image' && n.imagePath);
    const totalImages = imageNodes.length;

    if (totalImages === 0) {
      this.log('info', '주석을 생성할 이미지가 없습니다.');
      return nodes;
    }

    this.log('info', `총 ${totalImages}개 이미지에 대한 주석 생성 시작`);

    const newNodes = [...nodes];
    const maxWorkers = this.config.maxWorkers || 1;
    const processingPromises = new Set<Promise<void>>();
    
    // 결과 저장용 맵 (노드 ID -> 주석 노드)
    // 병렬 처리 후 순서대로 삽입하기 위해 맵 사용
    const annotationMap = new Map<string, EpubNode>();

    let processedImages = 0;
    let successfulImages = 0;
    let failedImages = 0;

    // 초기 진행률 보고
    onProgress?.({
      totalImages,
      processedImages: 0,
      successfulImages: 0,
      failedImages: 0,
      currentStatusMessage: '이미지 분석 시작...',
    });

    // 병렬 처리 루프
    for (const imageNode of imageNodes) {
      if (this.stopRequested) break;

      const task = (async () => {
        if (this.stopRequested) return;

        try {
          if (!imageNode.imagePath) return;

          // 1. 이미지 데이터 로드
          const imageData = await epubService.getImageData(zip, imageNode.imagePath);
          
          if (!imageData) {
            this.log('warning', `이미지 데이터를 찾을 수 없음: ${imageNode.imagePath}`);
            failedImages++;
            return;
          }

          // 2. AI 주석 생성
          const mimeType = this.getMimeType(imageNode.imagePath);
          const prompt = "You are an OCR-capable translation assistant. Your sole job is to detect every piece of readable text in the provided image and translate it into natural, fluent Korean.\nStrict Instructions:\n1. Extract only the text that is clearly visible in the image. Do not guess, infer, or hallucinate any content.\n2. Translate the exact extracted text into Korean that sounds completely native—no literal or awkward phrasing.\n3. Output must consist of Korean text only. Do not include the original text, any foreign-language snippets, transliterations, explanations, annotations, or formatting (e.g. Markdown).\n4. If the image contains no legible text, return an empty string: `\"\"`.\n\nRespond with nothing but the final Korean translation.```\n\nThis version makes each step unambiguous and emphasizes the “no extras” rule.";
          
          const description = await this.geminiClient.generateImageDescription(
            imageData,
            mimeType,
            prompt,
            this.config.modelName // 멀티모달 지원 모델이어야 함
          );

          // 3. 주석 노드 생성
          // 줄바꿈 문자를 <br/> 태그로 변환하여 XHTML 파싱 오류 방지
          const formattedDescription = description.replace(/\n/g, '<br/>');
          
          const annotationNode: EpubNode = {
            id: `${imageNode.id}_annotation`,
            type: 'text',
            tag: 'p',
            content: `[[이미지 텍스트:<br/>${formattedDescription}<br/>]]`,
            attributes: {
              class: 'image-annotation',
              title: 'AI Annotation',
              // [수정] font-size: 0.9em -> 14px (절대 단위 사용)
              // 일부 EPUB(일러스트 페이지 등)은 body { font-size: 0; } 설정이 있어
              // 상대 단위(em) 사용 시 텍스트가 보이지 않는 문제 해결
              style: 'color: gray; font-size: 14px; line-height: 1.4; margin-top: 5px;'
            }
          };

          annotationMap.set(imageNode.id, annotationNode);
          successfulImages++;
          this.log('info', `이미지 주석 생성 완료: ${imageNode.imagePath}`);

        } catch (error) {
          this.log('error', `이미지 주석 생성 실패 (${imageNode.imagePath}): ${error}`);
          failedImages++;

          // API 관련 오류(Rate Limit 등) 발생 시 전체 작업을 중단하도록 요청
          if (error instanceof GeminiApiException) {
            if (!this.stopRequested) { // 중단 메시지가 한 번만 표시되도록
              this.log('warning', 'API 오류가 발생하여 남은 이미지 주석 생성을 중단합니다.');
              this.requestStop();
            }
          }
        } finally {
          processedImages++;
          onProgress?.({
            totalImages,
            processedImages,
            successfulImages,
            failedImages,
            currentStatusMessage: `이미지 ${processedImages}/${totalImages} 처리 중...`,
          });
        }
      })();

      processingPromises.add(task);
      task.then(() => processingPromises.delete(task));

      if (processingPromises.size >= maxWorkers) {
        await Promise.race(processingPromises);
      }
    }

    await Promise.all(processingPromises);

    // 노드 삽입 (역순으로 처리하거나 오프셋 계산 필요)
    // 여기서는 새로운 배열을 만드는 방식을 사용 (안전함)
    const resultNodes: EpubNode[] = [];
    
    for (const node of newNodes) {
      resultNodes.push(node);
      
      // 해당 노드에 대한 주석이 있으면 바로 뒤에 추가
      if (annotationMap.has(node.id)) {
        resultNodes.push(annotationMap.get(node.id)!);
      }
    }

    this.log('info', `이미지 주석 처리 완료. 성공: ${successfulImages}, 실패: ${failedImages}`);
    
    onProgress?.({
      totalImages,
      processedImages,
      successfulImages,
      failedImages,
      currentStatusMessage: '완료',
    });

    return resultNodes;
  }
}
