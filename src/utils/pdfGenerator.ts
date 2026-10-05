// 순수 TypeScript 기반 초경량 단일 페이지 PDF 바이너리 생성기. HOW/WHAT
// 0여백, 2pt 극소 폰트, Type0/ToUnicode CMap을 통해 텍스트를 단 1페이지 PDF로 압축 패킹합니다. HOW/WHAT
// Gemini API의 저해상도 미디어(MEDIA_RESOLUTION_LOW, 280토큰) 특성을 활용해 입력 토큰을 99% 절감하기 위해 구현되었습니다. WHY
// Intel N100 저사양 환경에서 외부 폰트/캔버스 렌더러 없이 0ms 즉각 인메모리 생성을 보장합니다. WHY

export interface PdfGenerationOptions {
  fontSize?: number; // 기본값: 2pt
  lineHeight?: number; // 기본값: 2pt
  pageWidth?: number; // 기본값: 14400pt (PDF 1.4 규격 최대 한계치)
  pageHeight?: number; // 기본값: 14400pt
}

// 텍스트를 UTF-16BE 16진수 문자열로 변환합니다. HOW/WHAT
// CJK, 영문, 기호, 이모지를 손실 없이 PDF 텍스트 스트림 16진수 규격으로 인코딩합니다. WHY
function textToHexStream(text: string): string {
  let hex = '';
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    hex += code.toString(16).padStart(4, '0');
  }
  return hex;
}

// 긴 텍스트를 지정된 문자 수 단위로 줄바꿈하여 PDF 텍스트 스트림 연산자로 변환합니다. HOW/WHAT
// 개행 및 자간을 0에 가깝게 유지하며 텍스트 블록을 구성합니다. WHY
function buildContentStream(text: string, fontSize: number, lineHeight: number, pageHeight: number): string {
  // 줄 단위 분할 및 긴 줄 래핑 (1줄당 최대 2000자 기준)
  const maxCharsPerLine = 2000;
  const rawLines = text.split(/\r?\n/);
  const wrappedLines: string[] = [];

  for (const line of rawLines) {
    if (line.length <= maxCharsPerLine) {
      wrappedLines.push(line);
    } else {
      for (let i = 0; i < line.length; i += maxCharsPerLine) {
        wrappedLines.push(line.slice(i, i + maxCharsPerLine));
      }
    }
  }

  // BT: Begin Text, Tf: Set Font & Size, TL: Set Text Leading, Td: Move to start, Tj: Show text, T*: Next line
  let stream = `BT\n/F1 ${fontSize} Tf\n${lineHeight} TL\n0 ${pageHeight - fontSize} Td\n`;

  for (let i = 0; i < wrappedLines.length; i++) {
    const line = wrappedLines[i];
    const hex = textToHexStream(line);
    stream += `<${hex}> Tj\n`;
    if (i < wrappedLines.length - 1) {
      stream += `T*\n`;
    }
  }

  stream += `ET\n`;
  return stream;
}

// ToUnicode CMap 스트림을 생성합니다. HOW/WHAT
// CID 0x0000~0xFFFF를 유니코드 UTF-16BE로 1:1 매핑하여 텍스트 직접 추출을 보장합니다. WHY
function buildToUnicodeCMap(): string {
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Custom-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

// 텍스트를 초경량 단일 페이지 PDF 바이트 배열(Uint8Array)로 변환합니다. HOW/WHAT
// Gemini API에 첨부할 1페이지짜리 무여백/극소폰트 PDF 바이너리를 생성합니다. WHY
export function generateUltraCompactPdf(text: string, options?: PdfGenerationOptions): Uint8Array {
  const fontSize = options?.fontSize ?? 2;
  const lineHeight = options?.lineHeight ?? 2;
  const pageWidth = options?.pageWidth ?? 14400;
  const pageHeight = options?.pageHeight ?? 14400;

  const contentStream = buildContentStream(text, fontSize, lineHeight, pageHeight);
  const toUnicodeStream = buildToUnicodeCMap();

  const contentBytes = new TextEncoder().encode(contentStream);
  const toUnicodeBytes = new TextEncoder().encode(toUnicodeStream);

  const objects: { id: number; data: Uint8Array }[] = [];

  const enc = (str: string) => new TextEncoder().encode(str);
  const concat = (...arrays: Uint8Array[]) => {
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;
    const res = new Uint8Array(totalLen);
    let offset = 0;
    for (const a of arrays) {
      res.set(a, offset);
      offset += a.length;
    }
    return res;
  };

  // 1: Catalog
  objects.push({ id: 1, data: enc(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`) });

  // 2: Pages
  objects.push({ id: 2, data: enc(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`) });

  // 3: Page (단일 페이지, 여백 0, 14400x14400pt)
  objects.push({
    id: 3,
    data: enc(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources 5 0 R >>\nendobj\n`),
  });

  // 4: Contents
  objects.push({
    id: 4,
    data: concat(
      enc(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      enc(`\nendstream\nendobj\n`)
    ),
  });

  // 5: Resources
  objects.push({
    id: 5,
    data: enc(`5 0 obj\n<< /Font << /F1 6 0 R >> >>\nendobj\n`),
  });

  // 6: Font (Type0 with Identity-H)
  objects.push({
    id: 6,
    data: enc(`6 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /CompactMono /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>\nendobj\n`),
  });

  // 7: CIDFont
  objects.push({
    id: 7,
    data: enc(`7 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /CompactMono /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 1000 >>\nendobj\n`),
  });

  // 8: ToUnicode CMap
  objects.push({
    id: 8,
    data: concat(
      enc(`8 0 obj\n<< /Length ${toUnicodeBytes.length} >>\nstream\n`),
      toUnicodeBytes,
      enc(`\nendstream\nendobj\n`)
    ),
  });

  // 9: FontDescriptor
  objects.push({
    id: 9,
    data: enc(`9 0 obj\n<< /Type /FontDescriptor /FontName /CompactMono /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>\nendobj\n`),
  });

  // Header
  const header = enc(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`);

  // Compute xref offsets
  let currentOffset = header.length;
  const offsets: number[] = [0]; // object 0

  const bodyParts: Uint8Array[] = [header];

  for (const obj of objects) {
    offsets.push(currentOffset);
    bodyParts.push(obj.data);
    currentOffset += obj.data.length;
  }

  // Xref
  const startXref = currentOffset;
  let xrefStr = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xrefStr += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }
  xrefStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  bodyParts.push(enc(xrefStr));

  return concat(...bodyParts);
}

// 브라우저 환경에서 Uint8Array 바이트를 Base64 문자열로 고속 변환합니다. HOW/WHAT
// Gemini API의 inlineData 전달을 위한 Base64 포맷을 생성합니다. WHY
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// 브라우저에서 PDF 파일 다운로드를 트리거합니다. HOW/WHAT
// USER 요구: PDF 인풋 활성화 시 입력에 사용된 실제 PDF 파일을 직접 다운로드하여 디버깅 검증 (WHY)
export function downloadPdfBlob(bytes: Uint8Array, fileName: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
