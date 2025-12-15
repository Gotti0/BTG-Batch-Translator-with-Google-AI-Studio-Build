// services/ChunkService.ts
// Python utils/chunk_service.py 의 TypeScript 변환

const DEFAULT_MAX_CHUNK_SIZE = 6000;

/**
 * 텍스트 콘텐츠를 지정된 크기의 청크로 분할하는 서비스
 */
export class ChunkService {
  private defaultMaxChunkSize: number;

  constructor(defaultMaxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE) {
    this.defaultMaxChunkSize = defaultMaxChunkSize;
  }

  /**
   * 주어진 텍스트 내용을 지정된 최대 크기의 청크 리스트로 분할합니다.
   * 분할은 주로 줄바꿈 문자를 기준으로 이루어지며, 각 청크는 maxChunkSize를 초과하지 않도록 합니다.
   * 
   * @param textContent - 분할할 전체 텍스트 내용
   * @param maxChunkSize - 각 청크의 최대 문자 수 (기본값: DEFAULT_MAX_CHUNK_SIZE)
   * @returns 분할된 텍스트 청크의 배열
   * @throws Error maxChunkSize가 0 이하인 경우
   */
  splitTextIntoChunks(textContent: string, maxChunkSize?: number): string[] {
    const max = maxChunkSize ?? this.defaultMaxChunkSize;

    if (max <= 0) {
      throw new Error('maxChunkSize는 0보다 커야 합니다.');
    }

    const chunks: string[] = [];
    let currentChunk = '';

    // 텍스트 내용을 줄 단위로 분리 (개행 문자 유지)
    // JavaScript에는 splitlines(keepends=True)가 없으므로 정규식 사용
    const lines = textContent.split(/(?<=\n)/);

    for (const line of lines) {
      if (currentChunk.length + line.length <= max) {
        currentChunk += line;
      } else {
        // 현재 청크가 내용이 있으면 추가
        if (currentChunk) {
          chunks.push(currentChunk);
        }

        // 새 줄이 maxChunkSize보다 큰 경우 처리
        if (line.length > max) {
          console.warn(
            `단일 라인이 maxChunkSize(${max})를 초과합니다. 강제 분할합니다. 라인 길이: ${line.length}`
          );
          // 긴 라인을 maxChunkSize에 맞춰 강제로 분할
          for (let i = 0; i < line.length; i += max) {
            chunks.push(line.slice(i, i + max));
          }
          currentChunk = ''; // 강제 분할 후 현재 청크는 비움
        } else {
          currentChunk = line;
        }
      }
    }

    // 마지막 남은 청크 추가
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    console.log(`텍스트가 ${chunks.length}개의 청크로 분할되었습니다 (최대 크기: ${max}).`);
    return chunks;
  }

  /**
   * 파일에서 읽은 전체 텍스트 내용을 청크로 분할합니다.
   * splitTextIntoChunks 메소드의 래퍼 함수입니다.
   * 
   * @param fileContent - 파일에서 읽은 전체 텍스트 내용
   * @param maxChunkSize - 각 청크의 최대 문자 수
   * @returns 분할된 텍스트 청크의 배열
   */
  createChunksFromFileContent(fileContent: string, maxChunkSize?: number): string[] {
    console.debug(
      `파일 내용으로부터 청크 생성 시작 (최대 크기: ${maxChunkSize ?? this.defaultMaxChunkSize}). 내용 길이: ${fileContent.length}`
    );
    return this.splitTextIntoChunks(fileContent, maxChunkSize);
  }

