// utils/fileHandler.ts
// Python infrastructure/file_handler.py 의 브라우저 버전 TypeScript 변환

import type { FileContent } from '../types/dtos';

/**
 * 브라우저 환경에서 파일 입출력을 처리하는 유틸리티 클래스
 */
export class FileHandler {
  /**
   * 파일 선택 다이얼로그를 열고 텍스트 파일을 읽습니다.
   * 
   * @param accept - 허용할 파일 형식 (기본값: '.txt,.json')
   * @returns FileContent 객체 또는 null (취소 시)
   */
  static async selectAndReadFile(accept: string = '.txt,.json'): Promise<FileContent | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const content = await this.readFileAsText(file);
          resolve({
            name: file.name,
            content,
            size: file.size,
            lastModified: file.lastModified,
          });
        } catch (error) {
          console.error('파일 읽기 실패:', error);
          resolve(null);
        }
      };

      // 취소 처리
      input.oncancel = () => resolve(null);

      input.click();
    });
  }

  /**
   * 여러 파일을 선택하고 읽습니다.
   * 
   * @param accept - 허용할 파일 형식 (기본값: '.txt')
   * @returns FileContent 배열
   */
  static async selectAndReadMultipleFiles(accept: string = '.txt'): Promise<FileContent[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = true;

      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files || files.length === 0) {
          resolve([]);
          return;
        }

        const results: FileContent[] = [];
        for (const file of Array.from(files)) {
          try {
            const content = await this.readFileAsText(file);
            results.push({
              name: file.name,
              content,
              size: file.size,
              lastModified: file.lastModified,
            });
          } catch (error) {
            console.error(`파일 읽기 실패 (${file.name}):`, error);
          }
        }
        resolve(results);
      };

      // 취소 처리
      input.oncancel = () => resolve([]);

      input.click();
    });
  }

  /**
   * File 객체를 텍스트로 읽습니다.
   * 
   * @param file - 읽을 File 객체
   * @param encoding - 문자 인코딩 (기본값: 'utf-8')
   * @returns 파일 내용 문자열
   */
  static readFileAsText(file: File, encoding: string = 'utf-8'): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, encoding);
    });
  }

  /**
   * 드래그 앤 드롭된 파일들을 읽습니다.
   * 
   * @param dataTransfer - 드래그 이벤트의 dataTransfer
   * @param accept - 허용할 파일 확장자 배열 (기본값: ['.txt'])
   * @returns FileContent 배열
   */
  static async readDroppedFiles(
    dataTransfer: DataTransfer,
    accept: string[] = ['.txt']
  ): Promise<FileContent[]> {
    const files = Array.from(dataTransfer.files);
    const results: FileContent[] = [];

    for (const file of files) {
      // 확장자 필터링
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!accept.includes(ext) && !accept.includes('*')) {
        console.warn(`지원하지 않는 파일 형식: ${file.name}`);
        continue;
      }

      try {
        const content = await this.readFileAsText(file);
        results.push({
          name: file.name,
          content,
          size: file.size,
          lastModified: file.lastModified,
        });
      } catch (error) {
        console.error(`파일 읽기 실패 (${file.name}):`, error);
      }
    }

    return results;
  }

  /**
   * 텍스트를 파일로 다운로드합니다.
   * 
   * @param content - 저장할 텍스트 내용
   * @param filename - 파일 이름
   * @param mimeType - MIME 타입 (기본값: 'text/plain;charset=utf-8')
   */
  static downloadTextFile(
    content: string,
    filename: string,
    mimeType: string = 'text/plain;charset=utf-8'
  ): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /**
   * JSON 데이터를 파일로 다운로드합니다.
   * 
   * @param data - 저장할 데이터
   * @param filename - 파일 이름
   * @param indent - JSON 들여쓰기 (기본값: 2)
   */
  static downloadJsonFile(data: unknown, filename: string, indent: number = 2): void {
    const content = JSON.stringify(data, null, indent);
    this.downloadTextFile(content, filename, 'application/json;charset=utf-8');
  }

  /**
   * 파일 크기를 사람이 읽기 쉬운 형식으로 변환합니다.
   * 
   * @param bytes - 바이트 크기
   * @returns 포맷된 크기 문자열 (예: "1.5 MB")
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 파일 확장자를 추출합니다.
   * 
   * @param filename - 파일 이름
   * @returns 확장자 (점 포함, 예: ".txt")
   */
  static getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
  }

  /**
   * 파일 이름에서 확장자를 제거합니다.
   * 
   * @param filename - 파일 이름
   * @returns 확장자가 제거된 파일 이름
   */
  static removeFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(0, lastDot) : filename;
  }

  /**
   * 번역 결과 파일 이름을 생성합니다.
   * 
   * @param originalFilename - 원본 파일 이름
   * @param suffix - 추가할 접미사 (기본값: '_translated')
   * @returns 새 파일 이름
   */
  static generateTranslatedFilename(
    originalFilename: string,
    suffix: string = '_translated'
  ): string {
    const baseName = this.removeFileExtension(originalFilename);
    const extension = this.getFileExtension(originalFilename) || '.txt';
    return `${baseName}${suffix}${extension}`;
  }
}

/**
 * 메타데이터 저장 클래스 (LocalStorage 기반)
 */
export class MetadataStorage {
  private prefix: string;

  constructor(prefix: string = 'btg_') {
    this.prefix = prefix;
  }

  /**
   * 데이터를 저장합니다.
   * 
   * @param key - 저장 키
   * @param data - 저장할 데이터
   */
  save<T>(key: string, data: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(data));
    } catch (error) {
      console.error(`메타데이터 저장 실패 (${key}):`, error);
    }
  }

  /**
   * 데이터를 로드합니다.
   * 
   * @param key - 로드할 키
   * @returns 저장된 데이터 또는 null
   */
  load<T>(key: string): T | null {
    try {
      const data = localStorage.getItem(this.prefix + key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`메타데이터 로드 실패 (${key}):`, error);
      return null;
    }
  }

  /**
   * 데이터를 삭제합니다.
   * 
   * @param key - 삭제할 키
   */
  remove(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  /**
   * 해당 prefix로 시작하는 모든 데이터를 삭제합니다.
   */
  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  /**
   * 저장된 모든 키를 반환합니다.
   * 
   * @returns 키 배열 (prefix 제외)
   */
  keys(): string[] {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        result.push(key.slice(this.prefix.length));
      }
    }
    return result;
  }
}

// 싱글톤 인스턴스
export const metadataStorage = new MetadataStorage();
