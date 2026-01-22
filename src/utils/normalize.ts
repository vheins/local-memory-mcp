// Normalization layer for text processing
export function normalize(text: string): string {
  return text
    .toLowerCase()
    // Keep alphanumeric characters and spaces, including Unicode letters (for Indonesian, etc.)
    .replace(/[^\w\s\u00C0-\u017F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