  /**
   * 청크를 재귀적으로 더 작은 청크로 분할합니다.
   * 
   * @param chunkText - 분할할 텍스트
   * @param targetSize - 목표 청크 크기 (undefined이면 현재 크기의 절반)
   * @param minChunkSize - 최소 청크 크기 (기본값: 100)
   * @param maxSplitDepth - 최대 분할 깊이 (기본값: 3)
   * @param currentDepth - 현재 분할 깊이 (기본값: 0)
   * @returns 분할된 청크 배열
   */
  splitChunkRecursively(
    chunkText: string,
    targetSize?: number,
    minChunkSize: number = 100,
    maxSplitDepth: number = 3,
    currentDepth: number = 0
  ): string[] {
    if (currentDepth >= maxSplitDepth) {
      console.warn(`최대 분할 깊이(${maxSplitDepth})에 도달했습니다.`);
      return [chunkText];
    }

    if (chunkText.trim().length <= minChunkSize) {
      console.log(`최소 청크 크기(${minChunkSize})에 도달했습니다.`);
      return [chunkText];
    }

    // 목표 크기가 지정되지 않으면 현재 크기의 절반으로 설정
    const target = targetSize ?? Math.floor(chunkText.length / 2);

    console.log(
      `청크 분할 시도 (깊이: ${currentDepth}, 현재 크기: ${chunkText.length}, 목표 크기: ${target})`
    );

    // 기존 splitTextIntoChunks 메서드 사용하여 분할
    const subChunks = this.splitTextIntoChunks(chunkText, target);

    // 분할이 의미있게 되지 않은 경우 (1개 청크만 나온 경우)
    if (subChunks.length <= 1) {
      // 더 작은 크기로 강제 분할 시도
      const smallerTarget = Math.max(minChunkSize, Math.floor(target / 2));
      if (smallerTarget < target) {
        return this.splitChunkRecursively(
          chunkText,
          smallerTarget,
          minChunkSize,
          maxSplitDepth,
          currentDepth + 1
        );
      } else {
        return [chunkText];
      }
    }

    console.log(`청크가 ${subChunks.length}개로 분할되었습니다.`);
    return subChunks;
  }

  /**
   * 문장 단위로 청크를 분할합니다.
   * 
   * @param chunkText - 분할할 텍스트
   * @param maxSentencesPerChunk - 청크당 최대 문장 수 (기본값: 2)
   * @returns 분할된 청크 배열
   */
  splitChunkBySentences(chunkText: string, maxSentencesPerChunk: number = 2): string[] {
    // 문장 분할 정규식 개선
    // 1. 문장부호(.!?) 뒤에 닫는 괄호/따옴표가 올 수 있음을 고려
    // 2. 문장부호 자체를 캡처 그룹으로 포함하여 소실 방지
    // 3. CJK 문장부호(。！？)는 공백이 없어도 분할, 영문(.!?)은 공백이 있어야 분할(약어 방지)
    
    // 패턴 설명:
    // 1. ([.!?]+['"”」\)]*(?:\s+|[\r\n]+|$)) -> 영문: 문장부호 + (선택)닫는괄호/따옴표 + 공백/줄바꿈/끝
    // 2. ([。！？]+['"”」\)]*(?:\s*|[\r\n]+|$)) -> CJK: 문장부호 + (선택)닫는괄호/따옴표 + (선택)공백/줄바꿈/끝
    // 3. ([\r\n]+) -> 줄바꿈만 있는 경우
    const sentencePattern = /([.!?]+['"”」\)]*(?:\s+|[\r\n]+|$)|[。！？]+['"”」\)]*(?:\s*|[\r\n]+|$)|[\r\n]+)/;

    const parts = chunkText.split(sentencePattern);
    const sentences: string[] = [];

    // split 결과는 [텍스트, 구분자, 텍스트, 구분자...] 형식이 됨
    for (let i = 0; i < parts.length; i += 2) {
      const content = parts[i];
      const separator = parts[i + 1] || '';
      
      const fullSentence = (content + separator).trim();
      
      if (fullSentence.length > 0) {
        sentences.push(fullSentence);
      }
    }

    if (sentences.length <= 1) {
      return [chunkText];
    }

    // 지정된 문장 수로 청크 생성
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += maxSentencesPerChunk) {
      const chunkSentences = sentences.slice(i, i + maxSentencesPerChunk);
      chunks.push(chunkSentences.join(' ')); // 문장 간 공백으로 연결
    }

    return chunks;
  }

  /**
   * 청크의 총 문자 수를 계산합니다.
   * 
   * @param chunks - 청크 배열
   * @returns 총 문자 수
   */
  getTotalLength(chunks: string[]): number {
    return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  /**
   * 청크 배열을 다시 합쳐서 원본 텍스트를 복원합니다.
   * 
   * @param chunks - 청크 배열
   * @returns 합쳐진 텍스트
   */
  joinChunks(chunks: string[]): string {
    return chunks.join('');
  }
}

// 싱글톤 인스턴스 (필요시 사용)
export const chunkService = new ChunkService();