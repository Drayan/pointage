// Gestion de l'heure de Bruxelles, indépendamment du fuseau réglé sur le téléphone.
// Tous les instants sont des millisecondes UTC (comme Date.now()).

export const TZ = 'Europe/Brussels';
export const MINUTE = 60_000;

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Composantes de l'heure locale (Bruxelles) d'un instant. */
export function localParts(ms: number): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute };
}

/** Décalage de Bruxelles par rapport à UTC à cet instant, en ms (+1 h ou +2 h). */
function offsetAt(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / MINUTE) * MINUTE;
}

/**
 * Instant correspondant à une heure locale de Bruxelles.
 * Deux passes suffisent pour retomber sur le bon décalage autour d'un changement d'heure.
 * (Les heures inexistantes ou ambiguës, entre 2h et 3h, ne servent jamais de frontière.)
 */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return guess;
}

/** Clé de date locale 'AAAA-MM-JJ'. */
export function dateKeyOf(ms: number): string {
  const p = localParts(ms);
  return toKey(p.year, p.month, p.day);
}

export function toKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Jour de la semaine d'une date locale : 0 = dimanche … 6 = samedi. */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Début de la journée locale (minuit à Bruxelles) d'une date. */
export function startOfDay(key: string): number {
  const { year, month, day } = parseKey(key);
  return zonedToUtc(year, month, day);
}

/** Instant d'une date locale + heure 'HH:MM'. */
export function instantOf(key: string, hhmm: string): number {
  const { year, month, day } = parseKey(key);
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(year, month, day, h, m);
}

export function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE) * MINUTE;
}

/** Heure locale 'HH:MM'. */
export function hhmmOf(ms: number): string {
  const p = localParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Mois local 'AAAA-MM'. */
export function monthKeyOf(ms: number): string {
  return dateKeyOf(ms).slice(0, 7);
}

export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
