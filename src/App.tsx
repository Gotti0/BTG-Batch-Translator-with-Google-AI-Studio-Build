import React, { useState, useEffect } from 'react';
import { Settings, BookOpen, CheckCircle, ScrollText } from 'lucide-react';

// 페이지 컴포넌트 import
import { TranslationPage, GlossaryPage, ReviewPage, LogPage } from './pages';

// Stores import (앱 초기화용)
import { useTranslationStore } from './stores';

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
  const addLog = useTranslationStore(state => state.addLog);
  
  // 앱 초기화
  useEffect(() => {
    addLog('info', '🌐 BTG - Batch Translator 앱이 시작되었습니다.');
    addLog('info', '✅ React 18 + TypeScript 환경 준비 완료');
    addLog('info', '💾 LocalStorage에서 설정을 불러왔습니다.');
  }, []);
  
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
        {activeTab === 'translation' && <TranslationPage />}
        {activeTab === 'glossary' && <GlossaryPage />}
        {activeTab === 'review' && <ReviewPage />}
        {activeTab === 'log' && <LogPage />}
      </main>
      
      {/* 푸터 */}
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          BTG - Batch Translator for Gemini | React + TypeScript | AI Studio Builder
        </div>
      </footer>
    </div>
  );
}
