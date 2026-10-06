// --- cipherASCII character set engine -------------------------------------------------
// Handles massive character injection and density sorting for the ramp UI.
// Density is MEASURED by rasterising each glyph on a canvas, which is the
// only accurate answer for arbitrary injected text (CJK, emoji, ligatures).
// --------------------------------------------------------------------------------------------

export const generateRange = (s, e) =>
  Array.from({ length: e - s + 1 }, (_, i) => String.fromCodePoint(s + i));

export const ASCII_STANDARD = [
  ' ', '.', "'", '`', '^', '"', ',', ':', ';', 'I', 'l', '!', 'i', '>', '<', '~', '+', '_', '-', '?', ']', '[',
  '}', '{', '1', ')', '(', '|', '\\', '/', 't', 'f', 'j', 'r', 'x', 'n', 'u', 'v', 'c', 'z', 'X', 'Y', 'U', 'C',
  'J', 'C', 'O', '0', 'Q', 'm', 'w', 'q', 'p', 'd', 'b', 'k', 'h', 'a', 'o', '*', '#', 'M', 'W', '&', '8', '%',
  'B', '@', '$',
];

export const CJK_ULTRA_DENSE = generateRange(0x4e00, 0x6388); // 5,000+ characters

export const sortCharactersByDensity = (charArray) => {
  if (typeof window === 'undefined') return charArray;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = 24;
  canvas.height = 24;
  return charArray
    .map((char) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 24, 24);
      ctx.fillStyle = '#FFF';
      ctx.font = '20px monospace';
      ctx.fillText(char, 12, 12);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 50) weight++;
      return { char, weight };
    })
    .sort((a, b) => a.weight - b.weight)
    .map((i) => i.char);
};
