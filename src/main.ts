import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { notifyUpdateReady, startApp } from './ui/app';

const root = document.getElementById('app')!;

startApp(root).catch((err) => {
  console.error(err);
  root.innerHTML = `<main class="screen"><h1 class="title">Pointage</h1>
    <p>Impossible d'ouvrir le stockage local. Vérifie que la navigation privée est désactivée, puis relance l'app.</p></main>`;
});

// Mise à jour : la nouvelle version attend que l'utilisateur la confirme,
// pour ne jamais recharger l'app au milieu d'une correction.
const updateSW = registerSW({
  onNeedRefresh() {
    notifyUpdateReady(() => void updateSW(true));
  },
  // Les téléphones laissent l'app en arrière-plan pendant des jours : on vérifie
  // s'il existe une nouvelle version à chaque retour au premier plan, et toutes les heures.
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 60 * 60 * 1000);
  },
});
