import { describe, expect, it } from 'vitest';
import { easterSunday, legalHolidays, makeHolidayChecker } from './holidays';
import { grossCents, linesForSession, splitInterval, type SessionLike } from './split';
import { instantOf, zonedToUtc } from './time';
import { fmtDuration } from './format';

const isHoliday = makeHolidayChecker();

/** Session de test : début et fin en heure de Bruxelles. */
function session(startDate: string, startTime: string, endDate: string, endTime: string): SessionLike {
  return { id: 't', start: instantOf(startDate, startTime), end: instantOf(endDate, endTime), manual: false, note: '' };
}

/** Lignes réduites à « date : J … · N … » pour des comparaisons lisibles. */
function summary(s: SessionLike, checker = isHoliday): string[] {
  return linesForSession(s, checker, 0).map(
    (l) => `${l.date} ${l.startLabel}-${l.endLabel} J ${fmtDuration(l.dayMin)} N ${fmtDuration(l.nightMin)}`,
  );
}

describe('fuseau horaire', () => {
  it('convertit une heure de Bruxelles en été (UTC+2) et en hiver (UTC+1)', () => {
    expect(zonedToUtc(2026, 10, 10, 8, 0)).toBe(Date.UTC(2026, 9, 10, 6, 0));
    expect(zonedToUtc(2026, 12, 1, 8, 0)).toBe(Date.UTC(2026, 11, 1, 7, 0));
  });
});

describe('découpage jour/nuit', () => {
  it('journée type', () => {
    expect(summary(session('2026-10-06', '07:35', '2026-10-06', '16:50'))).toEqual([
      '2026-10-06 07:35-16:50 J 8h50 N 0h25',
    ]);
  });

  it('début pile à 8h, fin pile à 18h', () => {
    expect(summary(session('2026-10-05', '08:00', '2026-10-05', '18:00'))).toEqual([
      '2026-10-05 08:00-18:00 J 10h00 N 0h00',
    ]);
  });

  it('garde qui passe minuit : une ligne par jour', () => {
    expect(summary(session('2026-10-07', '07:50', '2026-10-08', '02:40'))).toEqual([
      '2026-10-07 07:50-24:00 J 10h00 N 6h10',
      '2026-10-08 00:00-02:40 J 0h00 N 2h40',
    ]);
  });

  it('vendredi soir jusqu’au samedi', () => {
    expect(summary(session('2026-10-09', '17:00', '2026-10-10', '02:00'))).toEqual([
      '2026-10-09 17:00-24:00 J 1h00 N 6h00',
      '2026-10-10 00:00-02:00 J 0h00 N 2h00',
    ]);
  });

  it('samedi : tout au tarif nuit', () => {
    expect(summary(session('2026-10-03', '08:00', '2026-10-03', '12:30'))).toEqual([
      '2026-10-03 08:00-12:30 J 0h00 N 4h30',
    ]);
  });

  it('jour férié en semaine : tarif nuit', () => {
    expect(summary(session('2026-11-11', '09:00', '2026-11-11', '17:00'))).toEqual([
      '2026-11-11 09:00-17:00 J 0h00 N 8h00',
    ]);
  });

  it('date ajoutée dans les réglages : tarif nuit', () => {
    const checker = makeHolidayChecker(['2026-11-02']);
    expect(summary(session('2026-11-02', '09:00', '2026-11-02', '17:00'), checker)).toEqual([
      '2026-11-02 09:00-17:00 J 0h00 N 8h00',
    ]);
  });

  it('passage à l’heure d’hiver : la nuit compte 1 h de plus', () => {
    const s = session('2026-10-24', '20:00', '2026-10-25', '08:00');
    expect(summary(s)).toEqual(['2026-10-24 20:00-24:00 J 0h00 N 4h00', '2026-10-25 00:00-08:00 J 0h00 N 9h00']);
    expect((s.end! - s.start) / 3_600_000).toBe(13);
  });

  it('passage à l’heure d’été : la nuit compte 1 h de moins', () => {
    const s = session('2027-03-27', '20:00', '2027-03-28', '08:00');
    expect(summary(s)).toEqual(['2027-03-27 20:00-24:00 J 0h00 N 4h00', '2027-03-28 00:00-08:00 J 0h00 N 7h00']);
    expect((s.end! - s.start) / 3_600_000).toBe(11);
  });

  it('la somme des morceaux égale toujours la durée réelle', () => {
    const start = instantOf('2026-10-20', '06:13');
    const end = instantOf('2026-10-27', '19:47');
    const pieces = splitInterval(start, end, isHoliday);
    const total = pieces.reduce((acc, p) => acc + p.minutes, 0);
    expect(total).toBe((end - start) / 60_000);
  });

  it('session ouverte : s’arrête à l’instant présent', () => {
    const start = instantOf('2026-10-10', '07:42');
    const now = instantOf('2026-10-10', '13:31');
    const [line] = linesForSession({ id: 'o', start, end: null, manual: false, note: '' }, isHoliday, now);
    expect(line.open).toBe(true);
    expect(line.nightMin).toBe(349);
  });
});

describe('jours fériés', () => {
  it('date de Pâques', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2038)).toBe('2038-04-25');
    expect(easterSunday(2008)).toBe('2008-03-23');
  });

  it('les 10 jours fériés légaux de 2026', () => {
    expect(legalHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25',
      '2026-07-21', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ]);
  });
});

describe('estimation brute', () => {
  it('65h50 de jour à 26 € et 16h35 de nuit à 34 €', () => {
    expect(grossCents(65 * 60 + 50, 16 * 60 + 35, 2600, 3400)).toBe(227550);
  });
});
