import React, { useState, useEffect } from 'react';
import { History, Settings, BookOpen, CheckCircle, ScrollText, Volume2, VolumeX } from 'lucide-react';

// 페이지 컴포넌트 import
import { SnapshotPage, TranslationPage, GlossaryPage, ReviewPage, LogPage } from './pages';

// Stores
import { useTranslationStore } from './stores/translationStore';
import { useSettingsStore } from './stores/settingsStore';
import { useGlossaryStore } from './stores/glossaryStore';
import { useProjectStore } from './stores/projectStore';

// Services & Components
import { SnapshotService } from './services/SnapshotService';
import { SnapshotStorage } from './services/SnapshotStorage';
import { migrateLegacyData } from './services/LegacyDataMigration';
import { SilentAudioLoopService } from './services/SoundNotificationService';
import { ConfirmDialog } from './components/common/Modal';
import { ToastContainer } from './components/common/ToastContainer';
import { toast } from './stores/toastStore';
import type { SnapshotMeta } from './types/snapshot';

// 탭 타입 정의
type TabType = 'snapshots' | 'translation' | 'glossary' | 'review' | 'log';

// 탭 설정
const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'snapshots', label: '스냅샷', icon: <History className="w-5 h-5" /> },
  { id: 'translation', label: '설정 및 번역', icon: <Settings className="w-5 h-5" /> },
  { id: 'glossary', label: '용어집 관리', icon: <BookOpen className="w-5 h-5" /> },
  { id: 'review', label: '검토 및 수정', icon: <CheckCircle className="w-5 h-5" /> },
  { id: 'log', label: '실행 로그', icon: <ScrollText className="w-5 h-5" /> },
];

/**
 * 스냅샷에 들어가는 상태가 바뀌면 자동 저장을 요청한다.
 * 실행 로그·진행률처럼 자주 바뀌지만 스냅샷과 무관한 값에는 반응하지 않는다.
 */
