/**
 * Canonical forms and validators for Indian identifiers: phone, PAN, Aadhaar (Verhoeff), IFSC, email, slugs,
 * plus the masking used by every API response.
 */

/** Normalises an Indian mobile number to 10 digits (strips spaces, dashes, +91/91/0 prefixes); null when invalid. */
export function normalizeIndianPhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  } else if (digits.length === 13 && digits.startsWith("091")) {
    digits = digits.slice(3);
  }
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Returns true for a 10-digit Indian mobile number in canonical form. */
export function isCanonicalPhone(input: string): boolean {
  return /^[6-9]\d{9}$/.test(input);
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Upper-cases and trims a PAN; does not validate. */
export function normalizePAN(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

/** Validates a PAN (^[A-Z]{5}[0-9]{4}[A-Z]$ after normalisation). */
export function isValidPAN(input: string): boolean {
  return PAN_REGEX.test(normalizePAN(input));
}

/** Masks a PAN as "XXXXX1234X": keeps the 4 digits and the final letter. */
export function maskPAN(pan: string): string {
  const clean = normalizePAN(pan);
  if (clean.length !== 10) {
    return "X".repeat(Math.max(0, clean.length));
  }
  return `XXXXX${clean.slice(5, 9)}${clean.slice(9)}`;
}

/** Verhoeff multiplication table d(j,k). */
const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** Verhoeff permutation table p(pos mod 8, digit). */
const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff inverse table. */
const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Looks up the Verhoeff d table safely. */
function dTable(c: number, p: number): number {
  return VERHOEFF_D[c]?.[p] ?? 0;
}

/** Verhoeff checksum over a digit string (full number including its check digit); true when the check passes. */
export function verhoeffValidate(digits: string): boolean {
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    const p = VERHOEFF_P[i % 8]?.[digit] ?? 0;
    c = dTable(c, p);
  }
  return c === 0;
}

/** Computes the Verhoeff check digit to append to a digit string. */
export function verhoeffCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new Error("Verhoeff input must be digits only");
  }
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    const p = VERHOEFF_P[(i + 1) % 8]?.[digit] ?? 0;
    c = dTable(c, p);
  }
  return VERHOEFF_INV[c] ?? 0;
}

/** Strips spaces/dashes from an Aadhaar number; does not validate. */
export function normalizeAadhaar(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** Validates an Aadhaar number: 12 digits, first digit 2-9, valid Verhoeff checksum. */
export function isValidAadhaar(input: string): boolean {
  const digits = normalizeAadhaar(input);
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValidate(digits);
}

/** Masks an Aadhaar as "XXXX XXXX 1234". */
export function maskAadhaar(aadhaar: string): string {
  const digits = normalizeAadhaar(aadhaar);
  return `XXXX XXXX ${digits.slice(-4).padStart(4, "X")}`;
}

/** Masks a bank account number keeping the last 4 characters, e.g. "XXXXXXXX1234". */
export function maskAccount(account: string): string {
  const clean = account.replace(/\s/g, "");
  if (clean.length <= 4) {
    return "X".repeat(clean.length);
  }
  return `${"X".repeat(clean.length - 4)}${clean.slice(-4)}`;
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Upper-cases and trims an IFSC code; does not validate. */
export function normalizeIFSC(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

/** Validates an IFSC code (^[A-Z]{4}0[A-Z0-9]{6}$ after normalisation). */
export function isValidIFSC(input: string): boolean {
  return IFSC_REGEX.test(normalizeIFSC(input));
}

/** Lower-cases and trims an e-mail address. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Loose e-mail shape check (one @, no spaces, a dot in the domain). */
export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(input));
}

/** Converts text to a URL slug: lower-case ASCII letters, digits and single hyphens. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalises a human name or label for duplicate matching: trimmed, lower-case, single spaces. */
export function normalizeLabel(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
