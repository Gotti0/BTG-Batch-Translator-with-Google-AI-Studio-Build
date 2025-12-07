// hooks/useGlossary.ts
// 용어집 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useGlossaryStore } from '../stores/glossaryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTranslationStore } from '../stores/translationStore';
import { GlossaryService } from '../services/GlossaryService';
import type { GlossaryExtractionProgress, GlossaryEntry } from '../types/dtos';

/**
 * 용어집 기능을 제공하는 커스텀 훅
 * GlossaryService와 스토어를 연결합니다.
 */
export function useGlossary() {
  // 스토어 상태
  const { config } = useSettingsStore();
  const { inputFiles } = useTranslationStore();
  const {
    entries,
    isExtracting,
    extractionProgress,
    startExtraction,
    stopExtraction,
    updateExtractionProgress,
    mergeEntries,
    setEntries,
    clearEntries,
    exportToJson,
    importFromJson,
  } = useGlossaryStore();

  // 로그 추가 함수
  const { addLog } = useTranslationStore();

  // 서비스 인스턴스 참조
  const serviceRef = useRef<GlossaryService | null>(null);
  const isExtractingRef = useRef(false);

  // 서비스 초기화 또는 업데이트
  const getOrCreateService = useCallback((): GlossaryService => {
    if (!serviceRef.current) {
      serviceRef.current = new GlossaryService(config);
      
      // 로그 콜백 설정
      serviceRef.current.setLogCallback((entry) => {
        addLog(entry.level, entry.message);
      });
    } else {
      // 설정 업데이트
      serviceRef.current.updateConfig(config);
    }

    return serviceRef.current;
  }, [config, addLog]);

  // 용어집 추출 시작
  const executeExtraction = useCallback(async (sourceText?: string) => {
    if (isExtractingRef.current) {
      addLog('warning', '이미 용어집 추출이 진행 중입니다.');
      return;
    }

    // 소스 텍스트 결정 (파라미터로 전달되거나 입력 파일에서)
    let textToAnalyze = sourceText;
    
    if (!textToAnalyze) {
      if (inputFiles.length === 0) {
        addLog('warning', '분석할 텍스트가 없습니다. 파일을 업로드하거나 텍스트를 입력하세요.');
        return;
      }
      textToAnalyze = inputFiles.map(f => f.content).join('\n\n');
    }

    isExtractingRef.current = true;
    startExtraction();

    try {
      const service = getOrCreateService();

      addLog('info', `용어집 추출 시작 (모델: ${config.modelName})`);
      addLog('info', `분석할 텍스트: ${textToAnalyze.length.toLocaleString()}자`);

      // 진행률 콜백
      const onProgress = (progress: GlossaryExtractionProgress) => {
        updateExtractionProgress(progress);
      };

      // 중지 체크 콜백
      const stopCheck = () => !isExtractingRef.current;

      // 기존 항목을 시드로 사용
      const seedEntries = entries.length > 0 ? entries : undefined;

      // 용어집 추출 실행
      const extractedEntries = await service.extractGlossary(
        textToAnalyze,
        onProgress,
        seedEntries,
        config.glossaryExtractionPrompt,
        stopCheck
      );

      // 결과 저장 (기존 항목과 병합)
      if (extractedEntries.length > 0) {
        mergeEntries(extractedEntries);
        addLog('info', `용어집 추출 완료: ${extractedEntries.length}개 항목`);
      } else {
        addLog('warning', '추출된 용어집 항목이 없습니다.');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `용어집 추출 중 오류 발생: ${errorMessage}`);
      
      updateExtractionProgress({
        totalSegments: 0,
        processedSegments: 0,
        currentStatusMessage: `오류: ${errorMessage}`,
        extractedEntriesCount: entries.length,
      });
    } finally {
      isExtractingRef.current = false;
      stopExtraction();
    }
  }, [
    inputFiles,
    config,
    entries,
    getOrCreateService,
    startExtraction,
    stopExtraction,
    updateExtractionProgress,
    mergeEntries,
    addLog,
  ]);

  // 용어집 추출 중지
  const cancelExtraction = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.requestStop();
    }
    isExtractingRef.current = false;
    stopExtraction();
    addLog('warning', '용어집 추출이 사용자에 의해 중단되었습니다.');
  }, [stopExtraction, addLog]);

  // 용어집 JSON 다운로드
  const downloadGlossary = useCallback((filename?: string) => {
    if (entries.length === 0) {
      addLog('warning', '다운로드할 용어집이 없습니다.');
      return;
    }

    const json = exportToJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `glossary_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `용어집이 다운로드되었습니다: ${a.download}`);
  }, [entries, exportToJson, addLog]);

  // 용어집 CSV 다운로드
  const downloadGlossaryCsv = useCallback((filename?: string) => {
    if (entries.length === 0) {
      addLog('warning', '다운로드할 용어집이 없습니다.');
      return;
    }

    // CSV 형식으로 변환
    const headers = ['keyword', 'translatedKeyword', 'targetLanguage', 'occurrenceCount'];
    const csvRows = [headers.join(',')];
    
    for (const entry of entries) {
      const row = [
        `"${entry.keyword.replace(/"/g, '""')}"`,
        `"${entry.translatedKeyword.replace(/"/g, '""')}"`,
        entry.targetLanguage,
        entry.occurrenceCount.toString(),
      ];
      csvRows.push(row.join(','));
    }

    const csv = csvRows.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM 추가
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `glossary_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `용어집 CSV가 다운로드되었습니다: ${a.download}`);
  }, [entries, addLog]);

  // 용어집 파일 가져오기
  const importGlossaryFile = useCallback(async () => {
    try {
      // 파일 선택 대화상자
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.csv';
      
      return new Promise<boolean>((resolve) => {
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) {
            resolve(false);
            return;
          }

          try {
            const content = await file.text();
            
            if (file.name.endsWith('.json')) {
              const success = importFromJson(content);
              if (success) {
                addLog('info', `용어집 JSON 파일을 가져왔습니다: ${file.name}`);
              } else {
                addLog('error', '용어집 JSON 파일 파싱 실패');
              }
              resolve(success);
            } else if (file.name.endsWith('.csv')) {
              // CSV 파싱
              const lines = content.split('\n');
              if (lines.length < 2) {
                addLog('error', 'CSV 파일이 비어 있거나 헤더만 있습니다.');
                resolve(false);
                return;
              }

              const newEntries: GlossaryEntry[] = [];
              for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // 간단한 CSV 파싱 (따옴표 처리 포함)
                const match = line.match(/^"([^"]*?)","([^"]*?)",([^,]+),(\d+)$/);
                if (match) {
                  newEntries.push({
                    keyword: match[1].replace(/""/g, '"'),
                    translatedKeyword: match[2].replace(/""/g, '"'),
                    targetLanguage: match[3],
                    occurrenceCount: parseInt(match[4]) || 0,
                  });
                }
              }

              if (newEntries.length > 0) {
                mergeEntries(newEntries);
                addLog('info', `CSV에서 ${newEntries.length}개 항목을 가져왔습니다: ${file.name}`);
                resolve(true);
              } else {
                addLog('error', 'CSV 파일에서 유효한 항목을 찾을 수 없습니다.');
                resolve(false);
              }
            } else {
              addLog('error', '지원하지 않는 파일 형식입니다.');
              resolve(false);
            }
          } catch (error) {
            addLog('error', `파일 읽기 실패: ${error}`);
            resolve(false);
          }
        };

        input.click();
      });
    } catch (error) {
      addLog('error', `파일 가져오기 실패: ${error}`);
      return false;
    }
  }, [importFromJson, mergeEntries, addLog]);

  // 용어집 초기화
  const resetGlossary = useCallback(() => {
    clearEntries();
    addLog('info', '용어집이 초기화되었습니다.');
  }, [clearEntries, addLog]);

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
    entries,
    isExtracting,
    extractionProgress,
    
    // 액션
    executeExtraction,
    cancelExtraction,
    downloadGlossary,
    downloadGlossaryCsv,
    importGlossaryFile,
    resetGlossary,
    
    // 상태 확인
    canExtract: inputFiles.length > 0 && !isExtracting,
    canStop: isExtracting,
    hasEntries: entries.length > 0,
    entryCount: entries.length,
  };
}
