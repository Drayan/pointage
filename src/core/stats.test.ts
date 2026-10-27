import { describe, expect, it } from 'vitest';
import { makeHolidayChecker } from './holidays';
import { linesFor, type SessionLike } from './split';
import { daysInclusive, overallWeeklyAverage, weeklyAverage } from './stats';
import { instantOf } from './time';

const isHoliday = makeHolidayChecker();
let n = 0;
const s = (a: [string, string], b: [string, string]): SessionLike => ({
  id: `s${n++}`, start: instantOf(...a), end: instantOf(...b), manual: false, note: '',
});

describe('moyenne par semaine', () => {
  it('jours écoulés, bornes comprises', () => {
    expect(daysInclusive('2026-10-01', '2026-10-27')).toBe(27);
    expect(daysInclusive('2026-10-27', '2026-10-27')).toBe(1);
    expect(daysInclusive('2026-10-28', '2026-10-27')).toBe(0);
    expect(daysInclusive('2026-02-01', '2026-03-01')).toBe(29);
  });

  it('cinq journées de 10 h sur une semaine = 50 h par semaine', () => {
    const lines = linesFor(
      ['05', '06', '07', '08', '09'].map((d) => s([`2026-10-${d}`, '08:00'], [`2026-10-${d}`, '18:00'])),
      isHoliday,
      0,
    );
    expect(weeklyAverage(lines, '2026-10-05', '2026-10-11')?.minutesPerWeek).toBe(50 * 60);
    // sur deux semaines, la seconde sans prestation : 25 h par semaine
    expect(weeklyAverage(lines, '2026-10-05', '2026-10-18')?.minutesPerWeek).toBe(25 * 60);
  });

  it('une garde à cheval sur deux mois ne compte que sa part dans le mois', () => {
    const lines = linesFor([s(['2026-10-31', '20:00'], ['2026-11-01', '08:00'])], isHoliday, 0);
    const nov = weeklyAverage(lines, '2026-11-01', '2026-11-07');
    expect(nov?.minutesPerWeek).toBe(8 * 60);
  });

  it('moyenne générale depuis le premier jour pointé', () => {
    const lines = linesFor(
      [s(['2026-10-01', '08:00'], ['2026-10-01', '18:00']), s(['2026-10-14', '08:00'], ['2026-10-14', '18:00'])],
      isHoliday,
      0,
    );
    const avg = overallWeeklyAverage(lines, '2026-10-14');
    expect(avg).toMatchObject({ from: '2026-10-01', days: 14, minutesPerWeek: 10 * 60 });
    expect(overallWeeklyAverage([], '2026-10-14')).toBeNull();
  });
});
