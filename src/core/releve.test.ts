import { describe, expect, it } from 'vitest';
import { makeHolidayChecker } from './holidays';
import { buildReleveData, fmtDecimal, slotsForDay } from './releve';
import { linesFor, type SessionLike } from './split';
import { instantOf } from './time';

const isHoliday = makeHolidayChecker();
let n = 0;
const s = (a: [string, string], b: [string, string], manual = false): SessionLike => ({
  id: `s${n++}`, start: instantOf(...a), end: instantOf(...b), manual, note: '',
});

function slotsOf(date: string, sessions: SessionLike[]): string[] {
  const lines = linesFor(sessions, isHoliday, 0).filter((l) => l.date === date);
  return slotsForDay(date, lines).map((r) => `${r.morning?.label ?? '—'} | ${r.afternoon?.label ?? '—'}`);
}

describe('plages matin / après-midi', () => {
  it('une journée continue est coupée à 12h', () => {
    expect(slotsOf('2026-10-06', [s(['2026-10-06', '07:35'], ['2026-10-06', '16:50'])])).toEqual([
      'de 7h35 à 12h00 | de 12h00 à 16h50',
    ]);
  });

  it('une pause de midi donne deux plages sur la même ligne', () => {
    expect(slotsOf('2026-10-06', [
      s(['2026-10-06', '07:45'], ['2026-10-06', '12:10']),
      s(['2026-10-06', '12:40'], ['2026-10-06', '17:00']),
    ])).toEqual(['de 7h45 à 12h10 | de 12h40 à 17h00']);
  });

  it('matinée seule, soirée seule', () => {
    expect(slotsOf('2026-10-03', [s(['2026-10-03', '08:00'], ['2026-10-03', '11:30'])])).toEqual(['de 8h00 à 11h30 | —']);
    expect(slotsOf('2026-10-03', [s(['2026-10-03', '18:00'], ['2026-10-03', '23:00'])])).toEqual(['— | de 18h00 à 23h00']);
  });

  it('début de garde jusqu’à minuit', () => {
    expect(slotsOf('2026-10-07', [s(['2026-10-07', '07:50'], ['2026-10-08', '02:40'])])).toEqual([
      'de 7h50 à 12h00 | de 12h00 à 24h00',
    ]);
  });

  it('fin de garde puis journée : ligne supplémentaire', () => {
    expect(slotsOf('2026-10-08', [
      s(['2026-10-07', '07:50'], ['2026-10-08', '02:40']),
      s(['2026-10-08', '09:15'], ['2026-10-08', '17:30']),
    ])).toEqual(['de 0h00 à 2h40 | —', 'de 9h15 à 12h00 | de 12h00 à 17h30']);
  });

  it('une journée puis un rappel le soir n’est pas une pause', () => {
    expect(slotsOf('2026-10-06', [
      s(['2026-10-06', '07:45'], ['2026-10-06', '17:00']),
      s(['2026-10-06', '19:00'], ['2026-10-06', '21:00']),
    ])).toEqual(['de 7h45 à 12h00 | de 12h00 à 17h00', '— | de 19h00 à 21h00']);
  });
});

describe('relevé du mois', () => {
  const sessions = [
    s(['2026-10-01', '07:30'], ['2026-10-01', '17:45']),
    s(['2026-10-31', '20:00'], ['2026-11-01', '08:00']),
  ];
  const lines = linesFor(sessions, isHoliday, 0);

  it('tous les jours du mois, du 1er au dernier', () => {
    const oct = buildReleveData('2026-10', lines.filter((l) => l.date.startsWith('2026-10')), [], isHoliday);
    expect(oct.rows.map((r) => r.day)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    const nov = buildReleveData('2026-11', lines.filter((l) => l.date.startsWith('2026-11')), [], isHoliday);
    expect(nov.rows.length).toBe(30);
  });

  it('une garde du 31 au 1er compte sur deux relevés', () => {
    const oct = buildReleveData('2026-10', lines.filter((l) => l.date.startsWith('2026-10')), [], isHoliday);
    const nov = buildReleveData('2026-11', lines.filter((l) => l.date.startsWith('2026-11')), [], isHoliday);
    expect(oct.rows.at(-1)).toMatchObject({ day: 31, nightMin: 240, afternoon: { label: 'de 20h00 à 24h00' } });
    expect(nov.rows[0]).toMatchObject({ day: 1, nightMin: 480, morning: { label: 'de 0h00 à 8h00' } });
    expect(oct.nightMin + oct.dayMin).toBe(615 + 240);
    expect(nov.nightMin).toBe(480);
  });

  it('astreintes, jours grisés, heures décimales', () => {
    const oct = buildReleveData('2026-10', lines.filter((l) => l.date.startsWith('2026-10')), ['2026-10-14', '2026-11-02'], isHoliday);
    expect(oct.astreintes).toBe(1);
    expect(oct.rows.find((r) => r.day === 14)?.astreinte).toBe(true);
    expect(oct.rows.filter((r) => r.shaded).map((r) => r.day)).toEqual([3, 4, 10, 11, 17, 18, 24, 25, 31]);
    expect(fmtDecimal(555)).toBe('9,25');
    expect(fmtDecimal(370)).toBe('6,17');
  });
});
