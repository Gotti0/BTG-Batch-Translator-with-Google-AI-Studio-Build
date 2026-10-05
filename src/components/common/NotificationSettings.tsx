// components/common/NotificationSettings.tsx
// 작업 완료 알림음과 백그라운드 탭 절전 방지(무음 오디오 루프) 설정

import React, { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTranslationStore } from '../../stores/translationStore';
import { SilentAudioLoopService, SoundNotificationService } from '../../services/SoundNotificationService';
import { Button } from './Button';
import { Checkbox } from './FormElements';

export function NotificationSettings() {
  const config = useSettingsStore((state) => state.config);
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const isRunning = useTranslationStore((state) => state.isRunning);
  const addLog = useTranslationStore((state) => state.addLog);
  const [isAudioPlaying, setIsAudioPlaying] = useState(SilentAudioLoopService.isPlaying());
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => SilentAudioLoopService.subscribe(setIsAudioPlaying), []);

  const handleTestSilentAudio = async () => {
    setIsTesting(true);
    addLog('info', '🔊 무음 오디오를 3초간 재생합니다. 브라우저 탭에 스피커 아이콘이 뜨는지 확인하세요.');
    const success = await SilentAudioLoopService.testPlay(3000);
    if (!success) {
      addLog('warning', '무음 오디오 재생이 브라우저 정책에 막혔거나 실패했습니다.');
    }
    setTimeout(() => setIsTesting(false), 3200);
  };

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Volume2 className="w-4 h-4 text-indigo-600" />
          작업 알림 및 백그라운드 탭 관리
        </h3>
        <span
          className={`text-xs px-2.5 py-1 rounded-full border ${
            isAudioPlaying
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : 'bg-gray-100 text-gray-600 border-gray-200'
          }`}
        >
          {isAudioPlaying ? '무음 재생 중' : config.enableSilentAudioLoop ? '작업 시작 시 자동 재생' : '절전 방지 꺼짐'}
        </span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Checkbox
            label="번역 완료 시 알림음 재생"
            checked={config.enableSoundNotification}
            onChange={(e) => updateConfig({ enableSoundNotification: e.target.checked })}
            description="번역이 끝나면 짧은 차임을 울립니다."
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => SoundNotificationService.playChime()}>
          알림음 듣기
        </Button>
      </div>

      <div className="pt-3 border-t border-gray-200 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <Checkbox
            label="작업 중 무음 오디오로 탭 절전 방지"
            checked={config.enableSilentAudioLoop}
            onChange={(e) => {
              const checked = e.target.checked;
              updateConfig({ enableSilentAudioLoop: checked });
              // 번역 중에 바꾸면 바로 반영한다
              if (isRunning) {
                if (checked) {
                  SilentAudioLoopService.start();
                } else {
                  SilentAudioLoopService.stop();
                }
              }
            }}
            description="번역 중 브라우저가 백그라운드 탭의 타이머·네트워크를 늦추지 않도록 무음 오디오를 반복 재생합니다. 재생 중에는 상단 배지로 언제든 끄고 켤 수 있습니다."
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleTestSilentAudio} disabled={isTesting}>
          {isTesting ? '확인 중 (3초)...' : '탭 스피커 표시 확인'}
        </Button>
      </div>
    </div>
  );
}
