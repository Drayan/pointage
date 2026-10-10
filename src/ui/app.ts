// Interface : trois onglets (Pointer, Historique, Réglages), la feuille de correction et les bandeaux.
// Rendu par chaînes HTML et délégation d'événements, sans framework.

import { findAnomalies, type Anomaly } from '../core/anomalies';
import { buildYearCsv } from '../core/csv';
import { fmtClock, fmtDuration, fmtEuro, fmtLongDate, fmtMonth, fmtShortDate, DOW_SHORT, MONTHS } from '../core/format';
import { legalHolidays, makeHolidayChecker, type HolidayChecker } from '../core/holidays';
import { grossCents, linesFor, linesForSession, rateAt, sumLines, type DayLine } from '../core/split';
import {
  addDays, addMonths, dateKeyOf, floorToMinute, hhmmOf, instantOf, localParts, MINUTE, monthKeyOf, parseKey, weekdayOf,
} from '../core/time';
import {
  importBackup, loadSessions, loadSettings, makeBackup, newId, removeSession, requestPersistence, saveSession,
  saveSettings, type Session, type Settings,
} from '../data/store';
import { buildReleve } from '../pdf';
import { shareOrDownload } from '../share';
import { icons } from './icons';

type Tab = 'pointer' | 'historique' | 'reglages';

interface EditState {
  id: string | null; // null = nouvelle entrée
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  note: string;
  wasOpen: boolean; // la session éditée est en cours
  keepOpen: boolean; // ne corriger que le début, la session continue
}

interface State {
  sessions: Session[];
  settings: Settings;
  tab: Tab;
  month: string;
  edit: EditState | null;
  backupSheet: boolean;
  updateReady: (() => void) | null;
}

const DAY = 24 * 60 * MINUTE;
const BACKUP_REMINDER_DAYS = 35;
const UNDO_MS = 6000;

let state: State;
let root: HTMLElement;
let checkerKey = '';
let checker: HolidayChecker = makeHolidayChecker();

// ---------- Outils ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const now = () => Date.now();

function isHoliday(): HolidayChecker {
  const key = state.settings.extraHolidays.join(',');
  if (key !== checkerKey) {
    checkerKey = key;
    checker = makeHolidayChecker(state.settings.extraHolidays);
  }
  return checker;
}

const openSession = () => state.sessions.find((s) => s.end === null) ?? null;
const closedSessions = () => state.sessions.filter((s) => s.end !== null);

function monthLines(monthKey: string, sessions: readonly Session[] = state.sessions): DayLine[] {
  return linesFor(sessions, isHoliday(), now()).filter((l) => l.date.startsWith(monthKey));
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Message bref en bas d'écran, avec éventuellement un bouton (Annuler). */
function toast(message: string, action?: { label: string; run: () => void | Promise<void> }): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      void action.run();
    });
    el.append(btn);
  }
  document.body.append(el);
  const life = action ? UNDO_MS : 2600;
  setTimeout(() => el.classList.add('toast-out'), life);
  setTimeout(() => el.remove(), life + 400);
}

/** « depuis 07:42 », « depuis hier 07:45 », « depuis ven 09/10 07:45 ». */
function sinceLabel(start: number): string {
  const today = dateKeyOf(now());
  const key = dateKeyOf(start);
  const time = hhmmOf(start);
  if (key === today) return `depuis ${time}`;
  if (key === addDays(today, -1)) return `depuis hier ${time}`;
  return `depuis ${fmtShortDate(key).toLowerCase()} ${time}`;
}

function startedLabel(start: number): string {
  const today = dateKeyOf(now());
  const key = dateKeyOf(start);
  const time = hhmmOf(start);
  if (key === today) return `Démarrée aujourd'hui à ${time}.`;
  if (key === addDays(today, -1)) return `Démarrée hier à ${time}.`;
  return `Démarrée le ${fmtShortDate(key).toLowerCase()} à ${time}.`;
}

function rateContext(t: number): { label: string; kind: 'day' | 'night' } {
  const key = dateKeyOf(t);
  const hc = isHoliday();
  if (hc(key)) return { label: 'Férié · tarif nuit', kind: 'night' };
  const wd = weekdayOf(key);
  if (wd === 0 || wd === 6) return { label: 'Week-end · tarif nuit', kind: 'night' };
  return rateAt(key, localParts(t).hour, hc) === 'jour'
    ? { label: 'Tarif jour', kind: 'day' }
    : { label: 'Tarif nuit', kind: 'night' };
}

/** « de mars », « d'octobre ». */
const deMonth = (name: string) => (/^[aeiouy]/i.test(name) ? `d'${name}` : `de ${name}`);

