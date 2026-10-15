// État d'honoraires mensuel en PDF A4, au format du modèle CSPO, généré sur le téléphone.
// Heures en décimales ; aucun montant n'y figure.

import { jsPDF } from 'jspdf';
import { fmtMonth, fmtNumericDate } from './core/format';
import { fmtDecimal, type ReleveData } from './core/releve';
import type { Settings } from './data/store';
import { safeFilePart } from './share';

type RGB = [number, number, number];
const INK: RGB = [0, 0, 0];
const MUTED: RGB = [70, 70, 70];
const SHADE: RGB = [253, 233, 217]; // week-ends et fériés (teinte du modèle)
const PLUS: RGB = [217, 217, 217]; // colonne « + »

export const MAIL_CSPO = 'DirMed_Prestations_indep@cspo.be';

// Largeurs des colonnes du modèle (A à G), mises à l'échelle de la page
const MODEL_WIDTHS = [6.86, 21.43, 21.43, 12.14, 2.29, 12.14, 15.71];
const LEFT = 10;
const RIGHT = 200;
const BOTTOM = 287;
const COLS = (() => {
  const total = MODEL_WIDTHS.reduce((a, b) => a + b, 0);
  const xs: number[] = [LEFT];
  for (const w of MODEL_WIDTHS) xs.push(xs.at(-1)! + (w * (RIGHT - LEFT)) / total);
  return xs; // 8 bornes pour 7 colonnes
})();
const colX = (i: number) => COLS[i];
const colW = (i: number) => COLS[i + 1] - COLS[i];
const colMid = (i: number) => COLS[i] + colW(i) / 2;

const THIN = 0.2;
const MEDIUM = 0.5;

export function releveFileName(monthKey: string, settings: Settings, ext: 'pdf' | 'xlsx'): string {
  const who = safeFilePart(settings.name);
  return `Etat_honoraires_${monthKey}${who ? `_${who}` : ''}.${ext}`;
}

