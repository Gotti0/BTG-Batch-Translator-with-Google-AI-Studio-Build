import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/App.tsx';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';

// React 앱을 DOM에 마운트
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

console.log('🚀 BTG - Batch Translator for Gemini 시작됨');
