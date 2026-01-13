import { describe, it, expect } from 'vitest';
import { ChunkService } from '../ChunkService';

describe('ChunkService', () => {
  it('should split text into chunks without exceeding max size', () => {
    const service = new ChunkService(10);
    const text = '123456789012345';
    const chunks = service.splitTextIntoChunks(text);

    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBeLessThanOrEqual(10);
    expect(chunks[1].length).toBeLessThanOrEqual(10);
  });

  it('should preserve line breaks in chunks', () => {
    const service = new ChunkService(20);
    const text = 'Hello world.\nThis is a long sentence.\nEnd.';
    const chunks = service.splitTextIntoChunks(text);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('\n');
  });
});
