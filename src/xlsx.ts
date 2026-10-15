// État d'honoraires mensuel en Excel, reproduisant la mise en page du modèle CSPO.
// La bibliothèque Excel n'est chargée qu'au moment de l'export.

import type { Borders, Fill, Font, Worksheet } from 'exceljs';
import { MONTHS } from './core/format';
import type { ReleveData } from './core/releve';
import type { Settings } from './data/store';
import { MAIL_CSPO, releveFileName } from './pdf';

const SHADE: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9D9' } };
const PLUS: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const arial = (size: number, extra: Partial<Font> = {}): Partial<Font> => ({ name: 'Arial', size, ...extra });
const thin = { style: 'thin' as const };
const medium = { style: 'medium' as const };

export async function buildReleveXlsx(data: ReleveData, settings: Settings): Promise<File> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.name || 'Pointage';
  const [y, m] = data.monthKey.split('-').map(Number);
  const monthName = MONTHS[m - 1];
  const ws: Worksheet = wb.addWorksheet(monthName.charAt(0).toUpperCase() + monthName.slice(1), {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.39, header: 0.2, footer: 0.2 },
    },
    views: [{ showGridLines: false }],
  });

  // Largeurs du modèle
  [6.86, 21.43, 21.43, 12.14, 2.29, 12.14, 15.71, 16.29].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.properties.defaultRowHeight = 12.75;

  // ----- En-tête -----
  const inst = settings.institution.split('\n').map((l) => l.trim()).filter(Boolean);
  inst.slice(0, 2).forEach((line, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = line;
    c.font = arial(12, { bold: true });
    if (i === 1) {
      c.alignment = { horizontal: 'centerContinuous' };
      ws.getCell(i + 1, 2).alignment = { horizontal: 'centerContinuous' };
    }
    ws.getRow(i + 1).height = 15.75;
  });
  ws.getRow(3).height = 8.25;
  ws.mergeCells('A4:H4');
  Object.assign(ws.getCell('A4'), { value: "ETAT D'HONORAIRES /h", font: arial(14), alignment: { horizontal: 'center' } });
  ws.getRow(4).height = 18;
  ws.getRow(5).height = 9;
  Object.assign(ws.getCell('B6'), { value: 'NOM DU MEDECIN : ', font: arial(10), alignment: { horizontal: 'right' } });
  Object.assign(ws.getCell('C6'), { value: settings.name, font: arial(10, { bold: true }) });
  Object.assign(ws.getCell('B8'), { value: 'MOIS :', font: arial(12, { bold: true }), alignment: { horizontal: 'right' } });
  Object.assign(ws.getCell('C8'), {
    value: new Date(Date.UTC(y, m - 1, 1)),
    numFmt: 'mmmm yyyy',
    font: arial(12, { bold: true }),
    alignment: { horizontal: 'left' },
  });
  ws.getRow(8).height = 15.75;
  ws.getRow(9).height = 13.5;

  // ----- En-tête du tableau (lignes 10-11 fusionnées) -----
  const heads = ['Date', 'Horaire matin', 'Horaire après-midi', 'TOTAL\nHeures de jour', '+', 'TOTAL\nHeures de nuit', 'Astreinte\n(à cocher)'];
  heads.forEach((h, i) => {
    const col = String.fromCharCode(65 + i);
    ws.mergeCells(`${col}10:${col}11`);
    const c = ws.getCell(`${col}10`);
    c.value = h;
    c.font = arial(11, { bold: true });
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const right = i === 4 || i === 6 ? medium : thin;
    for (const r of [10, 11]) {
      ws.getCell(`${col}${r}`).border = { left: medium, right, top: medium, bottom: medium };
    }
    if (i === 4) c.fill = PLUS;
  });
  ws.getRow(10).height = 12.75;
  ws.getRow(11).height = 29.25;

  // ----- Une ligne par jour du mois -----
  const first = 12;
  data.rows.forEach((r, k) => {
    const rowNo = first + k;
    const row = ws.getRow(rowNo);
    row.height = 22.5;
    const top = k === 0 ? medium : thin;
    const values: (string | number | null)[] = [
      r.manual ? `${r.day}*` : r.day,
      r.morning?.label ?? null,
      r.afternoon?.label ?? null,
      r.first && (r.dayMin || r.nightMin || r.morning || r.afternoon) ? r.dayMin / 60 : null,
      null,
      r.first && (r.dayMin || r.nightMin || r.morning || r.afternoon) ? r.nightMin / 60 : null,
      r.astreinte ? 'X' : null,
    ];
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      if (v !== null) c.value = v;
      c.font = i === 0 ? arial(10, { bold: true }) : i === 6 ? arial(12, { bold: true }) : arial(10);
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      if (i === 3 || i === 5) c.numFmt = '"T = "0.00" h"';
      const border: Partial<Borders> = { left: i === 0 ? medium : thin, right: i === 6 ? medium : thin, top, bottom: thin };
      c.border = border;
      if (i === 4) c.fill = PLUS;
      else if (r.shaded) c.fill = SHADE;
    });
  });
  const last = first + data.rows.length - 1;
  for (let i = 1; i <= 7; i++) {
    const c = ws.getCell(last, i);
    c.border = { ...c.border, bottom: medium };
  }

  // ----- TOTAL -----
  const t = last + 1;
  ws.getRow(t).height = 33.75;
  Object.assign(ws.getCell(t, 3), {
    value: 'TOTAL',
    font: arial(12, { bold: true }),
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: { left: thin, right: thin, bottom: medium },
  });
  for (const [col, minutes] of [[4, data.dayMin], [6, data.nightMin]] as const) {
    const letter = String.fromCharCode(64 + col);
    Object.assign(ws.getCell(t, col), {
      value: { formula: `SUM(${letter}${first}:${letter}${last})`, result: Math.round((minutes / 60) * 100) / 100 },
      numFmt: '0.00" h"',
      font: arial(10, { bold: true }),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { right: thin, bottom: medium },
    });
  }
  if (data.astreintes) {
    Object.assign(ws.getCell(t, 7), {
      value: { formula: `COUNTIF(G${first}:G${last},"X")`, result: data.astreintes },
      font: arial(10, { bold: true }),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { left: thin, right: medium, bottom: medium },
    });
  }

  // ----- Mentions et cachet -----
  ws.getRow(t + 1).height = 6;
  Object.assign(ws.getCell(t + 2, 2), { value: 'Copie au Médecin encadrant', font: arial(10, { italic: true }) });
  Object.assign(ws.getCell(t + 4, 2), { value: `A envoyer par mail à ${MAIL_CSPO}`, font: arial(10, { italic: true }) });
  Object.assign(ws.getCell(t + 5, 2), { value: 'début du mois qui suit les prestations', font: arial(10, { italic: true }) });
  let note = t + 7;
  if (data.rows.some((r) => r.manual)) {
    Object.assign(ws.getCell(note++, 2), { value: '* Entrée corrigée ou saisie manuellement.', font: arial(8, { italic: true }) });
  }
  Object.assign(ws.getCell(note, 2), { value: 'Heures en décimales (9,25 h = 9 h 15).', font: arial(8, { italic: true }) });

  Object.assign(ws.getCell(t + 2, 6), { value: 'Cachet et signature', font: arial(9) });
  // cadre du cachet : F à G sur cinq lignes (bordures posées cellule par cellule, sans fusion)
  for (let r = t + 3; r <= t + 7; r++) {
    for (const col of [6, 7]) {
      const b: Partial<Borders> = {};
      if (r === t + 3) b.top = thin;
      if (r === t + 7) b.bottom = thin;
      if (col === 6) b.left = thin;
      if (col === 7) b.right = thin;
      ws.getCell(r, col).border = b;
    }
  }

  ws.pageSetup.printArea = `A1:G${Math.max(t + 7, note)}`;

  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], releveFileName(data.monthKey, settings, 'xlsx'), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
