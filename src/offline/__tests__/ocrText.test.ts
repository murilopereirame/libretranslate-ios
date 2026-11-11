import { linesToText } from '../ocrText';

const line = (text: string, y: number, height = 0.03, x = 0.1) => ({ text, x, y, width: 0.8, height });

describe('linesToText', () => {
  it('returns an empty string when nothing was found', () => {
    expect(linesToText([])).toBe('');
    expect(linesToText([line('   ', 0.1)])).toBe('');
  });

  it('joins lines of the same paragraph and splits on larger gaps', () => {
    const text = linesToText([
      line('The quick brown fox', 0.1),
      line('jumps over the lazy dog.', 0.135),
      line('Second paragraph here.', 0.25),
    ]);
    expect(text).toBe('The quick brown fox jumps over the lazy dog.\n\nSecond paragraph here.');
  });

  it('rejoins words hyphenated across lines', () => {
    expect(linesToText([line('Interna-', 0.1), line('tional news', 0.135)])).toBe('International news');
  });

  it('joins CJK lines without spaces', () => {
    expect(linesToText([line('今日は', 0.1), line('いい天気', 0.135)])).toBe('今日はいい天気');
  });

  it('starts a new block when the next line is above the previous one (new column)', () => {
    expect(linesToText([line('Left column', 0.5), line('Right column', 0.1, 0.03, 0.6)])).toBe(
      'Left column\n\nRight column',
    );
  });
});
