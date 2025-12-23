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

  // 해당 모델이 지원하는 Level 목록 정의
  const getSupportedLevels = () => {
    if (isGemini3Flash) return ['minimal', 'low', 'medium', 'high'];
    if (isGemini3Pro) return ['low', 'high'];
    return []; // fallback
  };

  const levels = getSupportedLevels();

  // [안전 장치] 모델 변경 시, 현재 설정된 Level이 지원되지 않는 값이면 기본값으로 재설정
  useEffect(() => {
    if (isGemini3 && levels.length > 0 && !levels.includes(thinkingLevel)) {
      // 예: 'minimal' 상태에서 Pro로 바꾸면 'high'로 강제 변경
      updateConfig({ thinkingLevel: 'high' });
    }
  }, [modelName, isGemini3, levels, thinkingLevel, updateConfig]);

  if (!isGemini3 && !isGemini2_5) return null;

  return (
    <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50">
      <h3 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
        <span>🧠</span>
        Thinking Model 설정
        <span className="text-[10px] font-normal text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
          {isGemini3Pro ? 'Gemini 3 Pro' : isGemini3Flash ? 'Gemini 3 Flash' : 'Gemini 2.5'}
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
              {thinkingLevel === 'high' && '• High: 가장 깊은 추론, 복잡한 문제 해결에 적합 (속도 느림)'}
              {thinkingLevel === 'medium' && '• Medium: 균형 잡힌 추론과 속도'}
              {thinkingLevel === 'low' && '• Low: 기본적인 추론, 빠른 응답'}
              {thinkingLevel === 'minimal' && '• Minimal: 최소한의 추론, 가장 빠름'}
              {!levels.includes(thinkingLevel) && '(자동 조정됨)'}
            </p>
          </div>
        )}

        {/* Case B: Gemini 2.5 (Budget) */}
        {isGemini2_5 && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
               <label className="text-xs font-medium text-gray-700">생각 예산 (Token Budget)</label>
               <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                  {thinkingBudget === -1 ? 'Auto (Dynamic)' : `${thinkingBudget} Tokens`}
               </span>
            </div>
            
            <input
              type="range"
              min="0"
              max="32768"
              step="1024"
              value={thinkingBudget === -1 ? 0 : thinkingBudget}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateConfig({ thinkingBudget: val === 0 ? -1 : val });
              }}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Auto</span>
              <span>16k</span>
              <span>32k</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ThinkingSettings;

