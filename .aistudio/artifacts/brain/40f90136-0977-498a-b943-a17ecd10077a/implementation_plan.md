# 브라우저 직접 호출(클라이언트 SDK) 방식으로 되돌리기 계획

## 1. 개요 및 목표
백엔드 프록시 서버를 거치는 서버 사이드 Gemini API 호출 구조를 되돌려, **접속한 사용자의 브라우저에서 직접 `@google/genai` SDK를 호출하는 원래의 클라이언트 아키텍처**로 복원합니다. 이를 통해 고정된 단일 프로젝트 API 키에 모든 쿼터가 집중되는 현상을 없애고, Preview를 여는 각 구글 계정의 AI Studio 무료 티어(Free Tier) 할당량을 기존과 동일하게 사용할 수 있도록 합니다.

---

## 2. 아키텍처 변경 다이어그램

```
[변경 전: 서버 사이드 프록시 구조]
브라우저 (GeminiClient) ──HTTP(/api/gemini/*)──> Express 서버 ──> 고정된 프로젝트 API Key 쿼터 소모

[복원 후: 브라우저 직접 호출 구조 (원본 방식)]
브라우저 (GeminiClient) ──@google/genai SDK 직접 호출──> 현재 접속 계정의 AI Studio 쿼터 사용
```

---

## 3. 세부 복원 범위

### 3.1 Gemini 클라이언트 SDK 직접 호출 복원
- **클라이언트 SDK 초기화 복원**: 브라우저 측 Gemini 클라이언트 내부에서 `@google/genai`의 `GoogleGenAI` 인스턴스를 직접 생성하여 호출하도록 되돌립니다 (`process.env.API_KEY` 및 `process.env.GEMINI_API_KEY` 바인딩 지원).
- **단건·채팅·스트리밍·모델 목록·표지 생성 복원**:
  - 일반 텍스트 생성(`ai.models.generateContent`)
  - 채팅 세션 기반 생성(`ai.chats.create` 및 `chat.sendMessage`)
  - 실시간 스트리밍 생성(`ai.models.generateContentStream`)
  - 사용 가능한 모델 및 이미지 모델 목록 조회(`ai.models.list`)
  - 표지 이미지 생성 및 편집 호출
  - PDF 입력(`MEDIA_RESOLUTION_LOW`) 및 429 한도 분석·콘텐츠 안전 예외 분류 로직은 그대로 유지합니다.

### 3.2 백엔드 프록시 및 불필요한 서버 구성 제거
- **백엔드 서버 및 Live 프록시 제거**: 프록시 전용으로 추가되었던 Express 서버와 미사용 Live WebSocket 클라이언트 모듈을 제거합니다.
- **실행 스크립트 및 Vite 설정 복원**: 개발 서버를 순수 Vite SPA 서버(`vite`)로 구동하도록 되돌리고, 빌드 타임에 브라우저가 `process.env.API_KEY` / `process.env.GEMINI_API_KEY`를 참조할 수 있도록 Vite `define` 설정을 복원합니다.
- **플랫폼 메타데이터 복원**: 서버 사이드 Gemini API 기능 선언을 비워(`majorCapabilities: []`), AI Studio 환경에서 접속 계정 기준의 기본 쿼터 모드로 동작하도록 되돌립니다.

### 3.3 단위 테스트 복원
- Gemini 클라이언트 단위 테스트가 `fetch` 모킹 대신 `@google/genai` SDK 인스턴스 메서드를 검증하도록 원래의 테스트 구조로 복원합니다.
