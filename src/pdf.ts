// Relevé mensuel des prestations en PDF A4, généré sur le téléphone. Aucun montant n'y figure.

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { DayLine } from './core/split';
import { sumLines } from './core/split';
import { fmtDuration, fmtMonth, fmtNumericDate, fmtShortDate } from './core/format';
import type { Settings } from './data/store';
import { safeFilePart } from './share';

const INK: [number, number, number] = [23, 32, 29];
const MUTED: [number, number, number] = [80, 90, 86];
const RULE: [number, number, number] = [205, 210, 205];

export function buildReleve(monthKey: string, lines: readonly DayLine[], settings: Settings, todayKey: string): File {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 18;
  const right = 210 - 18;

  // En-tête
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relevé des prestations', left, 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(fmtMonth(monthKey), left, 31);
  doc.setFontSize(9);
  doc.text(`État au ${fmtNumericDate(todayKey)}`, right, 31, { align: 'right' });
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.line(left, 35, right, 35);

  // Identité
  const col = (right - left) / 3;
  const info: [string, string][] = [
    ['Médecin', settings.name || '-'],
    ['Fonction', settings.role || '-'],
    ['Service', settings.service || '-'],
  ];
  info.forEach(([label, value], i) => {
    const x = left + i * col;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(label, x, 43);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(value, col - 4)[0] ?? '', x, 48.5);
  });

  // Tableau
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const totals = sumLines(sorted);
  const body = sorted.map((l) => [
    fmtShortDate(l.date) + (l.manual ? ' *' : ''),
    l.startLabel,
    l.open ? 'en cours' : l.endLabel,
    l.dayMin ? fmtDuration(l.dayMin) : '-',
    l.nightMin ? fmtDuration(l.nightMin) : '-',
    fmtDuration(l.dayMin + l.nightMin),
  ]);

  autoTable(doc, {
    startY: 56,
    margin: { left, right: 210 - right, bottom: 20 },
    theme: 'plain',
    head: [['Date', 'Début', 'Fin', 'Heures jour', 'Heures nuit', 'Total']],
    body: body.length ? body : [['Aucune prestation', '', '', '', '', '']],
    foot: [['Total du mois', '', '', fmtDuration(totals.dayMin), fmtDuration(totals.nightMin), fmtDuration(totals.dayMin + totals.nightMin)]],
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: INK, cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 } },
    headStyles: { fontStyle: 'bold', lineWidth: { bottom: 0.4 }, lineColor: INK },
    bodyStyles: { lineWidth: { bottom: 0.15 }, lineColor: RULE },
    footStyles: { fontStyle: 'bold', fontSize: 10, lineWidth: { top: 0.4 }, lineColor: INK },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if ((data.section === 'head' || data.section === 'foot') && data.column.index > 0) data.cell.styles.halign = 'right';
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Notes de bas de tableau
  const notes = [
    ...(sorted.some((l) => l.manual) ? ['* Entrée corrigée ou saisie manuellement.'] : []),
    'Heures nuit : de 18h à 8h, ainsi que les week-ends et jours fériés légaux.',
    'Une prestation qui passe minuit est répartie sur deux lignes.',
  ];
  if (y + notes.length * 4.5 + 45 > 297 - 18) {
    doc.addPage();
    y = 24;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  notes.forEach((n, i) => doc.text(n, left, y + i * 4.5));

  // Cadre cachet et signature
  const boxW = 72;
  const boxH = 36;
  const boxY = Math.max(y + notes.length * 4.5 + 6, 297 - 18 - boxH - 6);
  doc.text('Cachet et signature', right - boxW, boxY - 2);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.roundedRect(right - boxW, boxY, boxW, boxH, 1.5, 1.5);

  // Numéros de page
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${p} / ${pages}`, right, 297 - 10, { align: 'right' });
    }
  }

  const who = safeFilePart(settings.name);
  const fileName = `Releve_${monthKey}${who ? `_${who}` : ''}.pdf`;
  return new File([doc.output('blob')], fileName, { type: 'application/pdf' });
}
