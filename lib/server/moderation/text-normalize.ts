/**
 * Text normalization layer to defeat common filter-evasion techniques.
 * Runs entirely locally — no API calls, no cost.
 */

// Leet speak / character substitution map
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  "!": "i",
  "$": "s",
  "+": "t",
  "(": "c",
  "|": "l",
  "¡": "i",
  "€": "e",
  "£": "l",
  "¥": "y",
};

// Unicode homoglyph normalization — maps visually similar chars to ASCII
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic
  "\u0410": "A", "\u0430": "a", "\u0412": "B", "\u0432": "b",
  "\u0421": "C", "\u0441": "c", "\u0415": "E", "\u0435": "e",
  "\u041D": "H", "\u043D": "h", "\u041A": "K", "\u043A": "k",
  "\u041C": "M", "\u043C": "m", "\u041E": "O", "\u043E": "o",
  "\u0420": "P", "\u0440": "p", "\u0422": "T", "\u0442": "t",
  "\u0425": "X", "\u0445": "x", "\u0423": "Y", "\u0443": "y",
  "\u0417": "3", "\u0437": "3",
  // Greek
  "\u0391": "A", "\u03B1": "a", "\u0392": "B", "\u03B2": "b",
  "\u0395": "E", "\u03B5": "e", "\u0397": "H", "\u03B7": "h",
  "\u0399": "I", "\u03B9": "i", "\u039A": "K", "\u03BA": "k",
  "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03BF": "o",
  "\u03A1": "P", "\u03C1": "p", "\u03A4": "T", "\u03C4": "t",
  "\u03A5": "Y", "\u03C5": "y", "\u03A7": "X", "\u03C7": "x",
  // Fullwidth Latin
  "\uFF21": "A", "\uFF22": "B", "\uFF23": "C", "\uFF24": "D",
  "\uFF25": "E", "\uFF26": "F", "\uFF27": "G", "\uFF28": "H",
  "\uFF29": "I", "\uFF2A": "J", "\uFF2B": "K", "\uFF2C": "L",
  "\uFF2D": "M", "\uFF2E": "N", "\uFF2F": "O", "\uFF30": "P",
  "\uFF31": "Q", "\uFF32": "R", "\uFF33": "S", "\uFF34": "T",
  "\uFF35": "U", "\uFF36": "V", "\uFF37": "W", "\uFF38": "X",
  "\uFF39": "Y", "\uFF3A": "Z",
  "\uFF41": "a", "\uFF42": "b", "\uFF43": "c", "\uFF44": "d",
  "\uFF45": "e", "\uFF46": "f", "\uFF47": "g", "\uFF48": "h",
  "\uFF49": "i", "\uFF4A": "j", "\uFF4B": "k", "\uFF4C": "l",
  "\uFF4D": "m", "\uFF4E": "n", "\uFF4F": "o", "\uFF50": "p",
  "\uFF51": "q", "\uFF52": "r", "\uFF53": "s", "\uFF54": "t",
  "\uFF55": "u", "\uFF56": "v", "\uFF57": "w", "\uFF58": "x",
  "\uFF59": "y", "\uFF5A": "z",
  // Common look-alikes
  "\u00C0": "A", "\u00C1": "A", "\u00C2": "A", "\u00C3": "A",
  "\u00C4": "A", "\u00C5": "A", "\u00C6": "AE",
  "\u00C8": "E", "\u00C9": "E", "\u00CA": "E", "\u00CB": "E",
  "\u00CC": "I", "\u00CD": "I", "\u00CE": "I", "\u00CF": "I",
  "\u00D2": "O", "\u00D3": "O", "\u00D4": "O", "\u00D5": "O",
  "\u00D6": "O", "\u00D8": "O",
  "\u00D9": "U", "\u00DA": "U", "\u00DB": "U", "\u00DC": "U",
  "\u00E0": "a", "\u00E1": "a", "\u00E2": "a", "\u00E3": "a",
  "\u00E4": "a", "\u00E5": "a", "\u00E6": "ae",
  "\u00E8": "e", "\u00E9": "e", "\u00EA": "e", "\u00EB": "e",
  "\u00EC": "i", "\u00ED": "i", "\u00EE": "i", "\u00EF": "i",
  "\u00F2": "o", "\u00F3": "o", "\u00F4": "o", "\u00F5": "o",
  "\u00F6": "o", "\u00F8": "o",
  "\u00F9": "u", "\u00FA": "u", "\u00FB": "u", "\u00FC": "u",
};

