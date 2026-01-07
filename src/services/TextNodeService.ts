// services/TextNodeService.ts
// Convert plain text into line-based nodes and rebuild text after translation.

import { EpubNode } from '../types/epub';

export interface TextNode extends EpubNode {
  lineIndex: number; // original line index
  type: 'text';
  tag: 'line';
  content: string; // non-empty text only
}

export class TextNodeService {
  /**
   * Split text by newline and return non-empty line nodes with original lines kept for reconstruction.
   */
  parse(fullText: string, fileId: string = 'text'): { nodes: TextNode[]; originalLines: string[] } {
    const originalLines = fullText.split(/\r?\n/);

    const nodes: TextNode[] = [];
    for (let i = 0; i < originalLines.length; i++) {
      const line = originalLines[i];
      if (!line.trim()) continue; // skip empty lines
      nodes.push({
        id: `${fileId}_${String(i).padStart(5, '0')}`,
        lineIndex: i,
        type: 'text',
        tag: 'line',
        content: line,
      });
    }

    return { nodes, originalLines };
  }

  /**
   * Rebuild text by overlaying translated nodes onto the original lines, preserving empty lines.
   * Also converts <br/> tags to actual newline characters for plain text output.
   */
  reconstruct(translatedNodes: TextNode[], originalLines: string[]): string {
    const lines = [...originalLines];
    for (const node of translatedNodes) {
      if (node.lineIndex < 0) continue;
      // Expand array if needed (defensive)
      while (node.lineIndex >= lines.length) {
        lines.push('');
      }
      
      // [추가] <br/> 태그를 줄바꿈 문자로 변환
      // 텍스트 파일은 HTML이 아니므로 <br/> 태그를 실제 \n으로 변환
      // 이스케이프된 형태(&lt;br/&gt;)와 일반 형태(<br/>) 모두 처리
      let content = node.content ?? '';
      content = content.replace(/&lt;br\s*\/?\s*&gt;/gi, '\n'); // 이스케이프된 형태
      content = content.replace(/<br\s*\/?\s*>/gi, '\n');        // 일반 형태
      
      lines[node.lineIndex] = content;
    }
    return lines.join('\n');
  }
}
