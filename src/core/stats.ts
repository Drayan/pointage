// Moyennes d'heures par semaine.

import type { DayLine } from './split';
import { addDays, parseKey, weekdayOf } from './time';

/** Nombre de jours de `from` à `to`, bornes comprises (0 si `to` précède `from`). */
export function daysInclusive(from: string, to: string): number {
  const a = parseKey(from);
  const b = parseKey(to);
  const diff = (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000;
  return diff < 0 ? 0 : diff + 1;
}

export interface WeeklyAverage {
  minutesPerWeek: number;
  days: number; // jours de la période
  from: string;
  to: string;
}

/**
 * Moyenne hebdomadaire sur une période : heures de la période ÷ jours écoulés × 7.
 * Les jours sans prestation (congés, récupération) comptent : c'est la moyenne réelle sur la période.
 */
export function weeklyAverage(lines: readonly DayLine[], from: string, to: string): WeeklyAverage | null {
  const days = daysInclusive(from, to);
  if (!days) return null;
  const minutes = lines
    .filter((l) => l.date >= from && l.date <= to)
    .reduce((s, l) => s + l.dayMin + l.nightMin, 0);
  return { minutesPerWeek: Math.round((minutes / days) * 7), days, from, to };
}

/** Moyenne générale : du premier jour pointé jusqu'à `today`. */
export function overallWeeklyAverage(lines: readonly DayLine[], today: string): WeeklyAverage | null {
  const past = lines.filter((l) => l.date <= today);
  if (!past.length) return null;
  const first = past.reduce((m, l) => (l.date < m ? l.date : m), past[0].date);
  return weeklyAverage(past, first, today);
}

// ---------- Semaines ISO (du lundi au dimanche) ----------

/** Lundi de la semaine d'une date. */
export function weekStart(date: string): string {
  const wd = weekdayOf(date); // 0 = dimanche
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** Numéro de semaine ISO 8601 : la semaine 1 est celle qui contient le premier jeudi de l'année. */
export function isoWeek(date: string): { year: number; week: number } {
  const thursday = addDays(weekStart(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const dayOfYear = daysInclusive(jan1, thursday); // 1 = 1er janvier
  return { year, week: Math.floor((dayOfYear - 1) / 7) + 1 };
}

/** Total jour / nuit d'une semaine complète (du lundi `monday` au dimanche). */
export function weekTotals(lines: readonly DayLine[], monday: string): { dayMin: number; nightMin: number } {
  const sunday = addDays(monday, 6);
  let dayMin = 0;
  let nightMin = 0;
  for (const l of lines) {
    if (l.date >= monday && l.date <= sunday) {
      dayMin += l.dayMin;
      nightMin += l.nightMin;
    }
  }
  return { dayMin, nightMin };
}
