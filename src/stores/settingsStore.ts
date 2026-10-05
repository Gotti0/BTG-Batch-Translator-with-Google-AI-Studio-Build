// stores/settingsStore.ts
// 설정 상태 관리 (Zustand)
//
// 설정은 브라우저 저장소에 따로 남기지 않는다. 앱은 항상 기본값으로 시작하고,
// 작업별 설정은 스냅샷에 함께 저장했다가 복원할 때 되살린다.
// (이전 버전이 localStorage에 남긴 설정은 LegacyDataMigration이 스냅샷으로 옮긴 뒤 지운다)

import { create } from 'zustand';
import type { AppConfig } from '../types/config';
import { defaultConfig } from '../types/config';

/**
 * 설정 스토어 상태 인터페이스
 */
interface SettingsState {
  // 상태
  config: AppConfig;
  isLoaded: boolean;

  // 액션
  updateConfig: (partial: Partial<AppConfig>) => void;
  resetConfig: () => void;
  setConfig: (config: AppConfig) => void;

  // 내보내기/가져오기
  exportConfig: () => string;
  importConfig: (json: string) => boolean;
}

/**
 * 설정 스토어
 */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  // 초기 상태
  config: { ...defaultConfig },
  isLoaded: true,

  // 설정 부분 업데이트
  updateConfig: (partial) => set((state) => ({
    config: { ...state.config, ...partial },
  })),

  // 설정 초기화
  resetConfig: () => set({
    config: { ...defaultConfig },
  }),

  // 설정 전체 교체
  setConfig: (config) => set({
    config: { ...defaultConfig, ...config },
    isLoaded: true,
  }),

  // JSON으로 내보내기
  exportConfig: () => {
    const { config } = get();
    return JSON.stringify(config, null, 2);
  },

  // JSON에서 가져오기
  importConfig: (json) => {
    try {
      const imported = JSON.parse(json);
      set({
        config: { ...defaultConfig, ...imported },
        isLoaded: true,
      });
      return true;
    } catch (error) {
      console.error('설정 가져오기 실패:', error);
      return false;
    }
  },
}));

/**
 * 설정 값 선택자 훅들 (성능 최적화)
 */
export const useModelName = () => useSettingsStore((state) => state.config.modelName);
export const useTemperature = () => useSettingsStore((state) => state.config.temperature);
export const useChunkSize = () => useSettingsStore((state) => state.config.chunkSize);
export const useRpm = () => useSettingsStore((state) => state.config.requestsPerMinute);
export const usePrompts = () => useSettingsStore((state) => state.config.prompts);
export const usePrefillEnabled = () => useSettingsStore((state) => state.config.enablePrefillTranslation);
export const useGlossaryInjectionEnabled = () => useSettingsStore((state) => state.config.enableDynamicGlossaryInjection);
