
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
          // [결정론적 ID 생성] 파일명(href) 전달
          const nodes = this.parseXhtml(xhtmlContent, manifestItem.href);

          chapters.push({
            fileName: xhtmlPath, // [수정] ZIP 내부의 전체 경로를 사용해야 덮어쓰기가 됨
            nodes,
          });

          console.log(`✅ 파싱 완료: ${xhtmlPath} (${nodes.length}개 노드)`);
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
   * 전략 (Recursive Flattening):
   * - <p>, <h1>~<h6> 등 블록 요소는 즉시 노드로 추출
   * - <div>, <section> 등 컨테이너는 내부에 블록 요소가 있으면 재귀 순회, 없으면 노드로 추출
   * - <img>, <svg>는 이미지 노드로 보존
   * - 인라인 요소(span 등)가 컨테이너 바로 아래 있으면 독립 노드로 처리
   * 
   * [결정론적 ID 규칙]
   * ID = `{fileName}_{nodeIndex}`
   * 
   * @param xhtmlContent XHTML 문자열
   * @param fileName 현재 파싱 중인 파일의 이름(경로)
   * @returns EpubNode[] 평탄화된 노드 배열
   */
  parseXhtml(xhtmlContent: string, fileName: string): EpubNode[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml');

    // 파싱 오류 체크
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('XHTML 파싱 오류');
    }

    const nodes: EpubNode[] = [];
    let nodeIndex = 0;

    // 태그 분류 정의
    const imageTags = ['img', 'svg'];
    // 말단 블록 태그: 더 이상 분해하지 않고 텍스트를 추출할 단위
    const leafBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'hr'];
    // 컨테이너 태그: 내부 구조에 따라 재귀 여부를 결정할 태그들
    const potentialContainerTags = [
      'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 
      'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th', 'body', 'form', 'nav'
    ];

    /**
     * 재귀 순회 함수
     */
    const traverse = (element: Element) => {
      const children = Array.from(element.children);

      children.forEach((el) => {
        const tagName = el.tagName.toLowerCase();

        // 1. 이미지 처리
        if (imageTags.includes(tagName)) {
          const deterministicId = `${fileName}_${nodeIndex++}`;
          let imagePath: string | undefined;

          if (tagName === 'img') {
            imagePath = el.getAttribute('src') || undefined;
          } else if (tagName === 'svg') {
            const innerImg = el.querySelector('image');
            if (innerImg) {
              imagePath = innerImg.getAttribute('href') || innerImg.getAttribute('xlink:href') || undefined;
            }
          }

          if (imagePath) {
            imagePath = this.resolvePath(fileName, imagePath);
          }

          nodes.push({
            id: deterministicId,
            type: 'image',
            tag: tagName,
            html: el.outerHTML,
            imagePath,
          });
          return;
        }

        // 2. 말단 블록 처리 (p, h1, etc.)
        if (leafBlockTags.includes(tagName)) {
          const deterministicId = `${fileName}_${nodeIndex++}`;
          if (tagName === 'hr') {
            nodes.push({ id: deterministicId, type: 'ignored', tag: tagName, html: el.outerHTML });
          } else {
            const content = this.extractPureText(el);
            if (content) {
              nodes.push({
                id: deterministicId,
                type: 'text',
                tag: tagName,
                content,
                attributes: this.getAttributes(el),
              });
            }
          }
          return;
        }

        // 3. 컨테이너 처리 (div, section, etc.)
        if (potentialContainerTags.includes(tagName)) {
          // 내부에 블록 레벨 자식이 있는지 확인 (재귀 필요성 판단)
          const hasBlockChildren = Array.from(el.children).some(child => {
            const t = child.tagName.toLowerCase();
            return leafBlockTags.includes(t) || potentialContainerTags.includes(t);
          });

          if (hasBlockChildren) {
            // 블록 자식이 있으면 컨테이너를 해체하고 내부로 진입
            traverse(el);
          } else {
            // 블록 자식이 없으면(텍스트나 인라인만 있음) 하나의 텍스트 노드로 취급
            const content = this.extractPureText(el);
            if (content) {
              const deterministicId = `${fileName}_${nodeIndex++}`;
              nodes.push({
                id: deterministicId,
                type: 'text',
                tag: tagName,
                content,
                attributes: this.getAttributes(el),
              });
            }
          }
          return;
        }

        // 4. 인라인 요소 (span, a, etc.)
        // 컨테이너 재귀 진입으로 인해 노출된 인라인 요소들은 독립된 텍스트 노드로 처리
        // (예: <div><p>A</p><span>B</span></div> -> P와 Span이 형제 노드처럼 처리됨)
        const content = this.extractPureText(el);
        if (content) {
          const deterministicId = `${fileName}_${nodeIndex++}`;
          nodes.push({
            id: deterministicId,
            type: 'text',
            tag: tagName,
            content,
            attributes: this.getAttributes(el),
          });
        }
      });
    };

    // body부터 탐색 시작
    if (doc.body) {
      traverse(doc.body);
    }

    return nodes;
  }

  /**
   * 경로 정규화 (상대 경로 -> 절대 경로)
   * 
   * @param basePath 기준 파일 경로 (예: OEBPS/Text/chap1.xhtml)
   * @param relativePath 상대 경로 (예: ../Images/img1.jpg)
   * @returns 정규화된 절대 경로 (예: OEBPS/Images/img1.jpg)
   */
  private resolvePath(basePath: string, relativePath: string): string {
    // 이미 절대 경로이거나 URL인 경우
    if (relativePath.startsWith('/') || relativePath.match(/^[a-z]+:/i)) {
      return relativePath;
    }

    const stack = basePath.split('/');
    stack.pop(); // 현재 파일명 제거 (디렉토리 기준)

    const parts = relativePath.split('/');
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(part);
      }
    }

    return stack.join('/');
  }

  /**
   * ZIP 파일에서 이미지 데이터 읽기
   * 
   * @param zip JSZip 객체
   * @param path 이미지 파일 경로
   * @returns 이미지 데이터 (Uint8Array) 또는 null
   */
  async getImageData(zip: JSZip, path: string): Promise<Uint8Array | null> {
    // URL 디코딩 (경로에 %20 등이 포함된 경우 처리)
    const decodedPath = decodeURIComponent(path);
    const file = zip.file(decodedPath);
    
    if (!file) {
      console.warn(`이미지 파일을 찾을 수 없습니다: ${decodedPath}`);
      // 대소문자 무시하고 검색 시도 (일부 EPUB은 경로 대소문자가 불일치함)
      const foundFile = zip.file(new RegExp(decodedPath, 'i'))[0];
      if (foundFile) {
        console.log(`대소문자 무시 검색으로 파일 찾음: ${foundFile.name}`);
        return await foundFile.async('uint8array');
      }
      return null;
    }
    return await file.async('uint8array');
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