function monthName(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function tiles(dayMin: number, nightMin: number, withTotal = false): string {
  return `<div class="tiles ${withTotal ? 'tiles-3' : ''}">
    <div class="tile tile-day"><span class="tile-label">Jour</span><span class="tile-value mono">${fmtDuration(dayMin)}</span></div>
    <div class="tile tile-night"><span class="tile-label">Nuit</span><span class="tile-value mono">${fmtDuration(nightMin)}</span></div>
    ${withTotal ? `<div class="tile tile-neutral"><span class="tile-label">Total</span><span class="tile-value mono">${fmtDuration(dayMin + nightMin)}</span></div>` : ''}
  </div>`;
}

// ---------- Écran Pointer ----------

function alertVisible(s: Session | null): boolean {
  if (!s) return false;
  const elapsed = now() - s.start;
  if (elapsed < state.settings.alertHours * 3_600_000) return false;
  const snooze = state.settings.alertSnoozeUntil;
  return !(snooze && now() < snooze);
}

function backupReminderVisible(): boolean {
  if (!state.sessions.length) return false;
  const oldest = Math.min(...state.sessions.map((s) => s.start));
  const since = now() - (state.settings.lastBackup ?? oldest);
  const dismissed = state.settings.backupReminderDismissedAt;
  if (dismissed && now() - dismissed < 7 * DAY) return false;
  return since > BACKUP_REMINDER_DAYS * DAY;
}

/** Mois précédent dont le relevé n'est pas encore parti (et dont le rappel n'a pas été écarté). */
function pendingReleveMonth(): string | null {
  const prev = addMonths(monthKeyOf(now()), -1);
  if (state.settings.relevesSent[prev] || state.settings.releveReminderDismissed === prev) return null;
  return monthLines(prev, closedSessions()).length ? prev : null;
}

function renderPointer(): string {
  const t = now();
  const s = openSession();
  const ctx = rateContext(t);
  const month = monthKeyOf(t);
  const totals = sumLines(monthLines(month, closedSessions()));
  const gross = grossCents(totals.dayMin, totals.nightMin, state.settings.rateDayCents, state.settings.rateNightCents);

  let sessionCard: string;
  if (s) {
    const live = sumLines(linesForSession(s, isHoliday(), t));
    const elapsedMin = Math.max(0, Math.floor((t - s.start) / MINUTE));
    const warn = alertVisible(s);
    sessionCard = `<section class="card session-card" aria-label="Session en cours">
      <div class="session-head">
        <span class="dot ${warn ? 'dot-warn' : 'dot-live'}"></span>
        <span class="strong">Session en cours</span>
        <button type="button" class="link-btn push" data-action="edit" data-id="${s.id}" aria-label="Corriger l'heure de début">${sinceLabel(s.start)}</button>
      </div>
      <div class="chrono mono ${warn ? 'chrono-warn' : ''}" aria-live="polite">${fmtClock(elapsedMin)}</div>
      ${tiles(live.dayMin, live.nightMin)}
      <button type="button" class="btn btn-primary btn-xl" data-action="stop">${warn ? 'Terminer maintenant' : 'Terminer'}</button>
    </section>`;
  } else {
    sessionCard = `<section class="card session-card" aria-label="Pointage">
      <div class="session-head">
        <span class="dot dot-idle"></span>
        <span class="strong">Aucune session en cours</span>
      </div>
      <div class="chrono mono chrono-idle">00:00</div>
      <button type="button" class="btn btn-primary btn-xl" data-action="start">Démarrer</button>
    </section>`;
  }

  const alert = alertVisible(s)
    ? `<section class="banner banner-warn" role="alert">
        <div class="banner-body">
          <span class="banner-icon">${icons.alert}</span>
          <div class="stack-4">
            <span class="banner-title">Session ouverte depuis ${Math.floor((t - s!.start) / 3_600_000)} h ${String(Math.floor(((t - s!.start) % 3_600_000) / MINUTE)).padStart(2, '0')}</span>
            <span>${startedLabel(s!.start)} As-tu oublié de pointer la fin ?</span>
          </div>
        </div>
        <div class="stack-8">
          <button type="button" class="btn btn-primary" data-action="fix-open">Corriger l'heure de fin</button>
          <button type="button" class="btn btn-outline-warn" data-action="snooze">Je travaille encore</button>
        </div>
      </section>`
    : '';

  const update = state.updateReady
    ? `<section class="banner banner-info"><span>Une nouvelle version de l'app est prête.</span>
        <button type="button" class="btn btn-small" data-action="apply-update">Mettre à jour</button></section>`
    : '';

  const pending = pendingReleveMonth();
  const releve = pending
    ? `<section class="banner banner-info">
        <span>Le relevé ${deMonth(monthName(pending))} n'a pas encore été envoyé.</span>
        <div class="row-8">
          <button type="button" class="btn btn-small" data-action="releve" data-month="${pending}">Envoyer</button>
          <button type="button" class="btn btn-small btn-ghost" data-action="dismiss-releve" data-month="${pending}">Plus tard</button>
        </div>
      </section>`
    : '';

  const backup = backupReminderVisible()
    ? `<section class="banner banner-info">
        <span>${state.settings.lastBackup ? `Dernière sauvegarde il y a ${Math.floor((t - state.settings.lastBackup) / DAY)} jours.` : 'Aucune sauvegarde pour l’instant.'}</span>
        <div class="row-8">
          <button type="button" class="btn btn-small" data-action="export">Exporter</button>
          <button type="button" class="btn btn-small btn-ghost" data-action="dismiss-backup">Plus tard</button>
        </div>
      </section>`
    : '';

  return `<main class="screen" aria-label="Pointer">
    <header class="header">
      <div class="stack-2">
        <span class="muted small">${fmtLongDate(dateKeyOf(t))}</span>
        <h1 class="title">Pointage</h1>
      </div>
      <span class="badge badge-${ctx.kind}">${ctx.label}</span>
    </header>
    ${update}
    ${alert}
    ${sessionCard}
    ${releve}
    <section class="card month-card" aria-label="Mois en cours">
      <div class="row-between">
        <span class="strong">${fmtMonth(month)}</span>
        ${s ? '<span class="muted xsmall">hors session en cours</span>' : ''}
      </div>
      <div class="tiles-plain">
        <div class="stack-2"><span class="label-day">Heures jour</span><span class="big mono">${fmtDuration(totals.dayMin)}</span></div>
        <div class="stack-2"><span class="label-night">Heures nuit</span><span class="big mono">${fmtDuration(totals.nightMin)}</span></div>
      </div>
      <div class="rule"></div>
      <div class="row-between">
        <div class="stack-2"><span class="muted small">Estimation brute</span><span class="muted xsmall">visible uniquement sur ce téléphone</span></div>
        <span class="mono gross">${fmtEuro(gross)}</span>
      </div>
    </section>
    ${backup}
  </main>`;
}

// ---------- Écran Historique ----------

const ANOMALY_LABEL: Record<Anomaly, string> = { overlap: 'chevauchement', long: 'plus de 48 h' };

function releveStatus(lines: readonly DayLine[]): string {
  const sentAt = state.settings.relevesSent[state.month];
  if (sentAt) {
    const changed = state.sessions.some((s) => s.updatedAt > sentAt && lines.some((l) => l.sessionId === s.id));
    return `<p class="status-line">${icons.check}<span>Relevé envoyé le ${fmtLongDate(dateKeyOf(sentAt)).toLowerCase()}${changed ? ' · <span class="warn-text">entrées modifiées depuis</span>' : ''}</span></p>`;
  }
  if (state.month < monthKeyOf(now()) && lines.some((l) => !l.open)) {
    return '<p class="status-line muted">Relevé pas encore envoyé</p>';
  }
  return '';
}

function renderHistorique(): string {
  const lines = monthLines(state.month);
  const totals = sumLines(lines);
  const hc = isHoliday();
  const anomalies = findAnomalies(state.sessions, now());
  const flagged = new Set(lines.filter((l) => anomalies.has(l.sessionId)).map((l) => l.sessionId));
  const byDate = new Map<string, DayLine[]>();
  for (const l of lines) {
    const arr = byDate.get(l.date) ?? [];
    arr.push(l);
    byDate.set(l.date, arr);
  }
  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const list = days.length
    ? days
        .map(([date, ls]) => {
          const wd = weekdayOf(date);
          const tag = hc(date) ? 'Férié' : wd === 0 || wd === 6 ? 'WE' : '';
          return `<article class="card day-card">
            <div class="day-label">
              <span class="day-dow">${DOW_SHORT[wd]}</span>
              <span class="day-num">${parseKey(date).day}</span>
              ${tag ? `<span class="day-tag">${tag}</span>` : ''}
            </div>
            <div class="day-lines">
              ${ls
                .map(
                  (l) => `<button type="button" class="line" data-action="edit" data-id="${l.sessionId}" aria-label="Modifier ou supprimer : ${fmtShortDate(date)} ${l.startLabel}">
                    <span class="line-main">
                      <span class="line-head">
                        <span class="mono strong">${l.startLabel} → ${l.open ? '…' : l.endLabel}</span>
                        ${l.manual ? '<span class="tag">manuelle</span>' : ''}
                        ${l.open ? '<span class="tag tag-live">en cours</span>' : ''}
                        ${(anomalies.get(l.sessionId) ?? []).map((a) => `<span class="tag tag-warn">${ANOMALY_LABEL[a]}</span>`).join('')}
                      </span>
                      ${l.note ? `<span class="muted xsmall line-note">${esc(l.note)}</span>` : ''}
                      <span class="row-6">
                        <span class="chip chip-day mono">J ${fmtDuration(l.dayMin)}</span>
                        <span class="chip chip-night mono">N ${fmtDuration(l.nightMin)}</span>
                      </span>
                    </span>
                    <span class="line-go">${icons.pencil}</span>
                  </button>`,
                )
                .join('')}
            </div>
          </article>`;
        })
        .join('')
    : `<p class="empty muted">Aucune prestation en ${monthName(state.month)}.</p>`;

  const warn = flagged.size
    ? `<section class="banner banner-warn banner-compact" role="note">
        <span class="banner-icon">${icons.alertSmall}</span>
        <span>${flagged.size === 1 ? '1 entrée à vérifier' : `${flagged.size} entrées à vérifier`} avant l'envoi du relevé.</span>
      </section>`
    : '';

  return `<main class="screen screen-history" aria-label="Historique">
    <header class="header">
      <h1 class="title">Historique</h1>
      <button type="button" class="btn btn-outline" data-action="releve" data-month="${state.month}" ${lines.some((l) => !l.open) ? '' : 'disabled'}>${icons.file}<span>Relevé PDF</span></button>
    </header>
    <div class="month-nav">
      <button type="button" class="icon-btn" data-action="month-prev" aria-label="Mois précédent">${icons.chevronLeft}</button>
      <span class="strong">${fmtMonth(state.month)}</span>
      <button type="button" class="icon-btn" data-action="month-next" aria-label="Mois suivant">${icons.chevronRight}</button>
    </div>
    ${tiles(totals.dayMin, totals.nightMin, true)}
    ${releveStatus(lines)}
    ${warn}
    ${days.length ? '<p class="hint">Touche une entrée pour la modifier ou la supprimer.</p>' : ''}
    <div class="day-list">${list}</div>
    <button type="button" class="fab" data-action="add">${icons.plus}<span>Ajouter</span></button>
  </main>`;
}

// ---------- Écran Réglages ----------

function renderReglages(): string {
  const st = state.settings;
  const today = dateKeyOf(now());
  const year = Number(today.slice(0, 4));
  const upcoming = [...legalHolidays(year), ...legalHolidays(year + 1)].filter((h) => h.date >= today).slice(0, 4);
  const extras = [...st.extraHolidays].sort();
  const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
  const years = [...new Set([year, ...state.sessions.map((s) => Number(dateKeyOf(s.start).slice(0, 4)))])].sort((a, b) => b - a);

  return `<main class="screen" aria-label="Réglages">
    <header class="header"><h1 class="title">Réglages</h1></header>

    <section class="section">
      <h2>Relevé</h2>
      <div class="card list-card">
        <label class="field-row">Nom<input type="text" data-field="name" value="${esc(st.name)}" placeholder="Dr Nom Prénom" autocomplete="name"></label>
        <label class="field-row">Fonction<input type="text" data-field="role" value="${esc(st.role)}"></label>
        <label class="field-row">Service<input type="text" data-field="service" value="${esc(st.service)}"></label>
      </div>
    </section>

    <section class="section">
      <h2>Tarifs horaires</h2>
      <div class="card list-card">
        <label class="field-row"><span class="row-8"><span class="swatch swatch-day"></span>Jour · 8h–18h</span>
          <span class="row-4 mono"><input class="input-rate mono" type="text" inputmode="decimal" data-field="rateDay" value="${euros(st.rateDayCents)}">€/h</span></label>
        <label class="field-row"><span class="row-8"><span class="swatch swatch-night"></span>Nuit · WE · fériés</span>
          <span class="row-4 mono"><input class="input-rate mono" type="text" inputmode="decimal" data-field="rateNight" value="${euros(st.rateNightCents)}">€/h</span></label>
      </div>
      <p class="hint">Servent uniquement à l'estimation brute et à l'export comptable. Jamais imprimés sur le relevé, jamais envoyés ailleurs.</p>
    </section>

    <section class="section">
      <h2>Nouvelle entrée</h2>
      <div class="card list-card">
        <label class="field-row">Début par défaut<input type="time" data-field="defaultStart" value="${st.defaultStart}" class="input-boxed mono"></label>
        <label class="field-row">Fin par défaut<input type="time" data-field="defaultEnd" value="${st.defaultEnd}" class="input-boxed mono"></label>
      </div>
      <p class="hint">Pré-remplissent « Ajouter » dans l'historique. Le bouton Démarrer, lui, prend toujours l'heure du moment.</p>
    </section>

    <section class="section">
      <h2>Alerte</h2>
      <div class="card stepper-card">
        <span>Session ouverte<br><span class="muted small">alerte à l'ouverture après</span></span>
        <div class="row-6">
          <button type="button" class="icon-btn bordered" data-action="alert-dec" aria-label="Diminuer">−</button>
          <span class="mono strong stepper-value">${st.alertHours} h</span>
          <button type="button" class="icon-btn bordered" data-action="alert-inc" aria-label="Augmenter">+</button>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Jours fériés</h2>
      <div class="card list-card">
        ${upcoming.map((h) => `<div class="list-row"><span>${h.name}</span><span class="mono muted small">${fmtShortDate(h.date).toLowerCase()}${h.date.slice(0, 4) !== String(year) ? ` ${h.date.slice(0, 4)}` : ''}</span></div>`).join('')}
        ${extras
          .map(
            (d) => `<div class="list-row"><span>Date ajoutée</span><span class="row-8"><span class="mono muted small">${fmtShortDate(d).toLowerCase()} ${d.slice(0, 4)}</span>
              <button type="button" class="icon-btn small-btn" data-action="holiday-del" data-date="${d}" aria-label="Retirer le ${d}">${icons.close}</button></span></div>`,
          )
          .join('')}
        <div class="list-row add-row">
          <input type="date" id="holiday-new" aria-label="Date à ajouter">
          <button type="button" class="btn btn-small" data-action="holiday-add">${icons.plus}<span>Ajouter</span></button>
        </div>
      </div>
      <p class="hint">Les 10 jours fériés légaux belges sont calculés automatiquement chaque année ; seuls les prochains sont affichés.</p>
    </section>

    <section class="section">
      <h2>Export comptable</h2>
      <div class="card stepper-card">
        <label class="row-8">Année
          <select id="export-year" class="input-boxed mono">${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select>
        </label>
        <button type="button" class="btn btn-small" data-action="export-year">${icons.download}<span>CSV</span></button>
      </div>
      <p class="hint">Toutes les prestations terminées de l'année, avec heures et montants bruts, puis un récapitulatif mensuel. S'ouvre dans Numbers ou Excel.</p>
    </section>

    <section class="section">
      <h2>Sauvegarde</h2>
      <div class="grid-2">
        <button type="button" class="btn btn-primary" data-action="export">Exporter</button>
        <button type="button" class="btn btn-outline" data-action="import">Importer</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <p class="hint">${st.lastBackup ? `Dernière sauvegarde : ${fmtLongDate(dateKeyOf(st.lastBackup)).toLowerCase()}.` : 'Aucune sauvegarde pour l’instant.'} Les données ne quittent jamais ce téléphone autrement.</p>
    </section>

    ${
      isStandalone()
        ? ''
        : `<section class="section"><h2>Installation</h2><p class="hint">Pour l'installer : dans Safari, Partager → « Sur l'écran d'accueil ». Utilise ensuite toujours l'icône : Safari et l'app installée ne partagent pas leurs données.</p></section>`
    }
    <p class="hint center">Pointage 000 · v${__APP_VERSION__}</p>
  </main>`;
}

// ---------- Feuille de correction ----------

const TIME_RE = /^\d\d:\d\d$/;

/** Début et fin saisis ; `end` vaut null quand la session reste en cours. */
function editTimes(e: EditState): { start: number; end: number | null } | null {
  if (!e.startDate || !TIME_RE.test(e.startTime)) return null;
  const start = instantOf(e.startDate, e.startTime);
  if (e.keepOpen) return start <= now() ? { start, end: null } : null;
  if (!e.endDate || !TIME_RE.test(e.endTime)) return null;
  const end = instantOf(e.endDate, e.endTime);
  return end > start ? { start, end } : null;
}

function previewHtml(e: EditState): string {
  const t = editTimes(e);
  if (!t) {
    return e.keepOpen
      ? '<p class="muted small">Le début ne peut pas être dans le futur.</p>'
      : '<p class="muted small">La fin doit être après le début.</p>';
  }
  const end = t.end ?? floorToMinute(now());
  const lines = linesForSession({ id: 'p', start: t.start, end, manual: true, note: '' }, isHoliday(), now());
  const sum = sumLines(lines);
  const detail = lines
    .map((l) => `${fmtShortDate(l.date)} ${l.startLabel}–${t.end === null && l === lines.at(-1) ? 'maintenant' : l.endLabel} : jour ${fmtDuration(l.dayMin)}, nuit ${fmtDuration(l.nightMin)}`)
    .join('<br>');
  const long = (end - t.start) / 3_600_000 > 48 ? '<strong class="warn-text">Plus de 48 h : vérifie les dates.</strong><br>' : '';
  return `${tiles(sum.dayMin, sum.nightMin, true)}
    <p class="muted xsmall">${long}${detail}</p>`;
}

function renderEdit(e: EditState): string {
  const existing = e.id !== null;
  const title = !existing ? 'Nouvelle prestation' : e.wasOpen ? (e.keepOpen ? 'Session en cours' : 'Clôturer la session') : 'Modifier la prestation';
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="overlay-top">
      <button type="button" class="back-btn" data-action="edit-cancel">${icons.chevronLeft}<span>Annuler</span></button>
    </div>
    <div class="overlay-body">
      <h1 class="title">${title}</h1>
      ${
        e.wasOpen
          ? `<label class="card toggle-row"><span>Session toujours en cours<br><span class="muted small">ne corriger que l'heure de début</span></span>
              <input type="checkbox" class="switch" data-toggle="keepOpen" ${e.keepOpen ? 'checked' : ''}></label>`
          : ''
      }
      <div class="card list-card">
        <div class="field-row">
          <span>Début</span>
          <span class="row-6">
            <input type="date" data-edit="startDate" value="${e.startDate}" class="input-boxed mono" aria-label="Date de début">
            <input type="time" data-edit="startTime" value="${e.startTime}" class="input-boxed mono" aria-label="Heure de début">
          </span>
        </div>
        ${
          e.keepOpen
            ? ''
            : `<div class="field-row">
                <span>Fin</span>
                <span class="row-6">
                  <input type="date" data-edit="endDate" value="${e.endDate}" class="input-boxed mono" aria-label="Date de fin">
                  <input type="time" data-edit="endTime" value="${e.endTime}" class="input-boxed mono input-strong" aria-label="Heure de fin">
                </span>
              </div>`
        }
      </div>
      <label class="stack-8 strong small">Note (facultative)
        <input type="text" data-edit="note" value="${esc(e.note)}" class="input-note" placeholder="Ex. oubli de pointage">
      </label>
      <section class="card stack-12">
        <span class="muted small strong">Aperçu du calcul</span>
        <div id="edit-preview">${previewHtml(e)}</div>
      </section>
      <p class="info-line">${icons.info}<span>${
        e.keepOpen
          ? 'Seul le début change ; la session continue de tourner.'
          : 'L’entrée sera marquée « manuelle » et signalée par un astérisque sur le relevé.'
      }</span></p>
    </div>
    <div class="overlay-actions">
      <button type="button" class="btn btn-primary btn-lg" data-action="edit-save">Enregistrer</button>
      ${existing ? '<button type="button" class="btn btn-danger-text" data-action="edit-delete">Supprimer cette entrée</button>' : ''}
    </div>
  </div>`;
}

