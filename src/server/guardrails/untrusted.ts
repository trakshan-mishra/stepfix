const LOOKALIKE_TAGS = [
  /<\/?untrusted>/gi,
  /<\/?step_result[^>]*>/gi,
  /<\/?system[^>]*>/gi
];

export function stripLookalikeTags(text: string): string {
  let result = text;
  for (const pattern of LOOKALIKE_TAGS) {
    result = result.replace(pattern, "");
  }
  return result;
}

export function wrapUntrusted(content: string): string {
  const cleaned = stripLookalikeTags(content);
  return `<untrusted>${cleaned}</untrusted>`;
}

export function truncateForUntrusted(
  content: string,
  maxLen: number = 8000
): string {
  if (content.length <= maxLen) return content;
  const headLen = Math.min(3000, Math.floor(maxLen / 2));
  const tailLen = maxLen - headLen - 20;
  const head = content.slice(0, headLen);
  const tail = content.slice(-tailLen);
  return `${head}\n[...truncated...]\n${tail}`;
}
