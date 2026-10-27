/**
 * Deterministic building blocks of the scale seed (docs/SEED.md "Production-size data"): a seeded PRNG, UUIDs drawn from it, Indian
 * names, unique phone numbers / PANs / Verhoeff-valid Aadhaar numbers by index, and IST instants. The same seed and run date always give
 * the same dataset (ciphertexts differ only by their random IVs).
 */
import { addDays, verhoeffCheckDigit } from "@kkt/domain";

/** sfc32 PRNG seeded through splitmix32: fast, 128-bit state, good enough for synthetic data. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Uniform 32-bit unsigned integer. */
  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** One element by weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1]![0];
  }

  /** A derived, independent generator (so one part of the dataset does not shift when another changes). */
  fork(label: string): Rng {
    let h = this.u32();
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    return new Rng(h);
  }

  /** RFC 4122 version-4 shaped UUID drawn from this generator. */
  uuid(): string {
    const w = [this.u32(), this.u32(), this.u32(), this.u32()];
    const hex = w.map((x) => x.toString(16).padStart(8, "0")).join("");
    const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

export const MALE_FIRST = [
  "Rajesh",
  "Amit",
  "Vikram",
  "Manoj",
  "Rakesh",
  "Sanjay",
  "Anil",
  "Sunil",
  "Ravi",
  "Ajay",
  "Vijay",
  "Ashok",
  "Deepak",
  "Pankaj",
  "Rahul",
  "Rohit",
  "Saurabh",
  "Abhishek",
  "Nitin",
  "Alok",
  "Arvind",
  "Mukesh",
  "Dinesh",
  "Ramesh",
  "Suresh",
  "Prakash",
  "Santosh",
  "Vivek",
  "Gaurav",
  "Kunal",
  "Ankit",
  "Aditya",
  "Harsh",
  "Kishore",
  "Mahesh",
  "Naveen",
  "Pradeep",
  "Rajiv",
  "Shashi",
  "Umesh",
] as const;
export const FEMALE_FIRST = [
  "Priya",
  "Sunita",
  "Neha",
  "Anjali",
  "Pooja",
  "Kavita",
  "Rekha",
  "Seema",
  "Anita",
  "Nisha",
  "Meena",
  "Shweta",
  "Ritu",
  "Swati",
  "Divya",
  "Sneha",
  "Komal",
  "Preeti",
  "Asha",
  "Usha",
  "Kiran",
  "Sarita",
  "Rashmi",
  "Jyoti",
  "Madhu",
  "Archana",
  "Shalini",
  "Monika",
] as const;
export const SURNAMES = [
  "Kumar",
  "Sinha",
  "Verma",
  "Singh",
  "Devi",
  "Gupta",
  "Prasad",
  "Sharma",
  "Yadav",
  "Mishra",
  "Jha",
  "Roy",
  "Pandey",
  "Tiwari",
  "Srivastava",
  "Choudhary",
  "Thakur",
  "Ojha",
  "Pathak",
  "Mehta",
  "Agarwal",
  "Rai",
  "Dubey",
  "Tripathi",
  "Chauhan",
  "Ranjan",
  "Anand",
  "Paswan",
  "Mandal",
  "Saha",
] as const;
export const LOCALITIES = [
  "Boring Road",
  "Kankarbagh",
  "Rajendra Nagar",
  "Patliputra Colony",
  "Bailey Road",
  "Danapur",
  "Ashiana Nagar",
  "Raja Bazar",
  "Anisabad",
  "Kurji",
  "Saguna More",
  "Rukanpura",
  "Frazer Road",
  "Gola Road",
  "Phulwari Sharif",
  "Digha",
] as const;
export const OCCUPATIONS = [
  "Salaried",
  "Business",
  "Doctor",
  "Government service",
  "Teacher",
  "Engineer",
  "Self-employed",
  "Retired",
  "Chartered Accountant",
] as const;

/** A person: salutation, first, last, gender. */
export function personName(rng: Rng): { salutation: string; first: string; last: string; gender: "MALE" | "FEMALE" } {
  const female = rng.chance(0.38);
  return {
    salutation: female ? rng.pick(["Mrs.", "Ms."]) : "Mr.",
    first: female ? rng.pick(FEMALE_FIRST) : rng.pick(MALE_FIRST),
    last: rng.pick(SURNAMES),
    gender: female ? "FEMALE" : "MALE",
  };
}

/**
 * The i-th phone number of a series: 10 digits, first digit 6–9 (`lead` first digits 8/9, customers 6/7), globally unique per (series,
 * index) and never one of the demo numbers (98765432xx).
 */
export function seriesPhone(series: "customer" | "lead", index: number): string {
  if (index < 0 || index >= 200_000_000) throw new Error(`phone index out of range: ${index}`);
  const base = series === "customer" ? 6_000_000_000 : 8_000_000_000;
  // a multiplicative scramble keeps neighbours from looking sequential while staying a bijection on [0, 2e8)
  const scrambled = (index * 7_919) % 200_000_000;
  return String(base + 100_000_000 + scrambled);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A valid-format individual PAN for an index (AAAPA0000A shape: 4th letter P), unique per index below 26^3 × 10^4. */
export function seriesPan(index: number, surnameInitial: string): string {
  const head = [Math.floor(index / 676) % 26, Math.floor(index / 26) % 26, index % 26].map((n) => LETTERS[n]).join("");
  const digits = String(Math.floor(index / 17_576) % 10_000).padStart(4, "0");
  const initial = /^[A-Z]$/.test(surnameInitial) ? surnameInitial : "K";
  return `${head}P${initial}${digits}${LETTERS[(index * 7) % 26]}`;
}

/** A Verhoeff-valid 12-digit Aadhaar number for an index (first digit 2–9). */
export function seriesAadhaar(index: number): string {
  // 104 729 is prime and coprime to 7·10^10, so index → body is a bijection: 11 digits from 2000… to 8999…
  const body = String(20_000_000_000 + ((index * 104_729) % 70_000_000_000));
  return `${body}${verhoeffCheckDigit(body)}`;
}

/** The instant `hh:mm:ss.ms` IST on a business date. */
export function istAt(date: string, hh: number, mm = 0, ss = 0, ms = 0): Date {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return new Date(`${date}T${p(hh)}:${p(mm)}:${p(ss)}.${p(ms, 3)}+05:30`);
}

/** A random office-hours instant (10:00–18:59 IST) on a date. */
export function officeInstant(rng: Rng, date: string): Date {
  return istAt(date, rng.int(10, 18), rng.int(0, 59), rng.int(0, 59), rng.int(0, 999));
}

/** A uniformly random date in [from, to] (inclusive; `to` < `from` returns `from`). */
export function dateBetween(rng: Rng, from: string, to: string): string {
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return span <= 0 ? from : addDays(from, rng.int(0, span));
}

/** Later of two dates. */
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Earlier of two dates. */
export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}