function renderBackupSheet(): string {
  return `<div class="sheet-backdrop" data-action="backup-later">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Sauvegarde" data-stop>
      <h2 class="sheet-title">Faire une sauvegarde ?</h2>
      <p class="muted small">C'est le bon moment : un fichier à ranger dans Fichiers ou iCloud, pour ne rien perdre si le téléphone change.</p>
      <div class="grid-2">
        <button type="button" class="btn btn-outline" data-action="backup-later">Plus tard</button>
        <button type="button" class="btn btn-primary" data-action="export">Exporter</button>
      </div>
    </div>
  </div>`;
}

// ---------- Rendu global ----------

function navButton(tab: Tab, label: string, icon: string): string {
  const active = state.tab === tab;
  return `<button type="button" class="tab ${active ? 'tab-active' : ''}" data-action="tab" data-tab="${tab}" ${active ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
}

function screenLabel(): string {
  return state.tab === 'pointer' ? 'Pointer' : state.tab === 'historique' ? 'Historique' : 'Réglages';
}

function render(): void {
  const screen = state.tab === 'pointer' ? renderPointer() : state.tab === 'historique' ? renderHistorique() : renderReglages();
  const scroller = root.querySelector('.screen');
  const scroll = scroller && scroller.getAttribute('aria-label') === screenLabel() ? scroller.scrollTop : 0;
  const yearSel = root.querySelector<HTMLSelectElement>('#export-year')?.value;
  root.innerHTML = `${screen}
    <nav class="tabbar" aria-label="Navigation principale">
      ${navButton('pointer', 'Pointer', icons.clock)}
      ${navButton('historique', 'Historique', icons.list)}
      ${navButton('reglages', 'Réglages', icons.sliders)}
    </nav>
    ${state.edit ? renderEdit(state.edit) : ''}
    ${state.backupSheet ? renderBackupSheet() : ''}`;
  const next = root.querySelector('.screen');
  if (next && scroll) next.scrollTop = scroll;
  const sel = root.querySelector<HTMLSelectElement>('#export-year');
  if (sel && yearSel) sel.value = yearSel;
}

// ---------- Actions ----------

async function persistSettings(patch: Partial<Settings>): Promise<void> {
  state.settings = { ...state.settings, ...patch };
  await saveSettings(state.settings);
}

async function upsert(s: Session): Promise<void> {
  await saveSession(s);
  const i = state.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) state.sessions[i] = s;
  else state.sessions.push(s);
}

async function drop(id: string): Promise<void> {
  await removeSession(id);
  state.sessions = state.sessions.filter((x) => x.id !== id);
}

/** Remet une session dans son état d'avant (ou la retire si elle n'existait pas). */
function undoTo(previous: Session | null, id: string): () => Promise<void> {
  return async () => {
    if (previous) await upsert(previous);
    else await drop(id);
    render();
    toast('Action annulée.');
  };
}

async function startSession(): Promise<void> {
  if (openSession()) return;
  const t = floorToMinute(now());
  const id = newId();
  await upsert({ id, start: t, end: null, manual: false, note: '', updatedAt: now() });
  await persistSettings({ alertSnoozeUntil: null });
  render();
  toast(`Session démarrée à ${hhmmOf(t)}.`, { label: 'Annuler', run: undoTo(null, id) });
}

async function stopSession(): Promise<void> {
  const s = openSession();
  if (!s) return;
  const before = { ...s };
  const end = floorToMinute(now());
  let message: string;
  if (end <= s.start) {
    await drop(s.id);
    message = 'Session de moins d’une minute : supprimée.';
  } else {
    await upsert({ ...s, end, updatedAt: now() });
    message = `Session terminée : ${fmtDuration(Math.round((end - s.start) / MINUTE))}.`;
  }
  await persistSettings({ alertSnoozeUntil: null });
  render();
  toast(message, { label: 'Annuler', run: undoTo(before, s.id) });
}

function openEdit(id: string | null, closeOpenSession = false): void {
  if (id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    const end = s.end ?? floorToMinute(now());
    state.edit = {
      id,
      startDate: dateKeyOf(s.start),
      startTime: hhmmOf(s.start),
      endDate: dateKeyOf(end),
      endTime: hhmmOf(end),
      note: s.note,
      wasOpen: s.end === null,
      keepOpen: s.end === null && !closeOpenSession,
    };
  } else {
    const today = dateKeyOf(now());
    const date = state.month === monthKeyOf(now()) ? today : `${state.month}-01`;
    const { defaultStart, defaultEnd } = state.settings;
    state.edit = {
      id: null,
      startDate: date,
      startTime: defaultStart,
      endDate: defaultEnd <= defaultStart ? addDays(date, 1) : date,
      endTime: defaultEnd,
      note: '',
      wasOpen: false,
      keepOpen: false,
    };
  }
  render();
}

async function saveEdit(): Promise<void> {
  const e = state.edit;
  if (!e) return;
  const t = editTimes(e);
  if (!t) {
    toast(e.keepOpen ? 'Le début ne peut pas être dans le futur.' : 'La fin doit être après le début.');
    return;
  }
  const until = t.end ?? now();
  const overlap = state.sessions.find((o) => o.id !== e.id && o.start < until && (o.end ?? now()) > t.start);
  if (overlap) {
    const when = `${fmtShortDate(dateKeyOf(overlap.start)).toLowerCase()} à ${hhmmOf(overlap.start)}`;
    if (!confirm(`Cette période chevauche la session du ${when}. Enregistrer quand même ?`)) return;
  }
  const existing = e.id ? state.sessions.find((x) => x.id === e.id) ?? null : null;
  const session: Session = {
    id: existing?.id ?? newId(),
    start: t.start,
    end: t.end,
    manual: true,
    note: e.note.trim(),
    updatedAt: now(),
  };
  await upsert(session);
  if (e.wasOpen && t.end !== null) await persistSettings({ alertSnoozeUntil: null });
  state.edit = null;
  if (state.tab === 'historique') state.month = monthKeyOf(session.start);
  render();
  toast('Enregistré.', { label: 'Annuler', run: undoTo(existing ? { ...existing } : null, session.id) });
}

async function deleteEdit(): Promise<void> {
  const e = state.edit;
  if (!e?.id) return;
  const old = state.sessions.find((x) => x.id === e.id);
  if (!old) return;
  await drop(e.id);
  state.edit = null;
  render();
  toast('Entrée supprimée.', { label: 'Annuler', run: undoTo({ ...old }, old.id) });
}

async function snoozeAlert(): Promise<void> {
  const s = openSession();
  if (!s) return;
  const step = state.settings.alertHours * 3_600_000;
  const periods = Math.floor((now() - s.start) / step) + 1;
  await persistSettings({ alertSnoozeUntil: s.start + periods * step });
  render();
}

async function sendReleve(month: string): Promise<void> {
  // une session encore ouverte n'a pas sa place sur un relevé remis aux RH
  const lines = monthLines(month, closedSessions());
  if (!lines.length) {
    toast('Aucune prestation terminée ce mois-là.');
    return;
  }
  const file = buildReleve(month, lines, state.settings, dateKeyOf(now()));
  const outcome = await shareOrDownload(file);
  if (outcome !== 'cancelled') {
    await persistSettings({ relevesSent: { ...state.settings.relevesSent, [month]: now() } });
    state.backupSheet = true;
    render();
  }
}

async function exportYear(): Promise<void> {
  const year = Number(root.querySelector<HTMLSelectElement>('#export-year')?.value ?? dateKeyOf(now()).slice(0, 4));
  const lines = linesFor(closedSessions(), isHoliday(), now()).filter((l) => l.date.startsWith(`${year}-`));
  if (!lines.length) {
    toast(`Aucune prestation terminée en ${year}.`);
    return;
  }
  const csv = buildYearCsv(year, lines, state.settings);
  await shareOrDownload(new File([csv], `Prestations_${year}.csv`, { type: 'text/csv' }));
}

async function exportBackup(): Promise<void> {
  const data = makeBackup(state.settings, state.sessions);
  const file = new File([JSON.stringify(data, null, 2)], `Pointage_${dateKeyOf(now())}.json`, { type: 'application/json' });
  const outcome = await shareOrDownload(file);
  state.backupSheet = false;
  if (outcome !== 'cancelled') {
    await persistSettings({ lastBackup: now(), backupReminderDismissedAt: null });
    toast('Sauvegarde exportée.');
  }
  render();
}

async function importFile(file: File): Promise<void> {
  try {
    const raw = JSON.parse(await file.text());
    const result = await importBackup(raw, state.sessions);
    state.sessions = await loadSessions();
    if (!state.settings.name && raw?.settings) {
      const { lastBackup, alertSnoozeUntil, backupReminderDismissedAt, ...rest } = raw.settings as Settings;
      void lastBackup; void alertSnoozeUntil; void backupReminderDismissedAt;
      await persistSettings(rest);
    }
    toast(`Import : ${result.added} ajoutée(s), ${result.updated} mise(s) à jour.`);
  } catch (err) {
    toast(err instanceof Error && err.message.startsWith('Ce fichier') ? err.message : 'Fichier illisible.');
  }
  render();
}

function parseRate(value: string): number | null {
  const n = Number(value.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) : null;
}

async function onClick(ev: Event): Promise<void> {
  const target = ev.target as Element;
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el) return;
  // un clic dans la feuille ne doit pas la fermer via le fond
  if (el.classList.contains('sheet-backdrop') && target.closest('[data-stop]')) return;
  switch (el.dataset.action) {
    case 'tab':
      state.tab = el.dataset.tab as Tab;
      render();
      root.querySelector('.screen')?.scrollTo(0, 0);
      break;
    case 'start': return startSession();
    case 'stop': return stopSession();
    case 'fix-open': {
      const s = openSession();
      if (s) openEdit(s.id, true);
      break;
    }
    case 'snooze': return snoozeAlert();
    case 'month-prev': state.month = addMonths(state.month, -1); render(); break;
    case 'month-next': state.month = addMonths(state.month, 1); render(); break;
    case 'add': openEdit(null); break;
    case 'edit': openEdit(el.dataset.id ?? null); break;
    case 'edit-cancel': state.edit = null; render(); break;
    case 'edit-save': return saveEdit();
    case 'edit-delete': return deleteEdit();
    case 'releve': return sendReleve(el.dataset.month ?? state.month);
    case 'dismiss-releve': await persistSettings({ releveReminderDismissed: el.dataset.month ?? null }); render(); break;
    case 'export-year': return exportYear();
    case 'export': return exportBackup();
    case 'import': root.querySelector<HTMLInputElement>('#import-file')?.click(); break;
    case 'backup-later': state.backupSheet = false; render(); break;
    case 'dismiss-backup': await persistSettings({ backupReminderDismissedAt: now() }); render(); break;
    case 'alert-dec':
    case 'alert-inc': {
      const delta = el.dataset.action === 'alert-inc' ? 1 : -1;
      const v = Math.min(24, Math.max(1, state.settings.alertHours + delta));
      await persistSettings({ alertHours: v, alertSnoozeUntil: null });
      render();
      break;
    }
    case 'holiday-add': {
      const v = root.querySelector<HTMLInputElement>('#holiday-new')?.value;
      if (!v) { toast('Choisis une date.'); return; }
      if (!state.settings.extraHolidays.includes(v)) {
        await persistSettings({ extraHolidays: [...state.settings.extraHolidays, v].sort() });
        toast('Date ajoutée : tarif nuit toute la journée.');
      }
      render();
      break;
    }
    case 'holiday-del':
      await persistSettings({ extraHolidays: state.settings.extraHolidays.filter((d) => d !== el.dataset.date) });
      render();
      break;
    case 'apply-update': state.updateReady?.(); break;
  }
}

async function onChange(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  if (input.id === 'import-file' && input.files?.[0]) {
    await importFile(input.files[0]);
    return;
  }
  if (input.dataset.toggle === 'keepOpen' && state.edit) {
    state.edit.keepOpen = input.checked;
    if (!input.checked) {
      const t = floorToMinute(now());
      state.edit.endDate = dateKeyOf(t);
      state.edit.endTime = hhmmOf(t);
    }
    render();
    return;
  }
  const field = input.dataset.field;
  if (!field) return;
  if (field === 'rateDay' || field === 'rateNight') {
    const cents = parseRate(input.value);
    if (cents === null) {
      toast('Montant invalide.');
      render();
      return;
    }
    await persistSettings(field === 'rateDay' ? { rateDayCents: cents } : { rateNightCents: cents });
  } else if (field === 'defaultStart' || field === 'defaultEnd') {
    if (TIME_RE.test(input.value)) await persistSettings({ [field]: input.value });
  } else if (field === 'name' || field === 'role' || field === 'service') {
    await persistSettings({ [field]: input.value.trim() });
  }
}

function onInput(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const key = input.dataset.edit as 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'note' | undefined;
  if (!key || !state.edit) return;
  const e = state.edit;
  // changer la date de début déplace la date de fin d'autant de jours
  if (key === 'startDate' && input.value && e.startDate && !e.keepOpen) {
    const shift = Math.round((Date.parse(input.value) - Date.parse(e.startDate)) / DAY);
    if (shift && e.endDate) {
      e.endDate = addDays(e.endDate, shift);
      const endInput = root.querySelector<HTMLInputElement>('[data-edit="endDate"]');
      if (endInput) endInput.value = e.endDate;
    }
  }
  e[key] = input.value;
  const preview = root.querySelector('#edit-preview');
  if (preview) preview.innerHTML = previewHtml(e);
}

// ---------- Démarrage ----------

export async function startApp(el: HTMLElement): Promise<void> {
  root = el;
  const [sessions, settings] = await Promise.all([loadSessions(), loadSettings()]);
  state = {
    sessions,
    settings,
    tab: 'pointer',
    month: monthKeyOf(Date.now()),
    edit: null,
    backupSheet: false,
    updateReady: null,
  };
  root.addEventListener('click', (e) => void onClick(e));
  root.addEventListener('change', (e) => void onChange(e));
  root.addEventListener('input', onInput);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.edit) render();
  });
  // le chrono avance à la minute : un rafraîchissement toutes les 15 s suffit
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.tab === 'pointer' && !state.edit && openSession()) render();
  }, 15_000);
  render();
  void requestPersistence();
}

export function notifyUpdateReady(apply: () => void): void {
  if (!state) return;
  state.updateReady = apply;
  if (!state.edit) render();
}