function useAutoSnapshotSubscriptions() {
  useEffect(() => {
    const request = () => SnapshotService.requestAutoSave();
    const unsubscribers = [
      useTranslationStore.subscribe((state, prev) => {
        if (
          state.inputFiles !== prev.inputFiles ||
          state.results !== prev.results ||
          state.translationMode !== prev.translationMode
        ) {
          request();
        }
      }),
      useGlossaryStore.subscribe((state, prev) => {
        if (state.entries !== prev.entries) request();
      }),
      useSettingsStore.subscribe((state, prev) => {
        if (state.config !== prev.config) request();
      }),
      useProjectStore.subscribe((state, prev) => {
        if (state.project !== prev.project) request();
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);
}

/**
 * 브라우저 탭 제목에 진행률과 무음 재생 여부를 표시한다
 */
function useDocumentTitle(isAudioLoopPlaying: boolean) {
  const isRunning = useTranslationStore((state) => state.isRunning);
  const processed = useTranslationStore((state) => state.progress?.processedChunks ?? 0);
  const total = useTranslationStore((state) => state.progress?.totalChunks ?? 0);

  useEffect(() => {
    const audioIcon = isAudioLoopPlaying ? '🔊 ' : '';
    if (isRunning) {
      const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
      document.title = `${audioIcon}(${percentage}%) 번역 진행 중 - BTG`;
    } else {
      document.title = `${audioIcon}BTG - Batch Translator for Gemini`;
    }
  }, [isRunning, processed, total, isAudioLoopPlaying]);
}

// 메인 App 컴포넌트
export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('translation');
  const [restoreCandidate, setRestoreCandidate] = useState<SnapshotMeta | null>(null);
  const [isAudioLoopPlaying, setIsAudioLoopPlaying] = useState(SilentAudioLoopService.isPlaying());

  // 상태 구독
  const addLog = useTranslationStore(state => state.addLog);
  const isRunning = useTranslationStore(state => state.isRunning);
  const hasResults = useTranslationStore(state => state.results.length > 0);

  useAutoSnapshotSubscriptions();
  useDocumentTitle(isAudioLoopPlaying);

  useEffect(() => SilentAudioLoopService.subscribe(setIsAudioLoopPlaying), []);

  // 앱 시작: 이전 버전 데이터 이전 → 고아 원본 정리 → 최근 스냅샷 복원 안내
  useEffect(() => {
    addLog('info', '🌐 BTG - Batch Translator 앱이 시작되었습니다.');

    const initialize = async () => {
      if (!SnapshotStorage.isAvailable()) {
        addLog('warning', '이 브라우저는 IndexedDB를 지원하지 않아 스냅샷을 저장할 수 없습니다.');
        return;
      }
      try {
        const migrated = await migrateLegacyData();
        if (migrated) {
          addLog('info', '📦 이전 버전의 설정·용어집·작업을 스냅샷 보관함으로 옮겼습니다.');
        }
      } catch (e) {
        addLog('error', `이전 버전 데이터를 옮기지 못했습니다 (원래 데이터는 그대로 둡니다): ${e}`);
      }

      try {
        const removed = await SnapshotStorage.collectGarbage();
        if (removed > 0) addLog('debug', `참조되지 않는 원본 파일 ${removed}개를 정리했습니다.`);
        const snapshots = await SnapshotStorage.listSnapshots();
        if (snapshots.length > 0) {
          setRestoreCandidate(snapshots[0]);
        }
      } catch (e) {
        addLog('error', `스냅샷 보관함을 여는 중 오류가 발생했습니다: ${e}`);
      }
    };

    initialize();
  }, []); // Mount 시 1회 실행

  // 탭 닫기 방지 (이탈 방지)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 대기 중인 자동 저장을 바로 시작한다 (사용자가 머물기를 고르면 끝까지 기록된다)
      void SnapshotService.flushAutoSnapshot();
      if (isRunning || hasResults) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRunning, hasResults]);

  // 최근 스냅샷 복원
  const handleRestoreConfirm = async () => {
    const candidate = restoreCandidate;
    setRestoreCandidate(null);
    if (!candidate) return;
    try {
      const result = await SnapshotService.restoreSnapshotById(candidate.id);
      if (result) {
        toast.success(`"${candidate.projectTitle}" 작업을 복원했습니다.`, '스냅샷 복원');
      }
    } catch (e) {
      toast.error(`복원 실패: ${e instanceof Error ? e.message : String(e)}`, '스냅샷 복원');
    }
  };

  const handleRestoreCancel = () => {
    setRestoreCandidate(null);
    addLog('info', '최근 스냅샷을 복원하지 않고 새 작업으로 시작합니다. 스냅샷 탭에서 언제든 복원할 수 있습니다.');
  };

  const showAudioBadge = isRunning || isAudioLoopPlaying;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-gradient-to-r from-primary-600 to-primary-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                🌐 BTG - Batch Translator
              </h1>
              <p className="text-primary-100 text-sm mt-1">
                Google AI Studio Builder Edition
              </p>
            </div>
            <div className="flex items-center gap-3">
              {showAudioBadge && (
                <button
                  type="button"
                  onClick={async () => {
                    if (isAudioLoopPlaying) {
                      SilentAudioLoopService.pause();
                      addLog('info', '🔇 탭 절전 방지 무음 재생을 일시 중지했습니다.');
                    } else if (!(await SilentAudioLoopService.start())) {
                      addLog('warning', '⚠️ 무음 재생을 시작하지 못했습니다 (브라우저 자동 재생 정책).');
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                    isAudioLoopPlaying
                      ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400/50'
                      : 'bg-amber-500/25 text-amber-100 border-amber-400/50'
                  }`}
                  title="탭 절전 방지 무음 재생을 켜거나 끕니다."
                >
                  {isAudioLoopPlaying ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  절전 방지 {isAudioLoopPlaying ? 'ON' : 'OFF'}
                </button>
              )}
              <div className="text-right text-sm text-primary-100">
                <p>Powered by Gemini API</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 탭 네비게이션 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-4 font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'text-primary-600 border-primary-600 bg-primary-50'
                    : 'text-gray-600 border-transparent hover:text-primary-600 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className={activeTab === 'snapshots' ? 'block' : 'hidden'}>
          <SnapshotPage isActive={activeTab === 'snapshots'} onRestored={() => setActiveTab('translation')} />
        </div>
        <div className={activeTab === 'translation' ? 'block' : 'hidden'}>
          <TranslationPage />
        </div>
        <div className={activeTab === 'glossary' ? 'block' : 'hidden'}>
          <GlossaryPage />
        </div>
        <div className={activeTab === 'review' ? 'block' : 'hidden'}>
          <ReviewPage />
        </div>
        <div className={activeTab === 'log' ? 'block' : 'hidden'}>
          <LogPage />
        </div>
      </main>

      {/* 푸터 */}
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          BTG - Batch Translator for Gemini | React + TypeScript | AI Studio Builder
        </div>
      </footer>

      {/* 최근 스냅샷 복원 안내 */}
      <ConfirmDialog
        isOpen={restoreCandidate !== null}
        onClose={handleRestoreCancel}
        onConfirm={handleRestoreConfirm}
        title="최근 작업 복원"
        message={
          restoreCandidate
            ? `가장 최근 스냅샷을 불러올까요?\n\n"${restoreCandidate.projectTitle}"${restoreCandidate.label ? ` (${restoreCandidate.label})` : ''}\n${new Date(restoreCandidate.updatedAt).toLocaleString()} 저장 · 청크 ${restoreCandidate.successfulChunks}/${restoreCandidate.totalChunks} 완료\n\n설정과 용어집도 스냅샷에 저장된 값으로 바뀝니다.`
            : ''
        }
        confirmText="복원하기"
        cancelText="새로 시작"
      />

      <ToastContainer />
    </div>
  );
}
