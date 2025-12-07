// stores/index.ts
// 스토어 통합 export

export { 
  useSettingsStore,
  useModelName,
  useTemperature,
  useChunkSize,
  useRpm,
  usePrompts,
  usePrefillEnabled,
  useGlossaryInjectionEnabled,
} from './settingsStore';

export { 
  useTranslationStore,
  useInputFiles,
  useIsRunning,
  useProgress,
  useResults,
  useLogs,
  useTranslatedText,
  useGlossaryEntries as useTranslationGlossaryEntries,
  useTranslationStatus,
  useTranslationStats,
} from './translationStore';

export {
  useGlossaryStore,
  useGlossaryEntries,
  useIsExtracting,
  useExtractionProgress,
  useSelectedEntries,
  useGlossarySearchQuery,
  useGlossaryStats,
} from './glossaryStore';
