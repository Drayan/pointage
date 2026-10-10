// Mise en forme des durées, montants et dates (français, Belgique).

import { parseKey, weekdayOf } from './time';

/** 585 -> '9h45', 0 -> '0h00'. */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

/** Chrono 'HH:MM' d'une durée en minutes (peut dépasser 24 h). */
export function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const euro = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
export function fmtEuro(cents: number): string {
  return euro.format(cents / 100);
}

export const DOW_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export const DOW_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** '2026-10-10' -> 'Samedi 10 octobre'. */
export function fmtLongDate(key: string): string {
  const { month, day } = parseKey(key);
  return `${DOW_LONG[weekdayOf(key)]} ${day} ${MONTHS[month - 1]}`;
}

/** '2026-10' -> 'Octobre 2026'. */
export function fmtMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const name = MONTHS[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

/** '2026-10-01' -> 'Jeu 01/10'. */
export function fmtShortDate(key: string): string {
  const { month, day } = parseKey(key);
  const dow = DOW_SHORT[weekdayOf(key)];
  return `${dow.charAt(0).toUpperCase()}${dow.slice(1)} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

/** '2026-10-10' -> '10/10/2026'. */
export function fmtNumericDate(key: string): string {
  const { year, month, day } = parseKey(key);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}
