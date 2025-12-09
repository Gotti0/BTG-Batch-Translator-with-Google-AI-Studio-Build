
// hooks/useTranslation.ts
// 번역 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { TranslationService } from '../services/TranslationService';
import { ChunkService } from '../services/ChunkService';
import { EpubService } from '../services/EpubService';
import type { TranslationJobProgress, TranslationResult, TranslationSnapshot, FileContent } from '../types/dtos';

/**
 * 번역 기능을 제공하는 커스텀 훅
 * TranslationService와 스토어를 연결합니다.
 */
export function useTranslation() {
  // 스토어 상태
  const { config, updateConfig } = useSettingsStore();
  const { entries: glossaryEntries } = useGlossaryStore();
  const {
    inputFiles,
    isRunning,
    isPaused,
    progress,
    results,
    translatedText,
    startTranslation,
    stopTranslation,
    updateProgress,
    setResults,
    addResult,
    updateResult,
    setTranslatedText,
    combineResultsToText, // 텍스트 재합성 함수 가져오기
    addLog,
    restoreSession,
  } = useTranslationStore();

  // 서비스 인스턴스 참조
  const serviceRef = useRef<TranslationService | null>(null);
  const isTranslatingRef = useRef(false);

  // 서비스 초기화 또는 업데이트
  const getOrCreateService = useCallback((): TranslationService => {
    if (!serviceRef.current) {
      serviceRef.current = new TranslationService(config);
      
      // 로그 콜백 설정
      serviceRef.current.setLogCallback((entry) => {
        addLog(entry.level, entry.message);
      });
    } else {
      // 설정 업데이트
      serviceRef.current.updateConfig(config);
    }

    // 용어집 설정
    serviceRef.current.setGlossaryEntries(glossaryEntries);

    return serviceRef.current;
  }, [config, glossaryEntries, addLog]);

  // 번역 시작
  const executeTranslation = useCallback(async () => {
    if (inputFiles.length === 0) {
      addLog('warning', '번역할 파일을 선택해주세요.');
      return;
    }

    if (isTranslatingRef.current) {
      addLog('warning', '이미 번역이 진행 중입니다.');
      return;
    }

    // results 변수는 클로저에 의해 캡처된 상태이므로 startTranslation() 호출 전의 값을 가집니다.
    // 따라서 resume 기능을 위한 기존 결과를 여기서 확보할 수 있습니다.
    const existingResults = results.length > 0 ? results : undefined;

    isTranslatingRef.current = true;
    startTranslation();

    try {
      const service = getOrCreateService();

      // 모든 파일의 내용을 합침
      const fullText = inputFiles.map(f => f.content).join('\n\n');
      
      addLog('info', `총 ${inputFiles.length}개 파일, ${fullText.length.toLocaleString()}자 번역 시작`);
      addLog('info', `모델: ${config.modelName}, 청크 크기: ${config.chunkSize}`);

      // 진행률 콜백
      const onProgress = (progress: TranslationJobProgress) => {
        updateProgress(progress);
      };

      // 실시간 결과 콜백
      const onResult = (result: TranslationResult) => {
        addResult(result);
      };

      // 번역 실행
      const translationResults = await service.translateText(
        fullText, 
        onProgress, 
        existingResults,
        onResult
      );

      // 결과 저장 (최종 동기화 보장)
      setResults(translationResults);

      // 결과 텍스트 합치기
      const combinedText = TranslationService.combineResults(translationResults);
      setTranslatedText(combinedText);

      // 완료 로그
      const successCount = translationResults.filter(r => r.success).length;
      const failCount = translationResults.filter(r => !r.success).length;
      
      addLog('info', `번역 완료: 성공 ${successCount}개, 실패 ${failCount}개`);

      if (failCount > 0) {
        addLog('warning', `${failCount}개 청크가 번역에 실패했습니다. 검토 탭에서 확인하세요.`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `번역 중 오류 발생: ${errorMessage}`);
      
      updateProgress({
        totalChunks: 0,
        processedChunks: 0,
        successfulChunks: 0,
        failedChunks: 0,
        currentStatusMessage: `오류: ${errorMessage}`,
        lastErrorMessage: errorMessage,
      });
    } finally {
      isTranslatingRef.current = false;
      stopTranslation();
    }
  }, [
    inputFiles,
    config,
    results, // existingResults 참조를 위해 추가
    getOrCreateService,
    startTranslation,
    stopTranslation,
    updateProgress,
    setResults,
    addResult,
    setTranslatedText,
    addLog,
  ]);

  // 번역 중지
  const cancelTranslation = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.requestStop();
    }
    stopTranslation();
    addLog('warning', '번역이 사용자에 의해 중단되었습니다.');
  }, [stopTranslation, addLog]);

  // 실패한 청크 재번역
  const retryFailedChunks = useCallback(async () => {
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length === 0) {
      addLog('info', '재시도할 실패한 청크가 없습니다.');
      return;
    }

    if (isTranslatingRef.current) {
      addLog('warning', '이미 번역이 진행 중입니다.');
      return;
    }

    isTranslatingRef.current = true;
    addLog('info', `${failedResults.length}개 실패한 청크 재번역 시작`);

    try {
      const service = getOrCreateService();
      
      const retriedResults = await service.retryFailedChunks(
        results,
        (progress) => updateProgress(progress),
        (result) => {
          updateResult(result.chunkIndex, result);
        }
      );

      // 결과 업데이트 (최종 동기화)
      setResults(retriedResults);
      
      // 텍스트 재합성
      const combinedText = TranslationService.combineResults(retriedResults);
      setTranslatedText(combinedText);

      const newSuccessCount = retriedResults.filter(r => r.success).length;
      addLog('info', `재번역 완료: ${newSuccessCount}/${failedResults.length}개 성공`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `재번역 중 오류: ${errorMessage}`);
    } finally {
      isTranslatingRef.current = false;
    }
  }, [results, getOrCreateService, updateProgress, setResults, updateResult, setTranslatedText, addLog]);

  // [NEW] 단일 청크 즉시 재번역
  const retrySingleChunk = useCallback(async (chunkIndex: number) => {
    // 1. 작업 중복 방지 체크
    if (isTranslatingRef.current) {
      addLog('warning', '이미 다른 작업이 진행 중입니다.');
      return;
    }

    // 2. 대상 청크 데이터 확보
    const targetResult = results.find(r => r.chunkIndex === chunkIndex);
    if (!targetResult) {
      addLog('error', `청크 #${chunkIndex + 1} 정보를 찾을 수 없습니다.`);
      return;
    }

    isTranslatingRef.current = true;
    addLog('info', `청크 #${chunkIndex + 1} 개별 재번역 시작...`);

    try {
      const service = getOrCreateService();
      
      // 3. 단일 청크 번역 요청 (안전 모드 재시도 활성화)
      const newResult = await service.translateChunk(
        targetResult.originalText,
        chunkIndex,
        true 
      );

      // 4. 결과 업데이트 및 전체 텍스트 동기화
      updateResult(chunkIndex, newResult);
      combineResultsToText(); // 전체 텍스트 갱신

      if (newResult.success) {
        addLog('info', `청크 #${chunkIndex + 1} 재번역 완료`);
      } else {
        addLog('error', `청크 #${chunkIndex + 1} 재번역 실패: ${newResult.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `재번역 오류: ${errorMessage}`);
    } finally {
      isTranslatingRef.current = false;
    }
  }, [results, getOrCreateService, updateResult, combineResultsToText, addLog]);

  // 결과 다운로드
  const downloadResult = useCallback((filename?: string) => {
    if (!translatedText) {
      addLog('warning', '다운로드할 번역 결과가 없습니다.');
      return;
    }

    const blob = new Blob([translatedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `translated_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `번역 결과가 다운로드되었습니다: ${a.download}`);
  }, [translatedText, addLog]);

  // === 작업 이어하기(Snapshot) 기능 ===

  /**
   * 현재 작업을 스냅샷(JSON)으로 내보내기
   */
  /**
   * Phase 5: EPUB 파일을 Base64로 인코딩
   */
  const encodeEpubToBase64 = useCallback(async (epubFile: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        // data:application/octet-stream;base64,... 형식에서 base64 부분만 추출
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('EPUB 파일 인코딩 실패'));
      reader.readAsDataURL(epubFile);
    });
  }, []);

  const exportSnapshot = useCallback(async (mode: 'text' | 'epub' = 'text', epubChapters?: any[]) => {
    if (inputFiles.length === 0) {
      addLog('warning', '내보낼 작업이 없습니다.');
      return;
    }

    const successfulChunks = results.filter(r => r.success);
    const totalChunks = progress?.totalChunks || results.length;
    
    const sourceText = inputFiles.map(f => f.content).join('\n\n');
    
    // Snake Case로 변환
    const snapshot: TranslationSnapshot = {
      meta: {
        version: '1.0',
        created_at: new Date().toISOString(),
        app_version: '0.0.3',
      },
      source_info: {
        file_name: inputFiles[0]?.name || 'unknown.txt',
        file_size: sourceText.length,
      },
      config: {
        chunk_size: config.chunkSize,
        model_name: config.modelName,
        prompt_template: config.prompts,
      },
      // Phase 5: 번역 모드 추가
      mode: mode,
      source_text: sourceText,
      progress: {
        total_chunks: totalChunks,
        processed_chunks: successfulChunks.length,
      },
      translated_chunks: {},
    };

    // 청크 맵핑
    results.forEach(result => {
      if (result.success) {
        snapshot.translated_chunks[result.chunkIndex.toString()] = {
          original_text: result.originalText,
          translated_text: result.translatedText,
          status: 'success',
        };
      }
    });

    // Phase 5: EPUB 모드인 경우 추가 정보 저장
    if (mode === 'epub' && epubChapters && epubChapters.length > 0) {
      snapshot.epub_structure = {
        chapters: epubChapters.map((ch: any) => ({
          id: ch.id || '',
          filename: ch.filename || '',
          nodeCount: ch.nodes?.length || 0,
        })),
      };

      // EPUB 바이너리 인코딩 (원본 파일)
      const epubFile = inputFiles[0]?.epubFile;
      if (epubFile) {
        try {
          const base64Binary = await encodeEpubToBase64(epubFile);
          snapshot.epub_binary = base64Binary;
          addLog('info', '✅ EPUB 바이너리 인코딩 완료');
        } catch (error) {
          addLog('warning', `EPUB 바이너리 저장 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // 파일 다운로드
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `btg_snapshot_${mode}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `작업 스냅샷이 저장되었습니다 (${mode}): ${a.download}`);
  }, [inputFiles, results, progress, config, addLog, encodeEpubToBase64]);

  /**
   * Phase 5: Base64에서 EPUB 파일로 디코딩
   */
  const decodeBase64ToEpub = useCallback(async (base64: string, filename: string): Promise<File> => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/epub+zip' });
    return new File([blob], filename, { type: 'application/epub+zip' });
  }, []);

  /**
   * 스냅샷(JSON) 파일을 불러와 작업 복구
   */
  const importSnapshot = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const snapshot: TranslationSnapshot = JSON.parse(text);

      // 1. 유효성 검사
      if (!snapshot.source_text || !snapshot.config?.chunk_size) {
        addLog('error', '유효하지 않은 스냅샷 파일입니다. (필수 필드 누락)');
        return;
      }

      // 2. 설정 복구 (청크 사이즈가 가장 중요)
      updateConfig({
        chunkSize: snapshot.config.chunk_size,
        modelName: snapshot.config.model_name || config.modelName,
        prompts: snapshot.config.prompt_template || config.prompts,
      });

      addLog('info', `설정이 복구되었습니다. (청크 크기: ${snapshot.config.chunk_size})`);

      // Phase 5: EPUB 모드 확인 및 처리
      const snapshotMode = snapshot.mode || 'text';
      addLog('info', `📋 스냅샷 모드: ${snapshotMode}`);

      // EPUB 모드인 경우 바이너리 디코딩 및 복구
      if (snapshotMode === 'epub' && snapshot.epub_binary && snapshot.epub_structure) {
        try {
          addLog('info', '📦 EPUB 바이너리 디코딩 중...');
          const epubFile = await decodeBase64ToEpub(
            snapshot.epub_binary,
            snapshot.source_info.file_name || 'restored.epub'
          );

          // EpubService를 사용해 파싱
          const epubService = new EpubService();
          const restoredEpubChapters = await epubService.parseEpubFile(epubFile);
          
          addLog('info', `✅ EPUB 복구 완료: ${restoredEpubChapters.length}개 챕터`);

          // 3. EPUB 파일 정보 복구
          const restoredFile: FileContent = {
            name: snapshot.source_info.file_name || 'restored.epub',
            content: `[EPUB File] ${restoredEpubChapters.length} chapters loaded`,
            size: snapshot.source_info.file_size || 0,
            lastModified: Date.now(),
            epubFile: epubFile,
            epubChapters: restoredEpubChapters,
            isEpub: true,
          };

          // 4. EPUB 노드 기반 결과 복구 (ID 기반 매칭)
          const restoredResults: TranslationResult[] = [];
          let successfulCount = 0;
          let nodeIndex = 0;

          for (const chapter of restoredEpubChapters) {
            for (const node of chapter.nodes || []) {
              const nodeId = node.id || nodeIndex.toString();
              const savedChunk = snapshot.translated_chunks[nodeId];

              if (savedChunk && savedChunk.status === 'success') {
                restoredResults.push({
                  chunkIndex: nodeIndex,
                  originalText: node.content || savedChunk.original_text,
                  translatedText: savedChunk.translated_text,
                  success: true,
                });
                successfulCount++;
              }
              nodeIndex++;
            }
          }

          // 5. 스토어 상태 복구 (EPUB 모드)
          const totalNodes = restoredEpubChapters.reduce((sum: number, ch: any) => sum + (ch.nodes?.length || 0), 0);
          const restoredProgress: TranslationJobProgress = {
            totalChunks: totalNodes,
            processedChunks: successfulCount,
            successfulChunks: successfulCount,
            failedChunks: 0,
            currentStatusMessage: `EPUB 복구 완료. ${totalNodes}개 노드, ${successfulCount}개 번역됨.`,
          };

          restoreSession([restoredFile], restoredResults, restoredProgress);
          
          // Phase 5: 사용자에게 EPUB 모드 복구 알림
          addLog('info', `🎉 EPUB 스냅샷 복구 완료. 현재 모드: EPUB 번역`);

          return snapshotMode; // 호출자에서 모드 설정 가능
        } catch (error) {
          addLog('error', `EPUB 복구 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // 실패 시 텍스트 모드로 폴백
        }
      }

      // 3. 원본 텍스트 재구성 (텍스트 모드)
      const restoredFile: FileContent = {
        name: snapshot.source_info.file_name || 'restored_source.txt',
        content: snapshot.source_text,
        size: snapshot.source_info.file_size || 0,
        lastModified: Date.now(),
      };

      // 4. 청크 재분할 및 결과 매핑
      // 청크 서비스 직접 사용해 원본을 다시 나눔
      const chunkService = new ChunkService(snapshot.config.chunk_size);
      const chunks = chunkService.splitTextIntoChunks(snapshot.source_text);
      
      const restoredResults: TranslationResult[] = [];
      let successfulCount = 0;

      chunks.forEach((chunkText, index) => {
        const savedChunk = snapshot.translated_chunks[index.toString()];
        
        if (savedChunk && savedChunk.status === 'success') {
          // 저장된 결과가 있는 경우
          restoredResults.push({
            chunkIndex: index,
            originalText: chunkText, // 스냅샷의 original_text 대신 재분할된 텍스트 사용 (정합성 보장)
            translatedText: savedChunk.translated_text,
            success: true,
          });
          successfulCount++;
        } else {
          // 결과가 없는 경우 (미번역) - 나중에 번역될 때 채워짐
        }
      });

      // 5. 스토어 상태 복구 (텍스트 모드)
      const restoredProgress: TranslationJobProgress = {
        totalChunks: chunks.length,
        processedChunks: successfulCount,
        successfulChunks: successfulCount,
        failedChunks: 0,
        currentStatusMessage: '작업 복구 완료. 번역 시작을 눌러 이어하세요.',
      };

      restoreSession([restoredFile], restoredResults, restoredProgress);

      addLog('info', `작업이 복구되었습니다. 총 ${chunks.length}개 중 ${successfulCount}개 완료됨.`);
      addLog('info', '번역 시작 버튼을 누르면 나머지 구간부터 작업을 이어갑니다.');
      
      // Phase 5: 복구된 모드 반환 (호출자가 mode 상태 업데이트 가능)
      return snapshotMode;

    } catch (error) {
      addLog('error', `스냅샷 불러오기 실패: ${error}`);
      console.error(error);
    }
  }, [config, updateConfig, restoreSession, addLog, decodeBase64ToEpub]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (serviceRef.current) {
        serviceRef.current.requestStop();
      }
    };
  }, []);

  return {
    // 상태
    inputFiles,
    isRunning,
    isPaused,
    progress,
    results,
    translatedText,
    
    // 액션
    executeTranslation,
    cancelTranslation,
    retryFailedChunks,
    retrySingleChunk, // [NEW]
    downloadResult,
    
    // 스냅샷 액션
    exportSnapshot,
    importSnapshot,
    
    // 상태 확인
    canStart: inputFiles.length > 0 && !isRunning,
    canStop: isRunning,
    hasFailedChunks: results.some(r => !r.success),
    hasResults: results.length > 0,
  };
}
