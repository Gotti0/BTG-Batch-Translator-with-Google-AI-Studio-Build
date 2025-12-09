import { useMemo, useState } from 'react';
import type { FileContent, TranslationResult } from '../types/dtos';

export interface EpubChunkMeta {
  fileName: string;     // 챕터 파일명
  tag?: string;         // 태그 정보 (h1, p 등)
  imagePath?: string;   // 이미지 경로
  epubFile?: File;      // 원본 파일 (이미지 로딩용)
}

export function useEpubReview(inputFiles: FileContent[], results: TranslationResult[]) {
  // 1. EPUB 모드 감지
  const isEpubMode = useMemo(() => inputFiles.length > 0 && inputFiles[0].isEpub, [inputFiles]);
  
  // 2. 챕터 목록 및 선택 상태 관리
  const [selectedChapter, setSelectedChapter] = useState<string | 'all'>('all');

  // 3. 청크 매핑 (O(1) 조회를 위해 Map 생성)
  const chunkMetaMap = useMemo(() => {
    if (!isEpubMode || !inputFiles[0].epubChapters) return null;

    const map = new Map<number, EpubChunkMeta>();
    let globalNodeIndex = 0;
    const epubFile = inputFiles[0].epubFile;

    inputFiles[0].epubChapters.forEach((chapter: any) => {
      chapter.nodes.forEach((node: any) => {
        map.set(globalNodeIndex, {
          fileName: chapter.fileName,
          tag: node.tag,
          imagePath: node.imagePath,
          epubFile // 원본 파일 참조 전달
        });
        globalNodeIndex++;
      });
    });

    return map;
  }, [isEpubMode, inputFiles]);

  // 4. 챕터 목록 추출
  const chapters = useMemo(() => {
    if (!isEpubMode || !inputFiles[0].epubChapters) return [];
    return inputFiles[0].epubChapters.map((ch: any) => ch.fileName);
  }, [isEpubMode, inputFiles]);

  // 5. 헬퍼 함수: 특정 청크의 메타데이터 조회
  const getChunkMeta = (chunkIndex: number): EpubChunkMeta | undefined => {
    return chunkMetaMap?.get(chunkIndex);
  };

  // 텍스트 모드일 경우 최소한의 정보만 반환
  if (!isEpubMode) {
    return {
      isEpubMode: false,
      chapters: [],
      selectedChapter: 'all',
      setSelectedChapter: () => {},
      getChunkMeta: () => undefined,
      filterByChapter: (results: TranslationResult[]) => results
    };
  }

  // EPUB 모드일 경우 기능 반환
  return {
    isEpubMode: true,
    chapters,
    selectedChapter,
    setSelectedChapter,
    getChunkMeta,
    // 필터링 로직도 훅 내부로 캡슐화
    filterByChapter: (results: TranslationResult[]) => {
      if (selectedChapter === 'all') return results;
      return results.filter(r => {
        const meta = chunkMetaMap?.get(r.chunkIndex);
        return meta && meta.fileName === selectedChapter;
      });
    }
  };
}
