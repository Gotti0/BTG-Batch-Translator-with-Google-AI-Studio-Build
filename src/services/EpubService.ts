/**
 * EPUB 파일 처리 서비스
 * 
 * 핵심 책임:
 * 1. Unzip: JSZip으로 EPUB 파일 로드 및 압축 해제
 * 2. Locate: container.xml → .opf 파일 찾기 및 읽기 순서(Spine) 파악
 * 3. Parse (Flattening): XHTML 파싱 → EpubNode[] 변환
 * 4. Reconstruct: 번역된 노드 → XHTML 문자열 재조립
 * 5. Re-zip: 변경된 XHTML 파일 → 새 EPUB 생성
 */

import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import {
  EpubNode,
  EpubChapter,
  EpubFile,
  EpubMetadata,
  OPFManifestItem,
  OPFSpineItem,
} from '../types/epub';

export class EpubService {
  /**
   * EPUB 파일을 로드하고 파싱
   * 
   * @param file EPUB 파일 (File 객체)
   * @returns EpubChapter[] 평탄화된 챕터 배열
   * @throws Error EPUB 파일 형식 오류 또는 파싱 실패
   */
  async parseEpubFile(file: File): Promise<EpubChapter[]> {
    try {
      // 1. JSZip으로 EPUB 파일 로드
      const zip = new JSZip();
      const epubData = await file.arrayBuffer();
      await zip.loadAsync(epubData);

      // 2. container.xml 찾기 및 파싱
      const containerXml = await this.readFileFromZip(zip, 'META-INF/container.xml');
      const opfPath = this.extractOPFPath(containerXml);

      if (!opfPath) {
        throw new Error('OPF 파일 경로를 찾을 수 없습니다.');
      }

      // 3. OPF 파일 읽기 (메타데이터 + Spine 순서)
      const opfContent = await this.readFileFromZip(zip, opfPath);
      const spineItemrefs = this.extractSpineOrder(opfContent);
      const manifestItems = this.extractManifestItems(opfContent);

      // 4. Spine 순서에 따라 XHTML 파일 파싱
      const chapters: EpubChapter[] = [];

      for (const idref of spineItemrefs) {
        const manifestItem = manifestItems.find((item) => item.id === idref);
        if (!manifestItem || !manifestItem.href.endsWith('.xhtml')) {
          continue;
        }

        // OPF 파일의 상대 경로 기준으로 XHTML 파일 위치 계산
        const basePath = opfPath.substring(0, opfPath.lastIndexOf('/'));
        let xhtmlPath = manifestItem.href;
        
        // 상대 경로인 경우 (href가 '/'로 시작하지 않음)
        if (!manifestItem.href.startsWith('/') && basePath) {
          xhtmlPath = `${basePath}/${manifestItem.href}`.replace(/\/+/g, '/');
        }

        try {
          const xhtmlContent = await this.readFileFromZip(zip, xhtmlPath);
          const nodes = this.parseXhtml(xhtmlContent);

          chapters.push({
            fileName: manifestItem.href,
            nodes,
          });

          console.log(`✅ 파싱 완료: ${manifestItem.href} (${nodes.length}개 노드)`);
        } catch (error) {
          console.warn(`⚠️ XHTML 파싱 실패: ${xhtmlPath}`, error);
          console.log(`   시도: ${xhtmlPath}, OPF: ${opfPath}, href: ${manifestItem.href}`);
        }
      }

      console.log(`📚 총 ${chapters.length}개 챕터 파싱 완료`);
      return chapters;
    } catch (error) {
      console.error('❌ EPUB 파일 로드 실패:', error);
      throw new Error(`EPUB 파일 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * XHTML 문자열을 파싱하여 평탄화된 노드 배열 반환
   * 
   * 전략:
   * - <p>, <h1>~<h6>, <div> → type: 'text' (번역 대상)
   * - <img>, <svg> → type: 'image' (보존)
   * - 기타 구조 태그 → type: 'ignored' (보존)
   * 
   * @param xhtmlContent XHTML 문자열
   * @returns EpubNode[] 평탄화된 노드 배열
   */
  parseXhtml(xhtmlContent: string): EpubNode[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml');

    // 파싱 오류 체크
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('XHTML 파싱 오류');
    }

    const nodes: EpubNode[] = [];
    const textBlockTags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'section', 'article'];
    const imageTags = ['img', 'svg'];

    // body 요소 찾기
    const body = doc.body;
    if (!body) {
      console.warn('⚠️ body 요소를 찾을 수 없습니다.');
      return nodes;
    }

    // body의 직계 자식들 순회
    Array.from(body.children).forEach((el) => {
      const tagName = el.tagName.toLowerCase();

      if (imageTags.includes(tagName)) {
        // 이미지 태그: 원본 HTML 통째로 보존
        nodes.push({
          id: uuidv4(),
          type: 'image',
          tag: tagName,
          html: el.outerHTML,
        });
      } else if (textBlockTags.includes(tagName) && el.textContent?.trim()) {
        // 텍스트 블록 태그: 순수 텍스트만 추출
        nodes.push({
          id: uuidv4(),
          type: 'text',
          tag: tagName,
          content: this.extractPureText(el),
          attributes: this.getAttributes(el),
        });
      } else if (el.textContent?.trim()) {
        // 기타 태그이지만 텍스트 있음: ignored로 보존
        nodes.push({
          id: uuidv4(),
          type: 'ignored',
          tag: tagName,
          html: el.outerHTML,
        });
      }
    });

    return nodes;
  }

  /**
   * 순수 텍스트 추출 (인라인 태그 및 루비 문자 제거)
   * 
   * 전략:
   * 1. 요소 깊은 복사 (원본 DOM 보존)
   * 2. <rt> (발음 정보) 태그 제거 (루비 문자 처리)
   * 3. <rp> (괄호) 태그 제거
   * 4. textContent로 순수 텍스트만 추출
   * 
   * @param element 정제할 DOM 요소
   * @returns 순수 텍스트
   */
  private extractPureText(element: Element): string {
    // 1. 깊은 복사 (원본 DOM 보존)
    const clone = element.cloneNode(true) as Element;

    // 2. 루비 문자 처리: <rt> 태그 제거 (일본어 요미가나, 중국어 주음 등)
    const rtTags = clone.querySelectorAll('rt');
    rtTags.forEach((rt) => rt.remove());

    // 3. <rp> 태그 제거 (루비 괄호)
    const rpTags = clone.querySelectorAll('rp');
    rpTags.forEach((rp) => rp.remove());

    // 4. 순수 텍스트 추출
    return clone.textContent?.trim() ?? '';
  }

  /**
   * DOM 요소에서 속성 추출
   * 
   * @param el DOM 요소
   * @returns 속성 객체 (class, id, style 등)
   */
  private getAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};

    Array.from(el.attributes).forEach((attr) => {
      if (['class', 'id', 'style', 'data-*'].some((a) => attr.name.includes(a))) {
        attrs[attr.name] = attr.value;
      }
    });

    return Object.keys(attrs).length > 0 ? attrs : undefined;
  }

  /**
   * 번역된 노드 배열을 XHTML 문자열로 재조립
   * 
   * @param nodes 번역된 EpubNode 배열
   * @returns XHTML 문자열
   */
  reconstructXhtml(nodes: EpubNode[]): string {
    let xhtmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xhtmlContent += '<html xmlns="http://www.w3.org/1999/xhtml">\n<body>\n';

    nodes.forEach((node) => {
      if (node.type === 'text') {
        // 텍스트 노드: 번역된 내용으로 태그 재생성
        const attrs = node.attributes ? this.attributesToString(node.attributes) : '';
        xhtmlContent += `  <${node.tag}${attrs}>${this.escapeHtml(node.content ?? '')}</${node.tag}>\n`;
      } else {
        // image / ignored: 원본 HTML 그대로 사용
        xhtmlContent += `  ${node.html}\n`;
      }
    });

    xhtmlContent += '</body>\n</html>';
    return xhtmlContent;
  }

  /**
   * 번역된 EPUB 파일 생성 및 다운로드
   * 
   * @param originalFile 원본 EPUB 파일
   * @param chapters 번역된 챕터 배열
   * @returns Blob (다운로드용)
   */
  async generateEpubBlob(originalFile: File, chapters: EpubChapter[]): Promise<Blob> {
    const zip = new JSZip();
    const epubData = await originalFile.arrayBuffer();
    await zip.loadAsync(epubData);

    // 챕터별로 XHTML 파일 업데이트
    for (const chapter of chapters) {
      const xhtmlContent = this.reconstructXhtml(chapter.nodes);
      zip.file(chapter.fileName, xhtmlContent);
    }

    // 새 EPUB Blob 생성
    return await zip.generateAsync({ type: 'blob' });
  }

  /**
   * ZIP 파일에서 특정 파일 읽기
   * 
   * @param zip JSZip 객체
   * @param path 파일 경로
   * @returns 파일 내용 (문자열)
   */
  private async readFileFromZip(zip: JSZip, path: string): Promise<string> {
    const file = zip.file(path);
    if (!file) {
      throw new Error(`파일을 찾을 수 없습니다: ${path}`);
    }
    return await file.async('text');
  }

  /**
   * container.xml에서 OPF 파일 경로 추출
   * 
   * @param containerXml container.xml 내용
   * @returns OPF 파일 경로
   */
  private extractOPFPath(containerXml: string): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(containerXml, 'application/xml');
    const rootfile = doc.querySelector('rootfile');
    return rootfile?.getAttribute('full-path') ?? null;
  }

  /**
   * OPF 파일에서 Spine 순서 추출
   * 
   * @param opfContent OPF 파일 내용
   * @returns idref 배열 (읽기 순서)
   */
  private extractSpineOrder(opfContent: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfContent, 'application/xml');
    const spineItems = doc.querySelectorAll('spine > itemref');

    return Array.from(spineItems)
      .map((item) => item.getAttribute('idref'))
      .filter((idref): idref is string => idref !== null);
  }

  /**
   * OPF 파일에서 Manifest 항목 추출
   * 
   * @param opfContent OPF 파일 내용
   * @returns OPFManifestItem 배열
   */
  private extractManifestItems(opfContent: string): OPFManifestItem[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfContent, 'application/xml');
    const items = doc.querySelectorAll('manifest > item');

    return Array.from(items)
      .map((item) => ({
        id: item.getAttribute('id') ?? '',
        href: item.getAttribute('href') ?? '',
        'media-type': item.getAttribute('media-type') ?? '',
      }))
      .filter((item) => item.id && item.href);
  }

  /**
   * 속성 객체를 HTML 속성 문자열로 변환
   * 
   * @param attrs 속성 객체
   * @returns HTML 속성 문자열
   */
  private attributesToString(attrs: Record<string, string>): string {
    return Object.entries(attrs)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join('');
  }

  /**
   * HTML 특수 문자 이스케이프
   * 
   * @param text 원문
   * @returns 이스케이프된 텍스트
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return text.replace(/[&<>"']/g, (char) => map[char]);
  }
}

// 싱글톤 인스턴스 export
export const epubService = new EpubService();
