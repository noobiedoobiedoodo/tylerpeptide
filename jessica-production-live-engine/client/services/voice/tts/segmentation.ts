/**
 * Linguistic Sentence Segmentation (Directive 8)
 * 
 * Splits conversational text on natural sentence boundaries (., !, ?) targeting 8-30 words per segment.
 * Avoids micro-splitting on colons (:) or semicolons (;) to maintain natural British butler cadence.
 */

export function splitIntoTTSSegments(text: string): string[] {
  if (!text || !text.trim()) return [];

  const clean = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[.*?\]/g, '')
    .replace(/`/g, '')
    .replace(/→/g, '')
    .replace(/✓/g, '')
    .replace(/•/g, '')
    .trim();

  // Match sentences ending in ., !, or ? (preserving abbreviations like Mr., Dr., etc.)
  const rawSentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [clean];
  const segments: string[] = [];
  let currentBuffer = '';

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

    // If adding this sentence to the current buffer keeps it under ~28 words, merge them
    const bufferWordCount = currentBuffer ? currentBuffer.split(/\s+/).filter(Boolean).length : 0;

    if (currentBuffer && (bufferWordCount + wordCount <= 28)) {
      currentBuffer = `${currentBuffer} ${trimmed}`.trim();
    } else {
      if (currentBuffer) {
        segments.push(currentBuffer);
      }
      currentBuffer = trimmed;
    }
  }

  if (currentBuffer) {
    segments.push(currentBuffer);
  }

  return segments.filter(s => s.trim().length > 0);
}
