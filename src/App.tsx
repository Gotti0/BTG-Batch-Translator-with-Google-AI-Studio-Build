import React, { useState, useEffect } from 'react';
import { Settings, BookOpen, CheckCircle, ScrollText } from 'lucide-react';

// 페이지 컴포넌트 import
import { TranslationPage, GlossaryPage, ReviewPage, LogPage } from './pages';

// Stores & Hooks
import { useTranslationStore } from './stores';
import { useTranslation } from './hooks/useTranslation';

// Utils & Components
import { IndexedDBHandler } from './utils/indexedDBHandler';
import { ConfirmDialog } from './components/common/Modal';

// 탭 타입 정의
type TabType = 'translation' | 'glossary' | 'review' | 'log';

// 탭 설정
const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'translation', label: '설정 및 번역', icon: <Settings className="w-5 h-5" /> },
  { id: 'glossary', label: '용어집 관리', icon: <BookOpen className="w-5 h-5" /> },
  { id: 'review', label: '검토 및 수정', icon: <CheckCircle className="w-5 h-5" /> },
  { id: 'log', label: '실행 로그', icon: <ScrollText className="w-5 h-5" /> },
];

// 메인 App 컴포넌트
export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('translation');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restorableSnapshot, setRestorableSnapshot] = useState<any>(null);
  
  // 상태 구독
  const addLog = useTranslationStore(state => state.addLog);
  const isRunning = useTranslationStore(state => state.isRunning);
  
  // Hook에서 필요한 데이터와 함수 가져오기
  const { 
    results, 
    progress, 
    inputFiles, 
    hasResults,
    createSnapshot, // 자동 저장을 위해 객체 생성 함수를 가져옴
    importSnapshot  // 복원을 위해 객체 임포트 함수를 가져옴
  } = useTranslation();

  // 앱 초기화 및 복구 로직
  useEffect(() => {
    addLog('info', '🌐 BTG - Batch Translator 앱이 시작되었습니다.');
    addLog('info', '✅ React 18 + TypeScript 환경 준비 완료');
    
    // 1. 자동 저장된 스냅샷 확인
    const checkAutoSave = async () => {
      try {
        const savedData = await IndexedDBHandler.loadSnapshot();
        if (savedData) {
          // 스냅샷 유효성 검증 (간단히)
          if (savedData.source_text || savedData.epub_binary) {
            setRestorableSnapshot(savedData);
            setShowRestoreDialog(true);
            addLog('info', '💾 이전 작업 내역이 발견되었습니다. 복구 여부를 선택하세요.');
          } else {
            // 유효하지 않은 데이터는 삭제
            await IndexedDBHandler.clearSnapshot();
          }
        }
      } catch (e) {
        addLog('error', `저장된 작업 확인 중 오류 발생: ${e}`);
      }
    };
    
    checkAutoSave();
  }, []); // Mount 시 1회 실행

  // 2. 자동 저장 로직 (Debounce 적용)
  useEffect(() => {
    // 번역 중이 아니거나, 번역 결과나 입력 파일이 없으면 저장하지 않음 (초기화 또는 빈 상태 덮어쓰기 방지)
    if (isRunning || (inputFiles.length === 0 && !hasResults)) {
      return;
    }

    const saveTimer = setTimeout(async () => {
      try {
        const snapshotData = await createSnapshot();
        if (snapshotData) {
          await IndexedDBHandler.saveSnapshot(snapshotData);
          addLog('debug', '작업 상태가 자동으로 저장되었습니다.');
        }
      } catch (e) {
        addLog('error', `자동 저장 실패: ${e}`);
      }
    }, 3000); // 3초간 변경이 없으면 저장

    return () => clearTimeout(saveTimer);
  }, [results, progress, inputFiles, hasResults, isRunning, createSnapshot, addLog]);

  // 탭 닫기 방지 (이탈 방지)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRunning || hasResults) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRunning, hasResults]);

  // 복구 실행 핸들러
  const handleRestoreConfirm = async () => {
    if (restorableSnapshot) {
      try {
        // 이제 파일로 변환할 필요 없이 객체를 직접 전달
        await importSnapshot(restorableSnapshot);
        addLog('info', '✅ 이전 작업이 성공적으로 복구되었습니다.');
      } catch (e) {
        addLog('error', `복구 실패: ${e}`);
      }
    }
    setShowRestoreDialog(false);
  };

  const handleRestoreCancel = async () => {
    setShowRestoreDialog(false);
    // 선택: 사용자가 복구를 원하지 않을 경우, 저장된 데이터를 삭제하여 다시 묻지 않도록 할 수 있습니다.
    // await IndexedDBHandler.clearSnapshot(); 
    addLog('info', '이전 작업 복구를 취소했습니다.');
  };
  
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
            <div className="text-right text-sm text-primary-100">
              <p>Powered by Gemini API</p>
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

      {/* 작업 복구 알림 모달 */}
      <ConfirmDialog 
        isOpen={showRestoreDialog}
        onClose={handleRestoreCancel}
        onConfirm={handleRestoreConfirm}
        title="작업 복구"
        message="이전에 비정상적으로 종료된 작업 내역이 있습니다. 이어서 작업하시겠습니까?"
        confirmText="복구하기"
        cancelText="무시하기"
      />
    </div>
  );
}