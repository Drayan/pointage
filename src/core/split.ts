// Découpage d'une session en morceaux jour/nuit, puis en lignes par jour civil.

import type { HolidayChecker } from './holidays';
import { addDays, dateKeyOf, hhmmOf, localParts, MINUTE, parseKey, weekdayOf, zonedToUtc } from './time';

export type Rate = 'jour' | 'nuit';

export interface Piece {
  date: string; // date locale du début du morceau
  start: number;
  end: number;
  rate: Rate;
  minutes: number;
}

export interface SessionLike {
  id: string;
  start: number;
  end: number | null;
  manual: boolean;
  note: string;
}

export interface DayLine {
  sessionId: string;
  date: string;
  start: number;
  end: number;
  startLabel: string; // 'HH:MM'
  endLabel: string; // 'HH:MM', ou '24:00' si la session continue le lendemain
  dayMin: number;
  nightMin: number;
  manual: boolean;
  open: boolean;
  note: string;
}

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 18;

/** Jour ouvrable non férié ? */
export function isWorkday(dateKey: string, isHoliday: HolidayChecker): boolean {
  const wd = weekdayOf(dateKey);
  return wd >= 1 && wd <= 5 && !isHoliday(dateKey);
}

/** Tarif d'un morceau qui commence à cette date et cette heure locales. */
export function rateAt(dateKey: string, hour: number, isHoliday: HolidayChecker): Rate {
  return isWorkday(dateKey, isHoliday) && hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? 'jour' : 'nuit';
}

/** Prochaine frontière locale (8h, 18h ou minuit) strictement après l'instant donné. */
export function nextBoundary(ms: number): number {
  const p = localParts(ms);
  if (p.hour < DAY_START_HOUR) return zonedToUtc(p.year, p.month, p.day, DAY_START_HOUR);
  if (p.hour < DAY_END_HOUR) return zonedToUtc(p.year, p.month, p.day, DAY_END_HOUR);
  const next = parseKey(addDays(dateKeyOf(ms), 1));
  return zonedToUtc(next.year, next.month, next.day, 0);
}

/**
 * Découpe [start, end) aux frontières 8h, 18h et minuit (heure de Bruxelles).
 * La durée de chaque morceau est la différence entre deux instants absolus :
 * les nuits de changement d'heure comptent donc 23 h ou 25 h sans traitement spécial.
 */
export function splitInterval(start: number, end: number, isHoliday: HolidayChecker): Piece[] {
  const pieces: Piece[] = [];
  let cursor = start;
  while (cursor < end) {
    const boundary = Math.min(nextBoundary(cursor), end);
    const p = localParts(cursor);
    const date = dateKeyOf(cursor);
    pieces.push({
      date,
      start: cursor,
      end: boundary,
      rate: rateAt(date, p.hour, isHoliday),
      minutes: Math.round((boundary - cursor) / MINUTE),
    });
    cursor = boundary;
  }
  return pieces;
}

/** Une ligne par jour civil pour une session (une session ouverte s'arrête à `now`). */
export function linesForSession(s: SessionLike, isHoliday: HolidayChecker, now: number): DayLine[] {
  const end = s.end ?? Math.max(now, s.start);
  const lines: DayLine[] = [];
  for (const piece of splitInterval(s.start, end, isHoliday)) {
    let line = lines.at(-1);
    if (!line || line.date !== piece.date) {
      line = {
        sessionId: s.id,
        date: piece.date,
        start: piece.start,
        end: piece.end,
        startLabel: hhmmOf(piece.start),
        endLabel: '',
        dayMin: 0,
        nightMin: 0,
        manual: s.manual,
        open: s.end === null,
        note: s.note,
      };
      lines.push(line);
    }
    line.end = piece.end;
    if (piece.rate === 'jour') line.dayMin += piece.minutes;
    else line.nightMin += piece.minutes;
  }
  for (const line of lines) {
    const continuesNextDay = dateKeyOf(line.end) !== line.date;
    line.endLabel = continuesNextDay ? '24:00' : hhmmOf(line.end);
  }
  return lines;
}

/** Toutes les lignes d'un ensemble de sessions, triées par date puis heure de début. */
export function linesFor(sessions: readonly SessionLike[], isHoliday: HolidayChecker, now: number): DayLine[] {
  return sessions
    .flatMap((s) => linesForSession(s, isHoliday, now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

export function sumLines(lines: readonly DayLine[]): { dayMin: number; nightMin: number } {
  let dayMin = 0;
  let nightMin = 0;
  for (const l of lines) {
    dayMin += l.dayMin;
    nightMin += l.nightMin;
  }
  return { dayMin, nightMin };
}

/** Estimation brute en centimes, arrondie une seule fois, à la fin. */
export function grossCents(dayMin: number, nightMin: number, rateDayCents: number, rateNightCents: number): number {
  return Math.round((dayMin * rateDayCents + nightMin * rateNightCents) / 60);
}
