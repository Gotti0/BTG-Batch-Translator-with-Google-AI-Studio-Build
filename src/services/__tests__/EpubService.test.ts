import { describe, it, expect } from 'vitest';
import { EpubService } from '../EpubService';
import { EpubNode } from '../../types/epub';

describe('EpubService - parseXhtml robust logic', () => {
  const epubService = new EpubService();
  const fileName = 'test.xhtml';

  it('should correctly handle nested images in span/p', () => {
    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <p><span id="id-a004"><img src="../Images/embed0011.jpg" class="fit" alt="test" /></span></p>
        </body>
      </html>
    `;
    const { nodes } = epubService.parseXhtml(xhtml, fileName);

    // Expectation:
    // 1. <p> (ignored/opening)
    // 2. <span id="id-a004"> (ignored/opening)
    // 3. <img> (image)
    // 4. </span> (ignored/closing)
    // 5. </p> (ignored/closing)
    
    expect(nodes.some(n => n.tag === 'p' && n.type === 'ignored' && n.html.startsWith('<p'))).toBe(true);
    expect(nodes.some(n => n.tag === 'span' && n.type === 'ignored' && n.html.includes('id="id-a004"'))).toBe(true);
    expect(nodes.some(n => n.tag === 'img' && n.type === 'image' && n.imagePath?.includes('Images/embed0011.jpg'))).toBe(true);
    expect(nodes.some(n => n.tag === 'span' && n.type === 'ignored' && n.html === '</span>')).toBe(true);
    expect(nodes.some(n => n.tag === 'p' && n.type === 'ignored' && n.html === '</p>')).toBe(true);
  });

  it('should treat simple tags as text nodes', () => {
    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <div class="para">Hello <b>World</b></div>
        </body>
      </html>
    `;
    const { nodes } = epubService.parseXhtml(xhtml, fileName);

    // Expectation:
    // 1. <div class="para"> (text node, because it doesn't contain block/image tags)
    const textNode = nodes.find(n => n.tag === 'div');
    expect(textNode?.type).toBe('text');
    expect(textNode?.content).toBe('Hello World');
    expect(textNode?.attributes?.class).toBe('para');
  });

  it('should preserve complex structural tags (table/lists)', () => {
    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <ul>
            <li><span>Item 1</span></li>
            <li>Item 2</li>
          </ul>
        </body>
      </html>
    `;
    const { nodes } = epubService.parseXhtml(xhtml, fileName);

    // <ul>, <li> should be preserved as segments
    expect(nodes.some(n => n.tag === 'ul' && n.type === 'ignored')).toBe(true);
    // <li> containing <span> is a complex structure now
    expect(nodes.some(n => n.tag === 'li' && n.type === 'ignored')).toBe(true);
    expect(nodes.some(n => n.tag === 'span' && n.content === 'Item 1')).toBe(true);
  });

  it('should handle svg and image tags correctly', () => {
    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
        <body>
          <svg><image xlink:href="../Images/test.png" /></svg>
        </body>
      </html>
    `;
    const { nodes } = epubService.parseXhtml(xhtml, fileName);
    
    // svg is a container for image
    const imageNode = nodes.find(n => n.tag === 'svg' || n.tag === 'image');
    expect(imageNode?.type).toBe('image');
    expect(imageNode?.imagePath).toContain('Images/test.png');
  });
});
