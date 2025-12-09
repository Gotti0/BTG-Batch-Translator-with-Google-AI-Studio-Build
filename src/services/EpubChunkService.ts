/**
 * EPUB 노드 배열 전용 청킹 서비스
 * 
 * 핵심 문제 해결:
 * 기존 ChunkService는 "문자 길이" 기준만 사용
 * EPUB은 "문자 길이 + 노드 개수" 두 기준이 필요
 * 
 * 예시:
 * - 텍스트 5000자 × 노드 100개 → JSON 구조 복잡 → 에러 가능
 * - 텍스트 2000자 × 노드 5개 → JSON 간단 → 안전
 * 
 * 따라서 EpubChunkService를 별도 생성하여 역할 분리
 */

import { EpubNode } from '../types/epub';

export class EpubChunkService {
  private maxChunkSize: number;
  private maxNodesPerChunk: number;

  /**
   * EpubChunkService 초기화
   * 
   * @param maxChunkSize 최대 문자 크기 (기본값: 5000)
   * @param maxNodesPerChunk 최대 노드 개수 (기본값: 30)
   */
  constructor(maxChunkSize: number = 5000, maxNodesPerChunk: number = 30) {
    this.maxChunkSize = maxChunkSize;
    this.maxNodesPerChunk = maxNodesPerChunk;
  }

  /**
   * EpubNode 배열을 청크로 분할
   * 
   * 두 조건 중 하나라도 초과하면 새 청크 시작:
   * 1. 누적 문자 크기 > maxChunkSize
   * 2. 노드 개수 >= maxNodesPerChunk
   * 
   * @param nodes 원본 노드 배열
   * @returns 청크로 분할된 노드 배열의 배열
   * 
   * @example
   * const service = new EpubChunkService(5000, 30);
   * const chunks = service.splitEpubNodesIntoChunks(allNodes);
   * // 각 청크는 5000자 이하이면서 30개 노드 이하
   */
  splitEpubNodesIntoChunks(nodes: EpubNode[]): EpubNode[][] {
    const chunks: EpubNode[][] = [];
    let currentChunk: EpubNode[] = [];
    let currentSize: number = 0;

    for (const node of nodes) {
      // 텍스트 노드의 크기만 계산 (image/ignored는 크기 0)
      const nodeSize = node.type === 'text' ? (node.content?.length ?? 0) : 0;

      // 두 조건 중 하나라도 초과하면 새 청크 시작
      if (
        (currentSize + nodeSize > this.maxChunkSize ||
          currentChunk.length >= this.maxNodesPerChunk) &&
        currentChunk.length > 0
      ) {
        chunks.push([...currentChunk]);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(node);
      currentSize += nodeSize;
    }

    // 마지막 청크 추가
    if (currentChunk.length > 0) {
      chunks.push([...currentChunk]);
    }

    this.logChunkingResult(nodes.length, chunks.length);

    return chunks;
  }

  /**
   * 현재 청크 설정 정보 반환
   * 
   * @returns 현재 설정 { maxChunkSize, maxNodesPerChunk }
   */
  getConfig(): { maxChunkSize: number; maxNodesPerChunk: number } {
    return {
      maxChunkSize: this.maxChunkSize,
      maxNodesPerChunk: this.maxNodesPerChunk,
    };
  }

  /**
   * 청크 설정 동적 조정 (API 오류 시 사용)
   * 
   * API 오류 발생 시 호출하여 청크 크기를 점진적으로 감소
   * 이를 통해 JSON 구조 복잡도 감소 → 오류 재시도 가능
   * 
   * @param reduceBy 감소량 (기본값: 1)
   *   - maxChunkSize: (reduceBy * 100)만큼 감소
   *   - maxNodesPerChunk: reduceBy만큼 감소
   * 
   * @example
   * try {
   *   await translateEpubChunk(chunk);
   * } catch (error) {
   *   epubChunkService.adjustChunkSize(2); // 더 작게 분할
   *   // 재시도...
   * }
   */
  adjustChunkSize(reduceBy: number = 1): void {
    const prevSize = this.maxChunkSize;
    const prevNodes = this.maxNodesPerChunk;

    this.maxChunkSize = Math.max(1000, this.maxChunkSize - reduceBy * 100);
    this.maxNodesPerChunk = Math.max(5, this.maxNodesPerChunk - reduceBy);

    console.warn(
      `⚠️ 청크 크기 감소: ` +
        `${prevSize}자 → ${this.maxChunkSize}자, ` +
        `${prevNodes}개 → ${this.maxNodesPerChunk}개 노드/청크`
    );
  }

  /**
   * 청크 설정 수동 변경
   * 
   * @param maxChunkSize 새 최대 문자 크기
   * @param maxNodesPerChunk 새 최대 노드 개수
   */
  setConfig(maxChunkSize: number, maxNodesPerChunk: number): void {
    this.maxChunkSize = Math.max(1000, maxChunkSize);
    this.maxNodesPerChunk = Math.max(5, maxNodesPerChunk);

    console.log(
      `📦 청크 설정 변경: ${this.maxChunkSize}자, ${this.maxNodesPerChunk}개 노드/청크`
    );
  }

  /**
   * 특정 노드 배열에서 텍스트 노드만 필터링
   * 
   * @param nodes 원본 노드 배열
   * @returns 텍스트 노드만 포함된 배열
   */
  filterTextNodes(nodes: EpubNode[]): EpubNode[] {
    return nodes.filter((node) => node.type === 'text');
  }

  /**
   * 청킹 결과 로그
   * 
   * @param totalNodes 전체 노드 개수
   * @param totalChunks 전체 청크 개수
   */
  private logChunkingResult(totalNodes: number, totalChunks: number): void {
    const avgNodesPerChunk = (totalNodes / totalChunks).toFixed(1);
    console.log(
      `📦 EPUB 청킹 완료: ${totalNodes}개 노드 → ${totalChunks}개 청크 ` +
        `(청크당 평균 ${avgNodesPerChunk}개 노드, 최대 ${this.maxChunkSize}자 / ${this.maxNodesPerChunk}개 노드)`
    );
  }

  /**
   * 청크 통계 정보 반환
   * 
   * @param nodes 원본 노드 배열
   * @returns 통계 정보
   */
  getChunkStats(nodes: EpubNode[]): {
    totalNodes: number;
    textNodes: number;
    totalChars: number;
    estimatedChunks: number;
  } {
    const textNodes = this.filterTextNodes(nodes);
    const totalChars = textNodes.reduce((sum, node) => sum + (node.content?.length ?? 0), 0);
    const chunks = this.splitEpubNodesIntoChunks(nodes);

    return {
      totalNodes: nodes.length,
      textNodes: textNodes.length,
      totalChars,
      estimatedChunks: chunks.length,
    };
  }

  /**
   * 청크 통계 정보 포매팅 (로그용)
   * 
   * @param nodes 원본 노드 배열
   * @returns 포매팅된 문자열
   */
  formatStats(nodes: EpubNode[]): string {
    const stats = this.getChunkStats(nodes);
    return (
      `📊 EPUB 청킹 통계:\n` +
      `  - 전체 노드: ${stats.totalNodes}개\n` +
      `  - 텍스트 노드: ${stats.textNodes}개\n` +
      `  - 전체 문자: ${stats.totalChars.toLocaleString()}자\n` +
      `  - 예상 청크: ${stats.estimatedChunks}개`
    );
  }
}

// 싱글톤 인스턴스 export (기본값: 5000자, 30노드/청크)
export const epubChunkService = new EpubChunkService(5000, 30);
