
// hooks/useTranslation.ts
// 번역 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { TranslationService } from '../services/TranslationService';
import { ChunkService } from '../services/ChunkService';
import { EpubService } from '../services/EpubService';
import { EpubChunkService } from '../services/EpubChunkService';
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

  /**
   * 현재 작업을 스냅샷(JSON)으로 내보내기
   */
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
        
        // 추가 설정 저장
        temperature: config.temperature,
        requests_per_minute: config.requestsPerMinute,
        max_workers: config.maxWorkers,
        
        enable_prefill_translation: config.enablePrefillTranslation,
        prefill_system_instruction: config.prefillSystemInstruction,
        prefill_cached_history: config.prefillCachedHistory,
        
        enable_dynamic_glossary_injection: config.enableDynamicGlossaryInjection,
        max_glossary_entries_per_chunk_injection: config.maxGlossaryEntriesPerChunkInjection,
        max_glossary_chars_per_chunk_injection: config.maxGlossaryCharsPerChunkInjection,
        glossary_extraction_prompt: config.glossaryExtractionPrompt,
        
        enable_image_annotation: config.enableImageAnnotation,
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
        // 기본 키는 인덱스 (텍스트 모드용)
        // EPUB 모드에서도 청크 인덱스를 키로 사용합니다. 
        // (이전의 nodeIdMap 로직은 청크!=노드 일 때 오류 발생 가능성 있음)
        const key = result.chunkIndex.toString();
        
        snapshot.translated_chunks[key] = {
          original_text: result.originalText,
          translated_text: result.translatedText,
          // [추가] 세그먼트 배열이 있으면 함께 저장
          translated_segments: result.translatedSegments, 
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
  const importSnapshot = useCallback(async (file: File): Promise<{ mode: string; epubChapters?: any[] } | void> => {
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
        
        // 추가 설정 복구 (값이 있는 경우에만)
        temperature: snapshot.config.temperature ?? config.temperature,
        requestsPerMinute: snapshot.config.requests_per_minute ?? config.requestsPerMinute,
        maxWorkers: snapshot.config.max_workers ?? config.maxWorkers,
        
        enablePrefillTranslation: snapshot.config.enable_prefill_translation ?? config.enablePrefillTranslation,
        prefillSystemInstruction: snapshot.config.prefill_system_instruction ?? config.prefillSystemInstruction,
        prefillCachedHistory: snapshot.config.prefill_cached_history ?? config.prefillCachedHistory,
        
        enableDynamicGlossaryInjection: snapshot.config.enable_dynamic_glossary_injection ?? config.enableDynamicGlossaryInjection,
        maxGlossaryEntriesPerChunkInjection: snapshot.config.max_glossary_entries_per_chunk_injection ?? config.maxGlossaryEntriesPerChunkInjection,
        maxGlossaryCharsPerChunkInjection: snapshot.config.max_glossary_chars_per_chunk_injection ?? config.maxGlossaryCharsPerChunkInjection,
        glossaryExtractionPrompt: snapshot.config.glossary_extraction_prompt ?? config.glossaryExtractionPrompt,
        
        enableImageAnnotation: snapshot.config.enable_image_annotation ?? config.enableImageAnnotation,
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

          // 4. EPUB 노드 기반 결과 복구 (세그먼트 매핑 방식)
          // 기존의 청크 1:1 매칭 방식은 청크 설정이 달라지면 실패하므로,
          // '모든 번역된 세그먼트'를 수집하여 '새로운 청크'에 순차적으로 매핑하는 방식을 사용합니다.
          
          const restoredResults: TranslationResult[] = [];
          let successfulCount = 0;

          // 4-1. 스냅샷에서 유효한 세그먼트 수집 (연속성 보장)
          const sortedKeys = Object.keys(snapshot.translated_chunks)
            .map(k => parseInt(k))
            .sort((a, b) => a - b);
            
          const allSegments: string[] = [];
          let lastIndex = -1;
          
          for (const key of sortedKeys) {
             // 연속된 청크인지 확인 (중간에 실패한 청크가 있으면 거기까지만 복구)
             if (key !== lastIndex + 1) {
                addLog('warning', `스냅샷에 누락된 청크(인덱스 ${lastIndex + 1})가 있어, 이후 데이터는 제외됩니다.`);
                break;
             }
             
             const chunkData = snapshot.translated_chunks[key.toString()];
             if (chunkData.status === 'success' && chunkData.translated_segments) {
                allSegments.push(...chunkData.translated_segments);
             } else if (chunkData.status === 'success' && !chunkData.translated_segments) {
                // 레거시 스냅샷 (세그먼트 정보 없음) - 복구 불가 (또는 텍스트 분할 시도)
                // 여기서는 안전을 위해 중단
                addLog('warning', `청크 ${key}에 세그먼트 정보가 없어 복구를 중단합니다.`);
                break;
             } else {
                // 실패한 청크
                break;
             }
             lastIndex = key;
          }
          
          addLog('info', `복원 가능한 번역 세그먼트: ${allSegments.length}개`);

          // 4-2. 현재 설정으로 EPUB 재청킹
          const epubChunkService = new EpubChunkService(
            snapshot.config.chunk_size,
            30 // 기본값
          );
          
          const allNodes = restoredEpubChapters.flatMap((ch: any) => ch.nodes);
          const newChunks = epubChunkService.splitEpubNodesIntoChunks(allNodes);
          
          // 4-3. 세그먼트 매핑 전략 결정 및 실행
          let segmentOffset = 0;
          
          // 전략 감지: 첫 번째 청크를 기준으로 판단
          // 스냅샷의 세그먼트 개수가 해당 청크의 '전체 노드 수'와 일치하는지, '텍스트 노드 수'와 일치하는지 확인
          let isAllNodesMode = true; // 기본값: 모든 노드 포함 (현재 방식)
          
          if (newChunks.length > 0 && sortedKeys.length > 0) {
             const firstChunkIdx = sortedKeys[0];
             // newChunks[firstChunkIdx]가 존재한다고 가정 (인덱스가 0부터 시작하므로)
             if (firstChunkIdx < newChunks.length) {
                 const sampleChunk = newChunks[firstChunkIdx];
                 const sampleSnapshotData = snapshot.translated_chunks[firstChunkIdx.toString()];
                 
                 if (sampleSnapshotData && sampleSnapshotData.translated_segments) {
                     const segmentLen = sampleSnapshotData.translated_segments.length;
                     const totalLen = sampleChunk.length;
                     const textLen = sampleChunk.filter((n: any) => n.type === 'text').length;
                     
                     if (segmentLen === textLen && segmentLen !== totalLen) {
                         isAllNodesMode = false;
                         addLog('info', '매핑 전략: 텍스트 노드 전용 모드 감지');
                     } else {
                         addLog('info', '매핑 전략: 전체 노드 모드 감지 (비텍스트 포함)');
                     }
                 }
             }
          }

          for (let i = 0; i < newChunks.length; i++) {
             const chunk = newChunks[i];
             const chunkTextNodes = chunk.filter((n: any) => n.type === 'text');
             
             // 필요한 세그먼트 개수 계산
             const requiredSegments = isAllNodesMode ? chunk.length : chunkTextNodes.length;
             
             // 현재 청크를 채울 만큼 세그먼트가 충분한지 확인
             if (segmentOffset + requiredSegments <= allSegments.length) {
                const chunkSegments = allSegments.slice(segmentOffset, segmentOffset + requiredSegments);
                
                // 원본 텍스트 구성
                const originalText = chunk.map((n: any) => n.content || '').join('\n\n');
                
                let segmentIdx = 0;
                const translatedParts = chunk.map((n: any) => {
                    if (isAllNodesMode) {
                        // 전체 노드 모드: 노드 타입 상관없이 1:1 매핑
                        return chunkSegments[segmentIdx++] || '';
                    } else {
                        // 텍스트 노드 모드: 텍스트 노드일 때만 세그먼트 소비
                        if (n.type === 'text') {
                            return chunkSegments[segmentIdx++] || '';
                        }
                        return n.content || ''; // 비텍스트는 원본 유지
                    }
                });
                
                const translatedText = translatedParts.join('\n\n');

                restoredResults.push({
                   chunkIndex: i,
                   originalText: originalText,
                   translatedText: translatedText,
                   translatedSegments: chunkSegments, // 원본 세그먼트 보존
                   success: true
                });
                
                segmentOffset += requiredSegments;
                successfulCount++;
             } else {
                // 세그먼트 부족으로 중단 (나머지는 미번역 상태로 남음)
                break;
             }
          }

          // 5. 스토어 상태 복구 (EPUB 모드)
          const restoredProgress: TranslationJobProgress = {
            totalChunks: newChunks.length, // 새로운 청크 개수 기준
            processedChunks: successfulCount,
            successfulChunks: successfulCount,
            failedChunks: 0,
            currentStatusMessage: `EPUB 복구 완료. ${newChunks.length}개 청크 중 ${successfulCount}개 복원됨.`,
          };

          restoreSession([restoredFile], restoredResults, restoredProgress);
          
          // Phase 5: 사용자에게 EPUB 모드 복구 알림
          addLog('info', `🎉 EPUB 스냅샷 복구 완료. 현재 모드: EPUB 번역`);

          return { mode: snapshotMode, epubChapters: restoredEpubChapters }; // 호출자에서 모드 설정 가능
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
      return { mode: snapshotMode };

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
