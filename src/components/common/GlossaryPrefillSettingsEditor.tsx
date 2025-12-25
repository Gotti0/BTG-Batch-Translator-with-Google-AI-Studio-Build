
// src/components/common/GlossaryPrefillSettingsEditor.tsx
import React from 'react';
import { RotateCcw, Plus, Trash2, User, MessageSquare, Zap } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button, IconButton } from './Button';
import { Textarea } from './FormElements';
import { 
    DEFAULT_GLOSSARY_PREFILL_SYSTEM_INSTRUCTION, 
    DEFAULT_GLOSSARY_PREFILL_CACHED_HISTORY 
} from '../../types/config';

/**
 * 용어집 프리필 설정 에디터 컴포넌트
 */
export function GlossaryPrefillSettingsEditor() {
  const { config, updateConfig } = useSettingsStore();

  const updateHistoryItem = (index: number, text: string) => {
    const newHistory = [...config.glossaryPrefillCachedHistory];
    if (newHistory[index]) {
      newHistory[index] = { ...newHistory[index], parts: [text] };
      updateConfig({ glossaryPrefillCachedHistory: newHistory });
    }
  };

  const removeHistoryItem = (index: number) => {
    const newHistory = config.glossaryPrefillCachedHistory.filter((_, i) => i !== index);
    updateConfig({ glossaryPrefillCachedHistory: newHistory });
  };

  const addHistoryItem = (role: 'user' | 'model') => {
    const newHistory = [
      ...config.glossaryPrefillCachedHistory,
      { role, parts: [''] }
    ];
    updateConfig({ glossaryPrefillCachedHistory: newHistory });
  };

  const addHistoryPair = () => {
    const newHistory = [
      ...config.glossaryPrefillCachedHistory,
      { role: 'user' as const, parts: [''] },
      { role: 'model' as const, parts: [''] }
    ];
    updateConfig({ glossaryPrefillCachedHistory: newHistory });
  };

  const handleResetDefaults = () => {
      updateConfig({
        glossaryPrefillSystemInstruction: DEFAULT_GLOSSARY_PREFILL_SYSTEM_INSTRUCTION,
        glossaryPrefillCachedHistory: DEFAULT_GLOSSARY_PREFILL_CACHED_HISTORY,
      });
  };

  return (
    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-4 animate-fadeIn">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          용어집 추출 프리필 설정
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetDefaults}
          className="text-yellow-600 hover:text-yellow-800 hover:bg-yellow-100 h-8 text-xs"
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          기본값 복원
        </Button>
      </div>
      
      <Textarea
        label="시스템 지침 (System Instruction)"
        value={config.glossaryPrefillSystemInstruction}
        onChange={(e) => updateConfig({ glossaryPrefillSystemInstruction: e.target.value })}
        rows={6}
        className="font-mono text-xs"
        helperText="용어집 추출 모델의 역할과 규칙을 정의합니다."
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            대화 히스토리 (Conversation History)
          </label>
        </div>

        {config.glossaryPrefillCachedHistory.map((item, index) => (
          <div key={index} className="relative group bg-white p-3 rounded-lg border border-yellow-100 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {item.role === 'user' ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 uppercase">
                    <User className="w-3 h-3" /> User
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 uppercase">
                    <MessageSquare className="w-3 h-3" /> Model
                  </span>
                )}
                <span className="text-[10px] text-gray-400 font-mono">Turn #{index + 1}</span>
              </div>
              <IconButton
                icon={<Trash2 className="w-3.5 h-3.5" />}
                variant="ghost"
                size="sm"
                onClick={() => removeHistoryItem(index)}
                title="이 대화 삭제"
                aria-label="Delete turn"
                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
            <textarea
              className="w-full text-xs font-mono bg-transparent border-none focus:ring-0 p-0 resize-none min-h-[60px]"
              value={item.parts[0]}
              onChange={(e) => updateHistoryItem(index, e.target.value)}
              placeholder={`${item.role === 'user' ? '사용자 요청' : '모델 응답'} 내용을 입력하세요...`}
            />
          </div>
        ))}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-yellow-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => addHistoryItem('user')}
            className="text-blue-600 bg-white hover:bg-blue-50 border border-blue-200 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> User 추가
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => addHistoryItem('model')}
            className="text-purple-600 bg-white hover:bg-purple-50 border border-purple-200 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> Model 추가
          </Button>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={addHistoryPair}
              className="text-gray-600 bg-white border-dashed border-gray-300 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" /> 대화 쌍(Pair) 추가
            </Button>
          </div>
        </div>
      </div>
      
      <div className="text-xs text-yellow-800 bg-yellow-100 p-2 rounded">
        💡 <strong>Tip:</strong> 여기서 설정한 대화 예시는 용어집 추출 AI가 더 정확한 형식의 결과를 출력하도록 유도하는 데 사용됩니다.
      </div>
    </div>
  );
}
