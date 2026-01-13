import { describe, it, expect } from 'vitest';
import { EpubChunkService } from '../EpubChunkService';
import type { EpubNode } from '../../types/epub';

describe('EpubChunkService', () => {
  const service = new EpubChunkService();

  it('should group nodes into chunks based on max nodes per chunk', () => {
    const nodes: EpubNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `node_${i}`,
      type: 'text',
      content: `Content ${i}`,
      tag: 'p'
    }));

    // maxChunkSize 1000, maxNodesPerChunk 3
    const service = new EpubChunkService(1000, 3);
    const chunks = service.splitEpubNodesIntoChunks(nodes);
    
    expect(chunks.length).toBe(4); // 3, 3, 3, 1
    expect(chunks[0].length).toBe(3);
    expect(chunks[3].length).toBe(1);
  });

  it('should split chunks if character limit is exceeded', () => {
    const nodes: EpubNode[] = [
      { id: '1', type: 'text', content: 'A'.repeat(600), tag: 'p' },
      { id: '2', type: 'text', content: 'B'.repeat(600), tag: 'p' }
    ];

    // Max nodes 10 but max chars 1000. Total is 1200, so it should split.
    const service = new EpubChunkService(1000, 10);
    const chunks = service.splitEpubNodesIntoChunks(nodes);
    
    expect(chunks.length).toBe(2);
    expect(chunks[0][0].id).toBe('1');
    expect(chunks[1][0].id).toBe('2');
  });
});