export function buildRelevePdf(data: ReleveData, settings: Settings, todayKey: string): File {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setTextColor(...INK);
  doc.setDrawColor(...INK);

  const text = (s: string, x: number, y: number, size: number, style: 'normal' | 'bold' | 'italic' = 'normal', align: 'left' | 'center' | 'right' = 'left') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.text(s, x, y, { align, baseline: 'middle' });
  };

  // ----- En-tête -----
  const lines = settings.institution.split('\n').map((l) => l.trim()).filter(Boolean);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const instW = Math.max(...lines.map((l) => doc.getTextWidth(l)), 0);
  lines.forEach((l, i) => text(l, i === 0 ? LEFT : LEFT + instW / 2, 13 + i * 5, 11, 'bold', i === 0 ? 'left' : 'center'));
  text("ETAT D'HONORAIRES /h", (LEFT + RIGHT) / 2, 26, 14, 'normal', 'center');
  text('NOM DU MEDECIN :', colX(2) - 2, 35, 9.5, 'normal', 'right');
  text(settings.name || '', colX(2) + 1, 35, 11, 'bold');
  text('MOIS :', colX(2) - 2, 43, 11, 'bold', 'right');
  text(fmtMonth(data.monthKey), colX(2) + 1, 43, 11, 'bold');
  text(`État au ${fmtNumericDate(todayKey)}`, RIGHT, 43, 8, 'normal', 'right');

  // ----- Tableau -----
  const headTop = 50;
  const headH = 15;
  const totalH = 9;
  const footerH = 36;
  const rows = data.rows;
  const rowH = Math.min(7.5, Math.max(4.8, (BOTTOM - footerH - totalH - headTop - headH) / rows.length));

  const drawHeader = (top: number) => {
    doc.setFillColor(...PLUS);
    doc.rect(colX(4), top, colW(4), headH, 'F');
    const heads: string[][] = [
      ['Date'], ['Horaire matin'], ['Horaire après-midi'], ['TOTAL', 'Heures de', 'jour'], ['+'], ['TOTAL', 'Heures de', 'nuit'], ['Astreinte', '(à cocher)'],
    ];
    heads.forEach((h, i) => {
      const startY = top + headH / 2 - ((h.length - 1) * 3.6) / 2;
      h.forEach((t, k) => text(t, colMid(i), startY + k * 3.6, i === 6 && k === 1 ? 8.5 : 9.5, i === 6 && k === 1 ? 'italic' : 'bold', 'center'));
    });
    doc.setLineWidth(MEDIUM);
    doc.rect(LEFT, top, RIGHT - LEFT, headH);
    for (let i = 1; i < 7; i++) {
      doc.setLineWidth(i === 4 || i === 5 || i === 6 ? MEDIUM : THIN);
      doc.line(colX(i), top, colX(i), top + headH);
    }
  };

  let y = headTop;
  drawHeader(y);
  y += headH;
  let pageTop = y;

  const closeTableFrame = (from: number, to: number) => {
    doc.setLineWidth(MEDIUM);
    doc.line(LEFT, from, LEFT, to);
    doc.line(RIGHT, from, RIGHT, to);
    doc.line(colX(6), from, colX(6), to);
  };

  rows.forEach((r) => {
    if (y + rowH > BOTTOM - totalH) {
      closeTableFrame(pageTop, y);
      doc.addPage();
      y = 15;
      drawHeader(y);
      y += headH;
      pageTop = y;
    }
    if (r.shaded) {
      doc.setFillColor(...SHADE);
      doc.rect(LEFT, y, RIGHT - LEFT, rowH, 'F');
    }
    doc.setFillColor(...PLUS);
    doc.rect(colX(4), y, colW(4), rowH, 'F');
    // trait du haut redessiné après le fond : sinon un jour grisé efface la ligne qui le sépare du précédent
    doc.setLineWidth(y === pageTop ? MEDIUM : THIN);
    doc.line(LEFT, y, RIGHT, y);
    const mid = y + rowH / 2;
    const size = rowH < 5.5 ? 8.5 : 9.5;
    text(`${r.day}${r.manual ? '*' : ''}`, colMid(0), mid, size, 'bold', 'center');
    if (r.morning) text(r.morning.label, colMid(1), mid, size, 'normal', 'center');
    if (r.afternoon) text(r.afternoon.label, colMid(2), mid, size, 'normal', 'center');
    if (r.first && (r.dayMin || r.nightMin || r.morning || r.afternoon)) {
      text(`T = ${fmtDecimal(r.dayMin)} h`, colMid(3), mid, size, 'normal', 'center');
      text(`T = ${fmtDecimal(r.nightMin)} h`, colMid(5), mid, size, 'normal', 'center');
    }
    if (r.astreinte) text('X', colMid(6), mid, 11, 'bold', 'center');
    doc.setLineWidth(THIN);
    doc.line(LEFT, y + rowH, RIGHT, y + rowH);
    for (let i = 1; i < 7; i++) doc.line(colX(i), y, colX(i), y + rowH);
    y += rowH;
  });
  closeTableFrame(pageTop, y);
  doc.setLineWidth(MEDIUM);
  doc.line(LEFT, y, RIGHT, y);

  // ----- Ligne TOTAL -----
  doc.setLineWidth(THIN);
  doc.rect(colX(2), y, colX(4) - colX(2), totalH);
  doc.rect(colX(5), y, colW(5), totalH);
  doc.setLineWidth(MEDIUM);
  doc.line(colX(2), y + totalH, colX(4), y + totalH);
  doc.line(colX(5), y + totalH, colX(6), y + totalH);
  text('TOTAL', colMid(2), y + totalH / 2, 11, 'bold', 'center');
  text(`${fmtDecimal(data.dayMin)} h`, colMid(3), y + totalH / 2, 10, 'bold', 'center');
  text(`${fmtDecimal(data.nightMin)} h`, colMid(5), y + totalH / 2, 10, 'bold', 'center');
  if (data.astreintes) {
    doc.setLineWidth(THIN);
    doc.rect(colX(6), y, colW(6), totalH);
    text(String(data.astreintes), colMid(6), y + totalH / 2, 10, 'bold', 'center');
  }
  y += totalH + 6;

  // ----- Pied : mentions à gauche, cachet à droite -----
  if (y + 29 > BOTTOM) {
    doc.addPage();
    y = 20;
  }
  const notes: string[] = [];
  if (data.rows.some((r) => r.manual)) notes.push('* Entrée corrigée ou saisie manuellement.');
  notes.push('Heures en décimales (9,25 h = 9 h 15).');
  notes.push('Heures de nuit : de 18h à 8h, week-ends et jours fériés.');
  doc.setTextColor(...MUTED);
  notes.forEach((n, i) => text(n, LEFT, y + i * 4, 8));
  doc.setTextColor(...INK);
  const ny = y + notes.length * 4 + 3;
  text('Copie au Médecin encadrant', colX(1), ny, 9.5, 'italic');
  text(`A envoyer par mail à ${MAIL_CSPO}`, colX(1), ny + 5, 9.5, 'italic');
  text('début du mois qui suit les prestations', colX(1), ny + 9.5, 9.5, 'italic');

  const boxW = RIGHT - colX(5) + 4;
  const boxX = RIGHT - boxW;
  text('Cachet et signature', boxX, y, 8.5, 'normal');
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y + 2.5, boxW, 26, 1.2, 1.2);

  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      text(`${p} / ${pages}`, RIGHT, 292, 8, 'normal', 'right');
    }
  }

  return new File([doc.output('blob')], releveFileName(data.monthKey, settings, 'pdf'), { type: 'application/pdf' });
}
