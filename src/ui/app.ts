// Interface : trois onglets (Pointer, Historique, Réglages), la feuille de correction et les bandeaux.
// Rendu par chaînes HTML et délégation d'événements, sans framework.

import { fmtClock, fmtDuration, fmtEuro, fmtLongDate, fmtMonth, fmtShortDate, DOW_SHORT } from '../core/format';
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
  date: string;
  startTime: string;
  endTime: string;
  note: string;
  wasOpen: boolean;
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

function monthLines(monthKey: string, sessions: readonly Session[] = state.sessions): DayLine[] {
  return linesFor(sessions, isHoliday(), now()).filter((l) => l.date.startsWith(monthKey));
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function toast(message: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.classList.add('toast-out'), 2600);
  setTimeout(() => el.remove(), 3000);
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

function renderPointer(): string {
  const t = now();
  const s = openSession();
  const ctx = rateContext(t);
  const month = monthKeyOf(t);
  const closed = state.sessions.filter((x) => x.end !== null);
  const totals = sumLines(monthLines(month, closed));
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
        <span class="muted push">${sinceLabel(s.start)}</span>
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

function renderHistorique(): string {
  const lines = monthLines(state.month);
  const totals = sumLines(lines);
  const hc = isHoliday();
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
                  (l) => `<button type="button" class="line" data-action="edit" data-id="${l.sessionId}" aria-label="Modifier ${fmtShortDate(date)} ${l.startLabel}">
                    <span class="line-head">
                      <span class="mono strong">${l.startLabel} → ${l.open ? '…' : l.endLabel}</span>
                      ${l.manual ? '<span class="tag">manuelle</span>' : ''}
                      ${l.open ? '<span class="tag tag-live">en cours</span>' : ''}
                    </span>
                    ${l.note ? `<span class="muted xsmall line-note">${esc(l.note)}</span>` : ''}
                    <span class="row-6">
                      <span class="chip chip-day mono">J ${fmtDuration(l.dayMin)}</span>
                      <span class="chip chip-night mono">N ${fmtDuration(l.nightMin)}</span>
                    </span>
                  </button>`,
                )
                .join('')}
            </div>
          </article>`;
        })
        .join('')
    : `<p class="empty muted">Aucune prestation en ${fmtMonth(state.month).toLowerCase()}.</p>`;

  return `<main class="screen screen-history" aria-label="Historique">
    <header class="header">
      <h1 class="title">Historique</h1>
      <button type="button" class="btn btn-outline" data-action="releve" ${lines.length ? '' : 'disabled'}>${icons.file}<span>Relevé PDF</span></button>
    </header>
    <div class="month-nav">
      <button type="button" class="icon-btn" data-action="month-prev" aria-label="Mois précédent">${icons.chevronLeft}</button>
      <span class="strong">${fmtMonth(state.month)}</span>
      <button type="button" class="icon-btn" data-action="month-next" aria-label="Mois suivant">${icons.chevronRight}</button>
    </div>
    ${tiles(totals.dayMin, totals.nightMin, true)}
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
      <p class="hint">Servent uniquement à l'estimation brute. Jamais imprimés sur le relevé, jamais envoyés ailleurs.</p>
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

function editTimes(e: EditState): { start: number; end: number; nextDay: boolean } | null {
  if (!e.date || !/^\d\d:\d\d$/.test(e.startTime) || !/^\d\d:\d\d$/.test(e.endTime)) return null;
  if (e.startTime === e.endTime) return null;
  const nextDay = e.endTime < e.startTime;
  const start = instantOf(e.date, e.startTime);
  const end = instantOf(nextDay ? addDays(e.date, 1) : e.date, e.endTime);
  return end > start ? { start, end, nextDay } : null;
}

function previewHtml(e: EditState): string {
  const t = editTimes(e);
  if (!t) return '<p class="muted small">Indique une heure de fin différente de l’heure de début.</p>';
  const lines = linesForSession({ id: 'p', start: t.start, end: t.end, manual: true, note: '' }, isHoliday(), now());
  const sum = sumLines(lines);
  const detail = lines
    .map((l) => `${fmtShortDate(l.date)} ${l.startLabel}–${l.endLabel} : jour ${fmtDuration(l.dayMin)}, nuit ${fmtDuration(l.nightMin)}`)
    .join('<br>');
  return `${tiles(sum.dayMin, sum.nightMin, true)}
    <p class="muted xsmall">${t.nextDay ? '<strong>Fin le lendemain.</strong><br>' : ''}${detail}</p>`;
}

function renderEdit(e: EditState): string {
  const existing = e.id !== null;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${existing ? 'Modifier la prestation' : 'Nouvelle prestation'}">
    <div class="overlay-top">
      <button type="button" class="back-btn" data-action="edit-cancel">${icons.chevronLeft}<span>Annuler</span></button>
    </div>
    <div class="overlay-body">
      <div class="stack-4">
        <h1 class="title">${existing ? (e.wasOpen ? 'Clôturer la session' : 'Modifier la prestation') : 'Nouvelle prestation'}</h1>
        <span class="muted small">${e.date ? fmtLongDate(e.date) : ''}</span>
      </div>
      <div class="card list-card">
        <label class="field-row">Date<input type="date" data-edit="date" value="${e.date}" class="input-boxed mono"></label>
        <label class="field-row">Début<input type="time" data-edit="startTime" value="${e.startTime}" class="input-boxed mono"></label>
        <label class="field-row">Fin<input type="time" data-edit="endTime" value="${e.endTime}" class="input-boxed mono input-strong"></label>
      </div>
      <label class="stack-8 strong small">Note (facultative)
        <input type="text" data-edit="note" value="${esc(e.note)}" class="input-note" placeholder="Ex. oubli de pointage">
      </label>
      <section class="card stack-12">
        <span class="muted small strong">Aperçu du calcul</span>
        <div id="edit-preview">${previewHtml(e)}</div>
      </section>
      <p class="info-line">${icons.info}<span>L'entrée sera marquée « manuelle » et signalée par un astérisque sur le relevé.</span></p>
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

function render(): void {
  const screen = state.tab === 'pointer' ? renderPointer() : state.tab === 'historique' ? renderHistorique() : renderReglages();
  const scroller = root.querySelector('.screen');
  const scroll = scroller && scroller.getAttribute('aria-label') === screenLabel() ? scroller.scrollTop : 0;
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
}

function screenLabel(): string {
  return state.tab === 'pointer' ? 'Pointer' : state.tab === 'historique' ? 'Historique' : 'Réglages';
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

async function startSession(): Promise<void> {
  if (openSession()) return;
  const t = floorToMinute(now());
  await upsert({ id: newId(), start: t, end: null, manual: false, note: '', updatedAt: now() });
  await persistSettings({ alertSnoozeUntil: null });
  render();
}

async function stopSession(): Promise<void> {
  const s = openSession();
  if (!s) return;
  const end = floorToMinute(now());
  if (end <= s.start) {
    await removeSession(s.id);
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    toast('Session de moins d’une minute : supprimée.');
  } else {
    await upsert({ ...s, end, updatedAt: now() });
    toast(`Session terminée : ${fmtDuration(Math.round((end - s.start) / MINUTE))}.`);
  }
  await persistSettings({ alertSnoozeUntil: null });
  render();
}

function openEdit(id: string | null): void {
  if (id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    state.edit = {
      id,
      date: dateKeyOf(s.start),
      startTime: hhmmOf(s.start),
      endTime: hhmmOf(s.end ?? floorToMinute(now())),
      note: s.note,
      wasOpen: s.end === null,
    };
  } else {
    const today = dateKeyOf(now());
    const date = state.month === monthKeyOf(now()) ? today : `${state.month}-01`;
    state.edit = { id: null, date, startTime: '08:00', endTime: '18:00', note: '', wasOpen: false };
  }
  render();
}

async function saveEdit(): Promise<void> {
  const e = state.edit;
  if (!e) return;
  const t = editTimes(e);
  if (!t) {
    toast('Vérifie la date et les heures.');
    return;
  }
  const overlap = state.sessions.find((o) => o.id !== e.id && o.start < t.end && (o.end ?? now()) > t.start);
  if (overlap) {
    const when = `${fmtShortDate(dateKeyOf(overlap.start)).toLowerCase()} à ${hhmmOf(overlap.start)}`;
    if (!confirm(`Cette période chevauche la session du ${when}. Enregistrer quand même ?`)) return;
  }
  const existing = e.id ? state.sessions.find((x) => x.id === e.id) : undefined;
  const session: Session = {
    id: existing?.id ?? newId(),
    start: t.start,
    end: t.end,
    manual: true,
    note: e.note.trim(),
    updatedAt: now(),
  };
  await upsert(session);
  if (e.wasOpen) await persistSettings({ alertSnoozeUntil: null });
  state.edit = null;
  const m = monthKeyOf(session.start);
  if (state.tab === 'historique') state.month = m;
  toast('Enregistré.');
  render();
}

async function deleteEdit(): Promise<void> {
  const e = state.edit;
  if (!e?.id || !confirm('Supprimer cette entrée ?')) return;
  await removeSession(e.id);
  state.sessions = state.sessions.filter((x) => x.id !== e.id);
  state.edit = null;
  toast('Entrée supprimée.');
  render();
}

async function snoozeAlert(): Promise<void> {
  const s = openSession();
  if (!s) return;
  const step = state.settings.alertHours * 3_600_000;
  const periods = Math.floor((now() - s.start) / step) + 1;
  await persistSettings({ alertSnoozeUntil: s.start + periods * step });
  render();
}

async function sendReleve(): Promise<void> {
  // une session encore ouverte n'a pas sa place sur un relevé remis aux RH
  const lines = monthLines(state.month, state.sessions.filter((s) => s.end !== null));
  if (!lines.length) {
    toast('Aucune prestation terminée ce mois-ci.');
    return;
  }
  const file = buildReleve(state.month, lines, state.settings, dateKeyOf(now()));
  const outcome = await shareOrDownload(file);
  if (outcome !== 'cancelled') {
    state.backupSheet = true;
    render();
  }
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
      if (state.tab === 'historique' && !state.month) state.month = monthKeyOf(now());
      render();
      root.querySelector('.screen')?.scrollTo(0, 0);
      break;
    case 'start': return startSession();
    case 'stop': return stopSession();
    case 'fix-open': {
      const s = openSession();
      if (s) openEdit(s.id);
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
    case 'releve': return sendReleve();
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
      const input = root.querySelector<HTMLInputElement>('#holiday-new');
      const v = input?.value;
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
  } else if (field === 'name' || field === 'role' || field === 'service') {
    await persistSettings({ [field]: input.value.trim() });
  }
}

function onInput(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const key = input.dataset.edit as keyof EditState | undefined;
  if (!key || !state.edit) return;
  (state.edit as unknown as Record<string, string>)[key] = input.value;
  const preview = root.querySelector('#edit-preview');
  if (preview) preview.innerHTML = previewHtml(state.edit);
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
