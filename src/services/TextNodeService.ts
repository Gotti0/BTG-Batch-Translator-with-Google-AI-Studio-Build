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
   */
  reconstruct(translatedNodes: TextNode[], originalLines: string[]): string {
    const lines = [...originalLines];
    for (const node of translatedNodes) {
      if (node.lineIndex < 0) continue;
      // Expand array if needed (defensive)
      while (node.lineIndex >= lines.length) {
        lines.push('');
      }
      lines[node.lineIndex] = node.content ?? '';
    }
    return lines.join('\n');
  }
}
