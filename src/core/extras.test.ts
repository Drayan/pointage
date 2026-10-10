import { describe, expect, it } from 'vitest';
import { findAnomalies } from './anomalies';
import { buildYearCsv } from './csv';
import { makeHolidayChecker } from './holidays';
import { linesFor, linesForSession } from './split';
import { instantOf } from './time';

const isHoliday = makeHolidayChecker();
const s = (id: string, a: [string, string], b: [string, string] | null) => ({
  id, start: instantOf(...a), end: b ? instantOf(...b) : null, manual: false, note: '',
});

describe('sessions de plus de 24 h', () => {
  it('journée enchaînée avec une garde : 34 h sur deux jours', () => {
    const lines = linesForSession(s('g', ['2026-10-13', '08:00'], ['2026-10-14', '18:00']), isHoliday, 0);
    expect(lines.map((l) => [l.date, l.startLabel, l.endLabel, l.dayMin, l.nightMin])).toEqual([
      ['2026-10-13', '08:00', '24:00', 600, 360],
      ['2026-10-14', '00:00', '18:00', 600, 480],
    ]);
  });
});

describe('anomalies', () => {
  it('signale deux sessions qui se chevauchent', () => {
    const a = findAnomalies([
      s('a', ['2026-10-05', '08:00'], ['2026-10-05', '18:00']),
      s('b', ['2026-10-05', '17:00'], ['2026-10-05', '20:00']),
      s('c', ['2026-10-06', '08:00'], ['2026-10-06', '18:00']),
    ], 0);
    expect(a.get('a')).toEqual(['overlap']);
    expect(a.get('b')).toEqual(['overlap']);
    expect(a.has('c')).toBe(false);
  });

  it('deux sessions bout à bout ne se chevauchent pas', () => {
    const a = findAnomalies([
      s('a', ['2026-10-05', '08:00'], ['2026-10-05', '18:00']),
      s('b', ['2026-10-05', '18:00'], ['2026-10-06', '08:00']),
    ], 0);
    expect(a.size).toBe(0);
  });

  it('une journée + garde de 34 h n’est pas une anomalie, 50 h oui', () => {
    const a = findAnomalies([
      s('ok', ['2026-10-13', '08:00'], ['2026-10-14', '18:00']),
      s('long', ['2026-10-20', '08:00'], ['2026-10-22', '10:00']),
    ], 0);
    expect(a.has('ok')).toBe(false);
    expect(a.get('long')).toEqual(['long']);
  });

  it('une session englobée par une longue session est signalée', () => {
    const a = findAnomalies([
      s('big', ['2026-10-05', '08:00'], ['2026-10-06', '08:00']),
      s('in1', ['2026-10-05', '10:00'], ['2026-10-05', '11:00']),
      s('in2', ['2026-10-05', '20:00'], ['2026-10-05', '21:00']),
    ], 0);
    expect(a.get('in2')).toEqual(['overlap']);
    expect(a.get('big')).toEqual(['overlap']);
  });
});

describe('export CSV annuel', () => {
  it('lignes, récapitulatif mensuel et totaux en format belge', () => {
    const sessions = [
      s('1', ['2026-09-30', '07:30'], ['2026-09-30', '17:45']),
      { ...s('2', ['2026-10-07', '07:50'], ['2026-10-08', '02:40']), manual: true, note: 'garde; urgences' },
    ];
    const csv = buildYearCsv(2026, linesFor(sessions, isHoliday, 0), { rateDayCents: 2600, rateNightCents: 3400 });
    const rows = csv.replace('﻿', '').trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(rows[0]).toBe('Date;Jour;Début;Fin;Heures jour;Heures nuit;Total heures;Montant jour (€);Montant nuit (€);Montant total (€);Saisie manuelle;Note');
    expect(rows[1]).toBe('30/09/2026;Mer;07:30;17:45;9,75;0,50;10,25;253,50;17,00;270,50;;');
    expect(rows[2]).toBe('07/10/2026;Mer;07:50;24:00;10,00;6,17;16,17;260,00;209,67;469,67;oui;"garde; urgences"');
    expect(rows[3]).toBe('08/10/2026;Jeu;00:00;02:40;0,00;2,67;2,67;0,00;90,67;90,67;oui;"garde; urgences"');
    expect(rows).toContain('Septembre 2026;9,75;0,50;10,25;270,50');
    expect(rows).toContain('Octobre 2026;10,00;8,83;18,83;560,34');
    expect(rows).toContain('Total 2026;19,75;9,33;29,08;830,84');
  });
});
