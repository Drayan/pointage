// Contenu du relevé au format CSPO : une ligne par jour du mois, deux plages (« matin », « après-midi »),
// total jour et total nuit en heures décimales, case astreinte.

import type { HolidayChecker } from './holidays';
import type { DayLine } from './split';
import { instantOf, toKey, weekdayOf } from './time';

export interface Slot {
  label: string; // 'de 7h45 à 12h00'
  start: string; // '7h45'
  end: string; // '12h00'
}

export interface ReleveRow {
  date: string; // 'AAAA-MM-JJ'
  day: number;
  first: boolean; // première ligne de cette date (les suivantes ne portent que des plages)
  morning: Slot | null;
  afternoon: Slot | null;
  dayMin: number; // sur la première ligne de la date seulement
  nightMin: number;
  astreinte: boolean;
  manual: boolean;
  shaded: boolean; // week-end ou jour férié (tarif nuit toute la journée)
}

export interface ReleveData {
  monthKey: string;
  rows: ReleveRow[];
  dayMin: number;
  nightMin: number;
  astreintes: number;
}

/** Au-delà de cet écart, deux plages d'un même jour ne sont pas une pause de midi mais deux prestations distinctes. */
export const MAX_PAUSE_MIN = 180;

/** '07:45' -> '7h45', '24:00' -> '24h00'. */
export function hLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m}`;
}

function slot(startHHMM: string, endHHMM: string): Slot {
  const start = hLabel(startHHMM);
  const end = hLabel(endHHMM);
  return { label: `de ${start} à ${end}`, start, end };
}

/** Minutes -> heures décimales arrondies au centième (pour l'affichage). */
export function decimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** 555 -> '9,25'. */
export function fmtDecimal(minutes: number): string {
  return decimalHours(minutes).toFixed(2).replace('.', ',');
}

export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Répartit les plages d'une journée entre « matin » et « après-midi » :
 * - une plage seule qui passe midi est coupée à 12h00 (matin jusqu'à midi, après-midi ensuite) ;
 * - deux plages séparées par une pause de midi (arrêt entre 10h et 14h, reprise moins de 3 h après)
 *   vont l'une le matin, l'autre l'après-midi ;
 * - toute autre plage ouvre une ligne supplémentaire à la même date.
 */
export function slotsForDay(date: string, lines: readonly DayLine[]): { morning: Slot | null; afternoon: Slot | null }[] {
  const noon = instantOf(date, '12:00');
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  const out: { morning: Slot | null; afternoon: Slot | null }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const a = sorted[i];
    const b = sorted[i + 1];
    // pause de midi : la première plage s'arrête entre 10h et 14h, la seconde reprend au plus tard 3 h après
    const H = 3_600_000;
    const isPause =
      !!b && a.end >= noon - 2 * H && a.end <= noon + 2 * H && b.end > noon && (b.start - a.end) / 60_000 <= MAX_PAUSE_MIN;
    if (isPause) {
      out.push({ morning: slot(a.startLabel, a.endLabel), afternoon: slot(b.startLabel, b.endLabel) });
      i += 2;
    } else if (a.start < noon && a.end > noon) {
      out.push({ morning: slot(a.startLabel, '12:00'), afternoon: slot('12:00', a.endLabel) });
      i += 1;
    } else if (a.end <= noon) {
      out.push({ morning: slot(a.startLabel, a.endLabel), afternoon: null });
      i += 1;
    } else {
      out.push({ morning: null, afternoon: slot(a.startLabel, a.endLabel) });
      i += 1;
    }
  }
  return out;
}

/**
 * Toutes les lignes du relevé d'un mois. `lines` : lignes par jour des sessions terminées
 * (une garde à cheval sur deux mois a déjà été coupée à minuit : chaque relevé n'en voit que sa part).
 */
export function buildReleveData(
  monthKey: string,
  lines: readonly DayLine[],
  astreintes: readonly string[],
  isHoliday: HolidayChecker,
): ReleveData {
  const [y, m] = monthKey.split('-').map(Number);
  const astreinteSet = new Set(astreintes);
  const rows: ReleveRow[] = [];
  let dayMin = 0;
  let nightMin = 0;
  let nbAstreintes = 0;
  for (let d = 1; d <= daysInMonth(monthKey); d++) {
    const date = toKey(y, m, d);
    const dayLines = lines.filter((l) => l.date === date);
    const wd = weekdayOf(date);
    const shaded = wd === 0 || wd === 6 || isHoliday(date);
    const astreinte = astreinteSet.has(date);
    if (astreinte) nbAstreintes++;
    const dMin = dayLines.reduce((s, l) => s + l.dayMin, 0);
    const nMin = dayLines.reduce((s, l) => s + l.nightMin, 0);
    dayMin += dMin;
    nightMin += nMin;
    const slots = dayLines.length ? slotsForDay(date, dayLines) : [{ morning: null, afternoon: null }];
    slots.forEach((s, k) => {
      rows.push({
        date,
        day: d,
        first: k === 0,
        morning: s.morning,
        afternoon: s.afternoon,
        dayMin: k === 0 ? dMin : 0,
        nightMin: k === 0 ? nMin : 0,
        astreinte: k === 0 && astreinte,
        manual: k === 0 && dayLines.some((l) => l.manual),
        shaded,
      });
    });
  }
  return { monthKey, rows, dayMin, nightMin, astreintes: nbAstreintes };
}
