/**
 * Verhoeff checksum (used by Aadhaar). Tables from the original 1969 paper:
 * `d` = multiplication in the dihedral group D5, `p` = position permutation, `inv` = inverses.
 */
const D: readonly (readonly number[])[] = [
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

const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function lookup(table: readonly (readonly number[])[], row: number, column: number): number {
  return table[row]?.[column] ?? 0;
}

/** Only digits, no spaces. */
function digitsOf(input: string): string {
  return input.replace(/\s+/g, "");
}

/** Verhoeff check of a digit string that already carries its check digit (last position). */
export function isValidVerhoeff(input: string): boolean {
  const digits = digitsOf(input);
  if (!/^\d{2,}$/.test(digits)) return false;
  let c = 0;
  const reversed = [...digits].reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    c = lookup(D, c, lookup(P, i % 8, digit));
  }
  return c === 0;
}

/** Check digit to append to a digit string so that the result passes `isValidVerhoeff`. */
export function verhoeffCheckDigit(input: string): number {
  const digits = digitsOf(input);
  let c = 0;
  const reversed = [...digits].reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    c = lookup(D, c, lookup(P, (i + 1) % 8, digit));
  }
  return INV[c] ?? 0;
}

export const AADHAAR_REGEX = /^[2-9]\d{11}$/;

/** 12 digits (spaces allowed), not starting with 0/1, with a valid Verhoeff check digit. */
export function isValidAadhaar(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = digitsOf(input);
  return AADHAAR_REGEX.test(digits) && isValidVerhoeff(digits);
}

/** "123456789012" → "1234 5678 9012" (partial input keeps its groups). */
export function formatAadhaar(input: string): string {
  const digits = digitsOf(input).replace(/\D/g, "").slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Normalises an Indian mobile number to 10 digits (drops +91 / 91 / leading 0). */
export function normaliseIndianPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export const PHONE_REGEX = /^[6-9]\d{9}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
