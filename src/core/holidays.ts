// Jours fériés légaux belges + dates ajoutées par l'utilisateur.

import { addDays, toKey } from './time';

export interface Holiday {
  date: string; // 'AAAA-MM-JJ'
  name: string;
}

/**
 * Dimanche de Pâques (calendrier grégorien), algorithme de Meeus/Jones/Butcher.
 * Pâques = premier dimanche après la pleine lune ecclésiastique qui suit le 21 mars.
 */
export function easterSunday(year: number): string {
  const a = year % 19; // place dans le cycle lunaire de 19 ans
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25); // dérive du cycle lunaire
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; // âge de la lune -> pleine lune
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; // jours jusqu'au dimanche suivant
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toKey(year, month, day);
}

/** Les 10 jours fériés légaux belges d'une année, dans l'ordre. */
export function legalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { date: toKey(year, 1, 1), name: "Jour de l'an" },
    { date: addDays(easter, 1), name: 'Lundi de Pâques' },
    { date: toKey(year, 5, 1), name: 'Fête du Travail' },
    { date: addDays(easter, 39), name: 'Ascension' },
    { date: addDays(easter, 50), name: 'Lundi de Pentecôte' },
    { date: toKey(year, 7, 21), name: 'Fête nationale' },
    { date: toKey(year, 8, 15), name: 'Assomption' },
    { date: toKey(year, 11, 1), name: 'Toussaint' },
    { date: toKey(year, 11, 11), name: 'Armistice' },
    { date: toKey(year, 12, 25), name: 'Noël' },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

export type HolidayChecker = (dateKey: string) => boolean;

/** Fonction « cette date est-elle fériée ? », avec cache par année. */
export function makeHolidayChecker(extraDates: readonly string[] = []): HolidayChecker {
  const extra = new Set(extraDates);
  const byYear = new Map<number, Set<string>>();
  return (key: string) => {
    if (extra.has(key)) return true;
    const year = Number(key.slice(0, 4));
    let set = byYear.get(year);
    if (!set) {
      set = new Set(legalHolidays(year).map((h) => h.date));
      byYear.set(year, set);
    }
    return set.has(key);
  };
}
