
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
import { splitTextByDelimiterChapters, type ExportGlossaryItem } from '../utils/epubExportUtils';

/**
 * 텍스트 번역본 EPUB 내보내기 옵션
 */
export interface TextEpubExportOptions {
  title: string;
  author: string;
  description?: string;
  coverImageDataUrl?: string;
  chunks: Array<{ chunkIndex: number; text: string }>;
  glossaryTerms?: ExportGlossaryItem[];
  splitMode?: 'chunk' | 'delimiter';
  delimiterRegex?: string;
  delimiterMinDistance?: number;
}

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
      
      // [수정] Spine에 포함되지 않은 Nav 파일도 찾아서 추가해야 함
      // EPUB3에서는 properties="nav" 속성을 가진 아이템이 목차 파일임
      const navItem = manifestItems.find(item => {
        // properties 속성은 extractManifestItems에서 추출하지 않았으므로, 
        // href나 id로 추측하거나 extractManifestItems를 수정해야 함.
        // 여기서는 간단히 href에 'nav'가 포함되거나 id가 'nav', 'toc'인 경우를 체크
        return item.href.toLowerCase().includes('nav') || item.id.toLowerCase().includes('nav') || item.id.toLowerCase() === 'toc';
      });

      // Spine 목록 복사
      const itemsToProcess = [...spineItemrefs];
      
      // Nav 파일이 Spine에 없다면 추가 (보통 맨 앞에 위치시키는 것이 좋음)
      if (navItem && !spineItemrefs.includes(navItem.id)) {
        console.log(`📌 Spine에 없는 Nav 파일 발견: ${navItem.id} (${navItem.href})`);
        itemsToProcess.unshift(navItem.id);
      }

      for (const idref of itemsToProcess) {
        const manifestItem = manifestItems.find((item) => item.id === idref);
        // [수정] .html, .htm 확장자도 허용
        if (!manifestItem || !/\.(xhtml|html|htm)$/i.test(manifestItem.href)) {
          // 추가로 media-type이 application/xhtml+xml 인지 확인하면 더 정확하겠지만, 
          // 일반적으로 확장자로 1차 필터링함.
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
          // [결정론적 ID 생성] 파일명(href) 전달 -> [수정] 전체 경로(xhtmlPath) 전달
          // TranslationPage에서 챕터 분배 시 fileName(xhtmlPath)과 ID 접두사를 대조하므로 일치시켜야 함
          const { nodes, head } = this.parseXhtml(xhtmlContent, xhtmlPath);

          // [디버깅] 파싱된 노드 검증
          if (nodes.length === 0) {
             console.warn(`⚠️ 빈 챕터 감지: ${xhtmlPath}`);
             // 원본 내용 로깅 (너무 길면 앞부분만)
             console.log(`   - 원본 내용(앞 100자): ${xhtmlContent.substring(0, 100).replace(/\n/g, ' ')}`);
          }

          chapters.push({
            fileName: xhtmlPath, // [수정] ZIP 내부의 전체 경로를 사용해야 덮어쓰기가 됨
            nodes,
            head,
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
   * @returns { nodes: EpubNode[], head: string } 평탄화된 노드 배열 및 헤드 내용
   */
  parseXhtml(xhtmlContent: string, fileName: string): { nodes: EpubNode[], head: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtmlContent, 'application/xhtml+xml');

    // 파싱 오류 체크
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('XHTML 파싱 오류');
    }

    const nodes: EpubNode[] = [];
    let nodeIndex = 0;

    // 헤드 태그 내용 추출 (title, meta, link 등 보존)
    let head = '';
    if (doc.head) {
      // Title 태그를 별도 노드로 추출하여 번역 대상에 포함
      const titleEl = doc.head.querySelector('title');
      if (titleEl) {
        const content = titleEl.textContent || '';
        // Title은 body가 아닌 head에 속하므로 특별한 ID 부여 (순서상 맨 앞)
        const deterministicId = `${fileName}_title`;
        
        nodes.push({
          id: deterministicId,
          type: 'text',
          tag: 'title',
          content,
          attributes: this.getAttributes(titleEl),
        });
        
        // head 문자열에서 title 제거 (중복 방지)
        titleEl.remove();
      }
      head = doc.head.innerHTML;
    }

    // [개선] 태그 분류를 하드코딩하지 않고 기능적 역할에 따라 최소화된 기준으로 정의합니다.
    const imageTags = ['img', 'svg', 'image'];
    const atomicSelfClosingTags = ['hr', 'br'];
    // 반드시 구조(태그)가 유지되어야 하는 컨테이너
    const structuralTags = ['nav', 'ol', 'ul', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'dl', 'dt', 'dd', 'blockquote'];
    
    // 내부를 분해해서 탐색해야 할지 결정하는 '복합 콘텐츠' 셀렉터
    const complexContentSelector = [...imageTags, ...atomicSelfClosingTags, ...structuralTags, 'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].join(',');

    /**
     * 재귀 순회 함수
     */
    const traverse = (element: Element) => {
      const children = Array.from(element.children);

      children.forEach((el) => {
        const tagName = el.tagName.toLowerCase();

        // 1. 이미지 처리 (최우선)
        if (imageTags.includes(tagName)) {
          const deterministicId = `${fileName}_${nodeIndex++}`;
          let imagePath: string | undefined;

          if (tagName === 'img') {
            imagePath = el.getAttribute('src') || undefined;
          } else {
            const innerImg = tagName === 'svg' ? el.querySelector('image') : el;
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

        // 2. 기타 원자적 태그 (hr 등)
        if (atomicSelfClosingTags.includes(tagName)) {
          nodes.push({ id: `${fileName}_${nodeIndex++}`, type: 'ignored', tag: tagName, html: el.outerHTML });
          return;
        }

        // 3. 동적 컨테이너 판별 로직
        // - 구조적 태그이거나
        // - 내부에 '복합 요소(이미지, 블록 등)'를 포함하고 있는 경우
        // -> 이 경우 태그를 보존하고 내부로 진입합니다.
        const isStructural = structuralTags.includes(tagName);
        const hasComplexContent = el.querySelector(complexContentSelector) !== null;

        if (isStructural || hasComplexContent) {
           const clone = el.cloneNode(false) as Element;
           const html = clone.outerHTML;
           const openingHtml = html.substring(0, html.lastIndexOf('<') || html.length);
           
           nodes.push({ id: `${fileName}_${nodeIndex++}`, type: 'ignored', tag: tagName, html: openingHtml });
           
           traverse(el);
           
           nodes.push({ id: `${fileName}_${nodeIndex++}`, type: 'ignored', tag: tagName, html: `</${tagName}>` });
        } else {
          // 4. 더 이상 쪼갤 필요가 없는 말단 텍스트 블록 (p, span, div 등 모든 태그 해당)
          const content = this.extractPureText(el);
          if (content) {
            nodes.push({
              id: `${fileName}_${nodeIndex++}`,
              type: 'text',
              tag: tagName,
              content,
              attributes: this.getAttributes(el),
            });
          }
        }
      });
    };

    // body부터 탐색 시작
    if (doc.body) {
      traverse(doc.body);
    }

    return { nodes, head };
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
      // [수정] href, alt, title 속성도 추출 대상에 포함
      if (['class', 'id', 'style', 'href', 'alt', 'title', 'data-*'].some((a) => attr.name.includes(a))) {
        attrs[attr.name] = attr.value;
      }
    });

    return Object.keys(attrs).length > 0 ? attrs : undefined;
  }

  /**
   * 번역된 노드 배열을 XHTML 문자열로 재조립
   * 
   * @param nodes 번역된 EpubNode 배열
   * @param head 원본 헤드 태그 내용 (옵션)
   * @returns XHTML 문자열
   */
  reconstructXhtml(nodes: EpubNode[], head?: string): string {
    let xhtmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xhtmlContent += '<html xmlns="http://www.w3.org/1999/xhtml">\n';
    
    // Head 재구성
    xhtmlContent += '<head>\n';
    if (head) {
      xhtmlContent += head + '\n';
    }
    
    // Title 노드 찾아서 Head에 추가
    const titleNode = nodes.find(n => n.tag === 'title');
    if (titleNode) {
      const attrs = titleNode.attributes ? this.attributesToString(titleNode.attributes) : '';
      xhtmlContent += `  <title${attrs}>${this.escapeHtml(titleNode.content ?? '')}</title>\n`;
    }
    xhtmlContent += '</head>\n';
    
    xhtmlContent += '<body>\n';

    nodes.forEach((node) => {
      // Title은 이미 Head에 추가했으므로 Body에서는 제외
      if (node.tag === 'title') return;

      if (node.type === 'text') {
        // 텍스트 노드: 번역된 내용으로 태그 재생성
        const attrs = node.attributes ? this.attributesToString(node.attributes) : '';
        // [수정] escapeHtml은 <br/> 태그까지 이스케이프해버리므로, 
        // 먼저 이스케이프한 뒤 복원하거나, 별도 로직으로 처리해야 함.
        // 여기서는 간단히 <br/> 태그만 예외적으로 허용하는 방식으로 처리
        let content = this.escapeHtml(node.content ?? '');
        content = content.replace(/&lt;br\/&gt;/g, '<br/>');
        
        xhtmlContent += `  <${node.tag}${attrs}>${content}</${node.tag}>\n`;
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

    // [추가] OPF 파일 수정 (page-progression-direction="rtl" -> "ltr")
    // 일본어/중국어 세로쓰기(RTL) 설정을 가로쓰기(LTR)로 변경
    try {
      const containerXml = await this.readFileFromZip(zip, 'META-INF/container.xml');
      const opfPath = this.extractOPFPath(containerXml);
      
      if (opfPath) {
        let opfContent = await this.readFileFromZip(zip, opfPath);
        
        // 정규식으로 page-progression-direction="rtl" 찾아서 "ltr"로 변경
        // 예: <spine page-progression-direction="rtl" toc="ncx">
        if (opfContent.includes('page-progression-direction="rtl"')) {
            opfContent = opfContent.replace(
                /(page-progression-direction=["'])rtl(["'])/gi, 
                '$1ltr$2'
            );
            zip.file(opfPath, opfContent);
            console.log('✅ OPF page-progression-direction updated to LTR');
        }
      }
    } catch (e) {
      console.warn('⚠️ OPF direction update failed:', e);
    }

    // 챕터별로 XHTML 파일 업데이트
    for (const chapter of chapters) {
      const xhtmlContent = this.reconstructXhtml(chapter.nodes, chapter.head);
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

  /**
   * 텍스트 번역본 청크와 프로젝트 정보로 EPUB 3 전자책(표지·소개·목차·본문·부록 용어집)을 만든다.
   * 표지가 없으면 표지 항목 없이 만든다.
   */
  async createEpubFromTextChunks(options: TextEpubExportOptions): Promise<Blob> {
    const {
      title,
      author,
      description,
      coverImageDataUrl,
      chunks,
      glossaryTerms = [],
      splitMode = 'chunk',
      delimiterRegex,
      delimiterMinDistance,
    } = options;

    const zip = new JSZip();

    // 1. mimetype (압축하지 않는 STORE 방식, 파일 맨 앞)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    // 2. META-INF/container.xml
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
      `  <rootfiles>\n` +
      `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
      `  </rootfiles>\n` +
      `</container>`
    );

    // 3. 표지 이미지 처리
    let coverFilename = 'cover.jpg';
    let coverMimeType = 'image/jpeg';
    let hasCover = false;
    if (coverImageDataUrl) {
      const match = coverImageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        coverMimeType = match[1];
        const base64Data = match[2];
        if (coverMimeType.includes('png')) coverFilename = 'cover.png';
        else if (coverMimeType.includes('webp')) coverFilename = 'cover.webp';
        else if (coverMimeType.includes('gif')) coverFilename = 'cover.gif';
        zip.file(`OEBPS/images/${coverFilename}`, base64Data, { base64: true });
        hasCover = true;
      }
    }

    // 4. 스타일시트
    const cssContent = `@charset "utf-8";
body {
  margin: 5%;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
  line-height: 1.8;
  word-break: break-word;
}
h1.chapter-title, h2.chunk-title {
  margin-top: 1.2em;
  margin-bottom: 1.5em;
  font-size: 1.4em;
  font-weight: bold;
  text-align: center;
  border-bottom: 1px solid currentColor;
  padding-bottom: 0.5em;
}
p {
  margin-top: 0;
  margin-bottom: 0.8em;
  text-indent: 1em;
}
p.empty-line {
  margin-bottom: 0.8em;
  text-indent: 0;
}
.cover-wrapper {
  margin: 0;
  padding: 0;
  text-align: center;
}
.cover-wrapper img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}
.intro-content {
  margin-top: 1.5em;
}
/* 목차 스타일: 브라우저/뷰어 기본 숫자 넘버링(1. 2. 3. ...) 제거 */
nav#toc ul {
  list-style: none;
  list-style-type: none;
  padding-left: 0;
  margin-left: 0;
}
nav#toc li {
  margin-bottom: 0.6em;
  list-style: none;
}
/* 용어집 테이블 스타일: 다크 테마 호환을 위해 투명 배경 및 상속 글자색 유지 */
.glossary-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1.5em;
  font-size: 0.88em;
  background: transparent;
}
.glossary-table th, .glossary-table td {
  border: 1px solid currentColor;
  padding: 8px 10px;
  text-align: left;
  background: transparent;
}
.glossary-table th {
  font-weight: 600;
}
`;
    zip.file('OEBPS/styles/style.css', cssContent);

    // 5. 표지 XHTML (검은색 배경 제거, 뷰박스 및 리셋 적용, 상하 여백 왜곡 방지)
    const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>Cover</title>
  <style type="text/css">
    @page { margin: 0; padding: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      text-align: center;
      background: transparent;
    }
    .cover-container {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .cover-container img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      margin: auto;
      display: block;
    }
  </style>
</head>
<body>
  <div class="cover-container">
    <img src="../images/${coverFilename}" alt="Cover Image"/>
  </div>
</body>
</html>`;
    if (hasCover) {
      zip.file('OEBPS/text/cover.xhtml', coverXhtml);
    }

    // 6. 소개문 XHTML (소개문이 있다면 표지와 목차 사이에 소개문 삽입)
    const hasIntro = Boolean(description && description.trim().length > 0);
    if (hasIntro) {
      const introParas = (description || '')
        .split('\n')
        .map((line) => line.trim())
        .map((line) => (line ? `<p>${this.escapeHtml(line)}</p>` : `<p class="empty-line">&#160;</p>`))
        .join('\n      ');

      const introXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>작품 소개</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
</head>
<body>
  <h1 class="chapter-title">작품 소개</h1>
  <div class="intro-content">
      ${introParas}
  </div>
</body>
</html>`;
      zip.file('OEBPS/text/intro.xhtml', introXhtml);
    }

    // 7. 챕터 목록 생성 (청크 단위 또는 구분자 정규식 단위)
    interface ExportChapterData {
      filename: string;
      title: string;
      text: string;
    }

    const exportChapters: ExportChapterData[] = [];

    if (splitMode === 'delimiter') {
      const fullText = chunks.map((c) => c.text || '').join('\n');
      const delimiterRule = delimiterRegex || '^[\\t \\u3000#]*(제\\s*\\d+\\s*[장화]).*$';
      const minDistance = typeof delimiterMinDistance === 'number' ? delimiterMinDistance : 10;
      const splitResults = splitTextByDelimiterChapters(fullText, delimiterRule, minDistance, title || '서두');

      splitResults.forEach((ch, idx) => {
        exportChapters.push({
          filename: `chapter_${idx + 1}.xhtml`,
          title: ch.title,
          text: ch.text,
        });
      });
    } else {
      // 기본값: 청크 단위 분할
      chunks.forEach((chunk, i) => {
        exportChapters.push({
          filename: `chunk_${i + 1}.xhtml`,
          title: `chunk ${chunk.chunkIndex + 1}`,
          text: chunk.text || '',
        });
      });
    }

    // 각 챕터별 본문 XHTML 기록
    for (let i = 0; i < exportChapters.length; i++) {
      const ch = exportChapters[i];
      const paras = (ch.text || '')
        .split('\n')
        .map((line) => line.trim())
        .map((line) => (line ? `<p>${this.escapeHtml(line)}</p>` : `<p class="empty-line">&#160;</p>`))
        .join('\n      ');

      const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>${this.escapeHtml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
</head>
<body>
  <h2 class="chunk-title">${this.escapeHtml(ch.title)}</h2>
  <div class="chapter-content">
      ${paras}
  </div>
</body>
</html>`;
      zip.file(`OEBPS/text/${ch.filename}`, chapterXhtml);
    }

    // 8. 맨 마지막 부록 용어집 (Glossary) XHTML (translated, category, term 순)
    const hasGlossary = glossaryTerms.length > 0;
    if (hasGlossary) {
      const tableRows = glossaryTerms
        .map((item) => `      <tr>
        <td>${this.escapeHtml(item.translated)}</td>
        <td>${this.escapeHtml(item.category || '-')}</td>
        <td>${this.escapeHtml(item.term)}</td>
      </tr>`)
        .join('\n');

      const glossaryXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>부록: 용어집</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
</head>
<body>
  <h2 class="chunk-title">부록: 용어집</h2>
  <table class="glossary-table">
    <thead>
      <tr>
        <th style="width: 40%;">번역어</th>
        <th style="width: 25%;">분류</th>
        <th style="width: 35%;">원문</th>
      </tr>
    </thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
</body>
</html>`;
      zip.file('OEBPS/text/glossary.xhtml', glossaryXhtml);
    }

    // 9. EPUB 3 Navigation Document (OEBPS/text/nav.xhtml)
    const navItems: string[] = [];
    if (hasIntro) {
      navItems.push(`        <li><a href="intro.xhtml">작품 소개</a></li>`);
    }
    for (let i = 0; i < exportChapters.length; i++) {
      const ch = exportChapters[i];
      navItems.push(`        <li><a href="${ch.filename}">${this.escapeHtml(ch.title)}</a></li>`);
    }
    if (hasGlossary) {
      navItems.push(`        <li><a href="glossary.xhtml">부록: 용어집</a></li>`);
    }

    const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>목차</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1 class="chapter-title">목차</h1>
    <ul>
${navItems.join('\n')}
    </ul>
  </nav>
</body>
</html>`;
      zip.file('OEBPS/text/nav.xhtml', navXhtml);

    // 10. EPUB 2 NCX (OEBPS/toc.ncx)
    let playOrder = 1;
    const ncxPoints: string[] = [];
    if (hasIntro) {
      ncxPoints.push(`    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>작품 소개</text></navLabel>
      <content src="text/intro.xhtml"/>
    </navPoint>`);
      playOrder++;
    }
    for (let i = 0; i < exportChapters.length; i++) {
      const ch = exportChapters[i];
      ncxPoints.push(`    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${this.escapeHtml(ch.title)}</text></navLabel>
      <content src="text/${ch.filename}"/>
    </navPoint>`);
      playOrder++;
    }
    if (hasGlossary) {
      ncxPoints.push(`    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>부록: 용어집</text></navLabel>
      <content src="text/glossary.xhtml"/>
    </navPoint>`);
      playOrder++;
    }

    const bookUuid = 'urn:uuid:' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'btg-' + Date.now());
    const ncxContent = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookUuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${this.escapeHtml(title)}</text>
  </docTitle>
  <docAuthor>
    <text>${this.escapeHtml(author)}</text>
  </docAuthor>
  <navMap>
${ncxPoints.join('\n')}
  </navMap>
</ncx>`;
    zip.file('OEBPS/toc.ncx', ncxContent);

    // 11. OPF 패키지 (OEBPS/content.opf)
    const modifiedDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const getChapterItemId = (i: number) => (splitMode === 'delimiter' ? `chapter-${i + 1}` : `chunk-${i + 1}`);
    const manifestItems: string[] = [
      ...(hasCover
        ? [
            `    <item id="cover-image" href="images/${coverFilename}" media-type="${coverMimeType}" properties="cover-image"/>`,
            `    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>`,
          ]
        : []),
      ...(hasIntro ? [`    <item id="intro-page" href="text/intro.xhtml" media-type="application/xhtml+xml"/>`] : []),
      `    <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
      `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
      `    <item id="style" href="styles/style.css" media-type="text/css"/>`,
      ...exportChapters.map((ch, i) => `    <item id="${getChapterItemId(i)}" href="text/${ch.filename}" media-type="application/xhtml+xml"/>`),
      ...(hasGlossary ? [`    <item id="glossary-page" href="text/glossary.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ];

    const spineItemrefs: string[] = [
      ...(hasCover ? [`    <itemref idref="cover-page" linear="no"/>`] : []),
      ...(hasIntro ? [`    <itemref idref="intro-page"/>`] : []),
      `    <itemref idref="nav"/>`,
      ...exportChapters.map((_, i) => `    <itemref idref="${getChapterItemId(i)}"/>`),
      ...(hasGlossary ? [`    <itemref idref="glossary-page"/>`] : []),
    ];

    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" page-progression-direction="ltr">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${this.escapeHtml(title)}</dc:title>
    <dc:creator>${this.escapeHtml(author)}</dc:creator>
    <dc:language>ko</dc:language>
    <dc:identifier id="BookId">${bookUuid}</dc:identifier>
    <meta property="dcterms:modified">${modifiedDate}</meta>
${hasCover ? '    <meta name="cover" content="cover-image"/>\n' : ''}  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItemrefs.join('\n')}
  </spine>
</package>`;
    zip.file('OEBPS/content.opf', opfContent);

    // 12. 최종 EPUB Blob 생성
    return await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  }

}

// 싱글톤 인스턴스 export
export const epubService = new EpubService();
