// components/common/ExportSettingsSection.tsx
// 텍스트 번역본을 EPUB으로 내보낼 때의 챕터 분할 방식과 부록 용어집 설정

import React from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_EPUB_DELIMITER_REGEX, DEFAULT_EPUB_DELIMITER_MIN_DISTANCE } from '../../types/config';
import { Checkbox, Input, Select } from './FormElements';

export function ExportSettingsSection() {
  const config = useSettingsStore((state) => state.config);
  const updateConfig = useSettingsStore((state) => state.updateConfig);

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">EPUB 내보내기 설정</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          EPUB에는 프로젝트 설정의 제목·작가·표지·소개가 들어갑니다. 표지와 제목·작가가 있어야 내보낼 수 있습니다.
        </p>
      </div>

      <Checkbox
        label="책 끝에 용어집 부록 첨부"
        checked={config.attachGlossaryToEnd}
        onChange={(e) => updateConfig({ attachGlossaryToEnd: e.target.checked })}
        description="등장 횟수가 1 이상인 용어를 '부록: 용어집'으로 붙입니다."
      />

      <div className="max-w-xs">
        <Select
          label="챕터 분할 단위"
          value={config.epubSplitMode}
          onChange={(e) => updateConfig({ epubSplitMode: e.target.value as 'chunk' | 'delimiter' })}
          options={[
            { value: 'chunk', label: '청크 단위' },
            { value: 'delimiter', label: '구분자(정규식) 단위' },
          ]}
        />
      </div>

      {config.epubSplitMode === 'delimiter' && (
        <div className="p-3.5 bg-white border border-indigo-100 rounded-lg space-y-3.5">
          <Input
            label="챕터 구분자 정규식"
            value={config.epubDelimiterRegex}
            onChange={(e) => updateConfig({ epubDelimiterRegex: e.target.value })}
            placeholder={DEFAULT_EPUB_DELIMITER_REGEX}
            className="font-mono text-sm"
            helperText="일치하는 줄이 챕터 제목이 되고, 다음 구분자 전까지가 한 챕터입니다."
          />
          <div className="max-w-xs">
            <Input
              type="number"
              label="연속 구분자 무시 간격 (글자 수)"
              value={config.epubDelimiterMinDistance}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                updateConfig({
                  epubDelimiterMinDistance: Number.isFinite(value) ? Math.max(0, value) : DEFAULT_EPUB_DELIMITER_MIN_DISTANCE,
                });
              }}
              min={0}
              max={500}
              helperText="직전 구분자에서 공백 제외 이 글자 수 미만으로 다시 나온 구분자는 중복 제목으로 보고 본문에 넣습니다."
            />
          </div>
        </div>
      )}
    </div>
  );
}
