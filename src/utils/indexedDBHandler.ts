/**
 * IndexedDB 핸들러 유틸리티
 * * 목적: AI Studio 샌드박스 환경(iframe) 내에서 대용량 데이터(스냅샷)를
 * 영구 저장하기 위한 IndexedDB 래퍼 클래스입니다.
 * * 주요 기능:
 * - 스냅샷 저장 (Auto-save)
 * - 스냅샷 로드 (Restore)
 * - 스냅샷 삭제 (Clear)
 * * 특징:
 * - 외부 라이브러리 없이 네이티브 API 사용 (Zero Dependency)
 * - Promise 기반 비동기 처리
 */

export class IndexedDBHandler {
  private static readonly DB_NAME = 'BTG_Database';
  private static readonly STORE_NAME = 'autosave_store';
  private static readonly KEY = 'latest_snapshot';
  private static readonly VERSION = 1;

  /**
   * DB 연결을 엽니다.
   */
  private static openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // 1. 브라우저 지원 여부 확인
      if (!('indexedDB' in window)) {
        reject(new Error("이 브라우저는 IndexedDB를 지원하지 않습니다."));
        return;
      }

      // 2. DB 열기 요청
      const request = window.indexedDB.open(this.DB_NAME, this.VERSION);

      // 3. 스키마 생성/업그레이드 (최초 실행 시)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          // 키-밸류 저장소 생성 (KeyPath 없음)
          db.createObjectStore(this.STORE_NAME);
          console.log(`[IndexedDB] 객체 저장소 생성됨: ${this.STORE_NAME}`);
        }
      };

      // 4. 성공 핸들러
      request.onsuccess = () => {
        resolve(request.result);
      };

      // 5. 에러 핸들러
      request.onerror = () => {
        console.error('[IndexedDB] DB 열기 실패:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 스냅샷 데이터를 저장합니다. (덮어쓰기)
   * @param data 저장할 데이터 (JSON 직렬화된 문자열 또는 객체)
   */
  static async saveSnapshot(data: any): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        
        const request = store.put(data, this.KEY);

        request.onsuccess = () => {
          // console.debug('[IndexedDB] 스냅샷 저장 완료'); // 디버그용 로그
          resolve();
        };

        request.onerror = () => {
          console.error('[IndexedDB] 스냅샷 저장 실패:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn('[IndexedDB] 저장 건너뜀 (DB 접근 불가):', error);
      // 저장 실패가 앱을 멈추지 않도록 예외를 삼킴 (선택 사항)
    }
  }

  /**
   * 저장된 스냅샷을 불러옵니다.
   * @returns 저장된 데이터 또는 null
   */
  static async loadSnapshot(): Promise<any | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        
        const request = store.get(this.KEY);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = () => {
          console.error('[IndexedDB] 스냅샷 로드 실패:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn('[IndexedDB] 로드 실패 (DB 접근 불가):', error);
      return null;
    }
  }

  /**
   * 저장된 스냅샷을 삭제합니다.
   */
  static async clearSnapshot(): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        
        const request = store.delete(this.KEY);

        request.onsuccess = () => {
          console.log('[IndexedDB] 스냅샷 삭제 완료');
          resolve();
        };

        request.onerror = () => {
          console.error('[IndexedDB] 스냅샷 삭제 실패:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn('[IndexedDB] 삭제 실패:', error);
    }
  }
}