// Zero-width and invisible characters to strip
const INVISIBLE_CHARS =
  /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/**
 * Strips zero-width and invisible Unicode characters used to break up words.
 */
function stripInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS, "");
}

/**
 * Replaces Unicode homoglyphs (Cyrillic, Greek, fullwidth, accented)
 * with their ASCII equivalents.
 */
function normalizeHomoglyphs(text: string): string {
  let result = "";
  for (const char of text) {
    result += HOMOGLYPH_MAP[char] ?? char;
  }
  return result;
}

/**
 * Decodes leet speak substitutions (0→o, 3→e, @→a, etc.).
 */
function decodeLeetSpeak(text: string): string {
  let result = "";
  for (const char of text) {
    result += LEET_MAP[char] ?? char;
  }
  return result;
}

/**
 * Collapses deliberately spaced-out words: "s e x" → "sex".
 * Only collapses single characters separated by spaces/punctuation.
 */
function collapseSpacedLetters(text: string): string {
  // Match sequences of single characters separated by spaces, dots, dashes, etc.
  return text.replace(
    /\b([a-zA-Z])[\s.\-_*]{1,3}([a-zA-Z])(?:[\s.\-_*]{1,3}([a-zA-Z])){1,20}/g,
    (match) => {
      // Extract just the letters
      const letters = match.replace(/[^a-zA-Z]/g, "");
      return letters;
    }
  );
}

/**
 * Removes repeated characters used to evade filters: "seeex" → "seex" → "sex"
 * Only reduces runs of 3+ to 2, to avoid mangling normal words.
 */
function deduplicateChars(text: string): string {
  return text.replace(/(.)\1{2,}/g, "$1$1");
}

/**
 * Detects if text uses evasion techniques (returns true if suspicious).
 */
export function detectsEvasionAttempt(text: string): boolean {
  // Zero-width chars present
  if (INVISIBLE_CHARS.test(text)) return true;

  // Contains homoglyphs from non-Latin scripts mixed with Latin
  const hasLatin = /[a-zA-Z]/.test(text);
  const hasCyrillic = /[\u0400-\u04FF]/.test(text);
  const hasGreek = /[\u0370-\u03FF]/.test(text);
  const hasFullwidth = /[\uFF00-\uFFEF]/.test(text);
  if (hasLatin && (hasCyrillic || hasGreek || hasFullwidth)) return true;

  // Heavy leet speak usage (high ratio of leet chars to total)
  const leetChars = text.split("").filter((c) => c in LEET_MAP).length;
  const alphaChars = text.replace(/[^a-zA-Z0-9@!$+]/g, "").length;
  if (alphaChars > 4 && leetChars / alphaChars > 0.4) return true;

  // Spaced-out single letters pattern
  const spacedPattern = /\b[a-zA-Z]\s[a-zA-Z]\s[a-zA-Z]\s[a-zA-Z]/;
  if (spacedPattern.test(text)) return true;

  return false;
}

/**
 * Full normalization pipeline. Returns the text after all
 * anti-evasion transforms, ready for pattern matching.
 */
export function normalizeForModeration(text: string): string {
  let normalized = text;
  normalized = stripInvisibleChars(normalized);
  normalized = normalizeHomoglyphs(normalized);
  normalized = collapseSpacedLetters(normalized);
  normalized = decodeLeetSpeak(normalized);
  normalized = deduplicateChars(normalized);
  return normalized.toLowerCase();
}
