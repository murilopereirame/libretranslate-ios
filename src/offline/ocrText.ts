import type { RecognizedLine } from '../../modules/on-device-language';

/**
 * Turns the lines Vision found into text that translates well: lines that belong to the
 * same paragraph are joined with spaces, and a bigger vertical gap starts a new paragraph.
 * Sending each line separately would cut sentences in half and hurt the translation.
 */
export function linesToText(lines: RecognizedLine[]): string {
  const clean = lines.filter((l) => l.text.trim());
  if (!clean.length) return '';

  const paragraphs: string[] = [];
  let current = clean[0].text.trim();

  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const line = clean[i];
    const text = line.text.trim();
    const lineHeight = Math.max(prev.height, line.height);
    const gap = line.y - (prev.y + prev.height);
    // A line that starts above the previous one is a new column or block.
    const newBlock = gap > lineHeight * 0.8 || line.y < prev.y - lineHeight * 0.5;

    if (newBlock) {
      paragraphs.push(current);
      current = text;
    } else if (/[A-Za-zÀ-ÿ]-$/.test(current)) {
      // Word broken across lines with a hyphen.
      current = current.slice(0, -1) + text;
    } else if (isCJK(current.slice(-1)) && isCJK(text[0])) {
      current += text;
    } else {
      current += ` ${text}`;
    }
  }
  paragraphs.push(current);
  return paragraphs.join('\n\n');
}

function isCJK(ch: string | undefined): boolean {
  return !!ch && /[぀-ヿ㐀-鿿가-힯]/.test(ch);
}
