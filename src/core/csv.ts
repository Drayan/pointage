// Export annuel pour la comptabilité : une ligne par jour et par session, puis un récapitulatif mensuel.
// Format pensé pour Excel / Numbers en Belgique : séparateur « ; », virgule décimale, UTF-8 avec BOM.

import type { DayLine } from './split';
import { fmtMonth, fmtNumericDate, fmtShortDate } from './format';

export interface CsvRates {
  rateDayCents: number;
  rateNightCents: number;
  astreinteCents: number; // forfait par soir d'astreinte (0 = non rémunéré)
}

const hours = (min: number) => (min / 60).toFixed(2).replace('.', ',');
const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const row = (values: string[]) => values.map(cell).join(';');

/** Lignes déjà filtrées sur l'année et limitées aux sessions terminées ; astreintes = dates des soirs d'astreinte. */
export function buildYearCsv(year: number, lines: readonly DayLine[], rates: CsvRates, astreintes: readonly string[] = []): string {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const yearAstreintes = astreintes.filter((d) => d.startsWith(`${year}-`)).sort();
  const amount = (min: number, rate: number) => Math.round((min * rate) / 60);

  const out: string[] = [];
  out.push(row([
    'Date', 'Jour', 'Début', 'Fin', 'Heures jour', 'Heures nuit', 'Total heures',
    'Montant jour (€)', 'Montant nuit (€)', 'Montant total (€)', 'Saisie manuelle', 'Note',
  ]));

  const months = new Map<string, { dayMin: number; nightMin: number; astreintes: number; cents: number }>();
  const monthOf = (key: string) => {
    const m = months.get(key) ?? { dayMin: 0, nightMin: 0, astreintes: 0, cents: 0 };
    months.set(key, m);
    return m;
  };
  let tDay = 0, tNight = 0, tAst = 0, tCents = 0;
  type Out = { date: string; order: number; cells: string[] };
  const detail: Out[] = [];
  for (const l of sorted) {
    const dayCents = amount(l.dayMin, rates.rateDayCents);
    const nightCents = amount(l.nightMin, rates.rateNightCents);
    detail.push({ date: l.date, order: l.start, cells: [
      fmtNumericDate(l.date), fmtShortDate(l.date).slice(0, 3), l.startLabel, l.endLabel,
      hours(l.dayMin), hours(l.nightMin), hours(l.dayMin + l.nightMin),
      euros(dayCents), euros(nightCents), euros(dayCents + nightCents),
      l.manual ? 'oui' : '', l.note,
    ] });
    const m = monthOf(l.date.slice(0, 7));
    m.dayMin += l.dayMin;
    m.nightMin += l.nightMin;
    m.cents += dayCents + nightCents;
    tDay += l.dayMin;
    tNight += l.nightMin;
    tCents += dayCents + nightCents;
  }
  for (const d of yearAstreintes) {
    // une ligne par soir d'astreinte, placée après les prestations du jour
    detail.push({ date: d, order: Number.MAX_SAFE_INTEGER, cells: [
      fmtNumericDate(d), fmtShortDate(d).slice(0, 3), '', '', '', '', '',
      '', '', euros(rates.astreinteCents), '', 'Astreinte',
    ] });
    const m = monthOf(d.slice(0, 7));
    m.astreintes++;
    m.cents += rates.astreinteCents;
    tAst++;
    tCents += rates.astreinteCents;
  }
  detail.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const d of detail) out.push(row(d.cells));

  out.push('');
  out.push(row([`Récapitulatif ${year}`, 'Heures jour', 'Heures nuit', 'Total heures', 'Astreintes', 'Montant (€)']));
  for (const [key, m] of [...months.entries()].sort()) {
    out.push(row([fmtMonth(key), hours(m.dayMin), hours(m.nightMin), hours(m.dayMin + m.nightMin), String(m.astreintes), euros(m.cents)]));
  }
  out.push(row([`Total ${year}`, hours(tDay), hours(tNight), hours(tDay + tNight), String(tAst), euros(tCents)]));
  out.push('');
  out.push(row([
    `Montants bruts calculés avec les tarifs en vigueur dans l'app à l'export : jour ${euros(rates.rateDayCents)} €/h, nuit ${euros(rates.rateNightCents)} €/h, astreinte ${euros(rates.astreinteCents)} € par soir.`,
  ]));

  return '﻿' + out.join('\r\n') + '\r\n';
}
