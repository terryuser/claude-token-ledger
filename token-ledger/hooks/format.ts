// Pure number formatting for the band.

/** 950 → "950", 12_345 → "12.3k", 4_560_000 → "4.56M". */
export const compact = (n: number): string => {
  if (n < 1000) return String(n)
  // From 999,950 up, one decimal would round to "1000.0k": print millions instead.
  if (n < 999_950) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1).replace(/\.?0+$/, '')}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`
}
