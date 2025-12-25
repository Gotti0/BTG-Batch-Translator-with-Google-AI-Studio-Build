import React, { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

const ThinkingSettings = () => {
  const { config, updateConfig } = useSettingsStore();
  const { modelName, thinkingLevel, thinkingBudget } = config;

  // 모델 타입 감지
  const isGemini3 = modelName.includes('gemini-3');
  const isGemini3Pro = isGemini3 && modelName.includes('pro');
  const isGemini3Flash = isGemini3 && modelName.includes('flash');
  const isGemini2_5 = modelName.includes('gemini-2.5');
  const isGemini2_5Pro = isGemini2_5 && modelName.includes('pro');
  const isGemini2_5Flash = isGemini2_5 && modelName.includes('flash');


  // 해당 모델이 지원하는 Level 목록 정의
  const getSupportedLevels = (): readonly ('MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH')[] => {
    if (isGemini3Flash) return ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
    if (isGemini3Pro) return ['LOW', 'HIGH'];
    return []; // fallback
  };

  const levels = getSupportedLevels();

  // Gemini 2.5 모델별 Thinking Budget 설정
  const budgetConfig = React.useMemo(() => {
    if (isGemini2_5Pro) {
      return {
        min: 128,
        max: 32768,
        step: 128,
        labels: ['Auto', '8k', '16k', '24k', '32k']
      };
    } else if (isGemini2_5Flash) {
      return {
        min: 0, // 0을 최소 값으로 하되, UI에서 0 입력 시 Auto (-1)로 변환
        max: 24576,
        step: 128,
        labels: ['Auto', '6k', '12k', '18k', '24k']
      };
    }
    return { min: 0, max: 0, step: 1, labels: ['Auto'] }; // 기본값 (사용되지 않음)
  }, [isGemini2_5Pro, isGemini2_5Flash]);

  // [안전 장치 1] Gemini 3 모델 변경 시, 현재 설정된 Level이 지원되지 않는 값이면 기본값으로 재설정
  useEffect(() => {
    if (isGemini3 && levels.length > 0 && !levels.includes(thinkingLevel)) {
      updateConfig({ thinkingLevel: 'HIGH' });
    }
  }, [modelName, isGemini3, levels, thinkingLevel, updateConfig]);

  // [안전 장치 2] Gemini 2.5 모델 변경 시, 현재 설정된 Budget이 유효 범위를 벗어나면 기본값으로 재설정
  useEffect(() => {
    if ((isGemini2_5Pro || isGemini2_5Flash) && thinkingBudget !== -1) { // Auto 모드가 아닐 때만 검사
      if (thinkingBudget < budgetConfig.min || thinkingBudget > budgetConfig.max) {
        updateConfig({ thinkingBudget: -1 }); // 유효하지 않으면 Auto로 재설정
      }
    }
  }, [modelName, isGemini2_5Pro, isGemini2_5Flash, thinkingBudget, budgetConfig.min, budgetConfig.max, updateConfig]);


  if (!isGemini3 && !isGemini2_5) return null;

  return (
    <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50">
      <h3 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
        <span>🧠</span>
        Thinking Model 설정
        <span className="text-[10px] font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
          {isGemini3Pro ? 'Gemini 3 Pro' : isGemini3Flash ? 'Gemini 3 Flash' : isGemini2_5Pro ? 'Gemini 2.5 Pro' : isGemini2_5Flash ? 'Gemini 2.5 Flash' : 'Gemini 3'}
        </span>
      </h3>

      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between mb-4">
        <label htmlFor="enable-thinking" className="text-xs text-gray-700 font-medium">
          Thinking 기능 사용
        </label>
        <button
          id="enable-thinking"
          onClick={() => updateConfig({ enableThinking: !config.enableThinking })}
          className={`relative inline-flex flex-shrink-0 h-5 w-9 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none ${
            config.enableThinking ? 'bg-indigo-600' : 'bg-gray-300'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-lg transform ring-0 transition ease-in-out duration-200 ${
              config.enableThinking ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Conditional Settings */}
      <div className={`transition-opacity duration-300 ${config.enableThinking ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
        {/* Case A: Gemini 3 (Pro / Flash) */}
        {isGemini3 && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-700">
              생각 깊이 (Thinking Level)
            </label>
            <div className="flex flex-wrap gap-2">
              {levels.map((level) => (
                <button
                  key={level}
                  onClick={() => updateConfig({ thinkingLevel: level })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    thinkingLevel === level
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {level.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {thinkingLevel === 'HIGH' && '• HIGH: 가장 깊은 추론, 복잡한 문제 해결에 적합 (속도 느림)'}
              {thinkingLevel === 'MEDIUM' && '• MEDIUM: 균형 잡힌 추론과 속도'}
              {thinkingLevel === 'LOW' && '• LOW: 기본적인 추론, 빠른 응답'}
              {thinkingLevel === 'MINIMAL' && '• MINIMAL: 최소한의 추론, 가장 빠름'}
              {!levels.includes(thinkingLevel) && thinkingLevel !== 'HIGH' && '(자동 조정됨)'}
            </p>
          </div>
        )}

        {/* Case B: Gemini 2.5 (Budget) */}
        {(isGemini2_5Pro || isGemini2_5Flash) && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
               <label className="text-xs font-medium text-gray-700">생각 예산 (Token Budget)</label>
               <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                  {thinkingBudget === -1 ? 'Auto (Dynamic)' : `${thinkingBudget} Tokens`}
               </span>
            </div>
            
            <input
              type="range"
              min={budgetConfig.min}
              max={budgetConfig.max}
              step={budgetConfig.step}
              value={thinkingBudget === -1 ? budgetConfig.min : thinkingBudget}
              onChange={(e) => {
                const val = Number(e.target.value);
                // 슬라이더의 최소값이 0일 때, 0으로 설정하면 -1 (Auto)로 변환
                if (budgetConfig.min === 0 && val === 0) {
                  updateConfig({ thinkingBudget: -1 });
                } else {
                  updateConfig({ thinkingBudget: val });
                }
              }}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              {budgetConfig.labels.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ThinkingSettings;
