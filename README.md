# Pointage 000

Web app installable sur iPhone (et Android) pour compter les heures de travail sur place, séparées en **tarif jour** (lun–ven, 8h–18h, hors jours fériés) et **tarif nuit** (18h–8h, week-ends, jours fériés), et produire un relevé mensuel en PDF pour les RH.

- Aucune donnée ne quitte le téléphone : tout est stocké localement (IndexedDB).
- Aucun serveur : GitHub Pages ne sert qu'à distribuer le code.
- Fonctionne hors ligne une fois installée.

## Mise en ligne (une seule fois)

1. Créer un dépôt **public** nommé `pointage` sur GitHub.
2. Pousser ce dossier sur la branche `main` :
   ```bash
   git init
   git add .
   git commit -m "Pointage 000"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/pointage.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
4. L'onglet **Actions** lance les tests, construit l'app et la publie. Au bout d'une minute ou deux, elle est disponible à `https://<ton-pseudo>.github.io/pointage/`.

Chaque `git push` sur `main` republie l'app. Les téléphones vérifient s'il existe une nouvelle version à chaque ouverture ou retour au premier plan, la téléchargent en arrière-plan et proposent « Mettre à jour » sur l'écran Pointer.

> L'adresse est définitive : les données d'un téléphone sont liées à elle. En cas de changement d'adresse, passer par Exporter / Importer.

## Installation sur le téléphone

**iPhone**

1. Ouvrir l'adresse dans **Safari**.
2. Partager → **Sur l'écran d'accueil**.
3. Toujours utiliser l'icône ensuite : sur iPhone, Safari et l'app installée ne partagent pas leurs données.

**Android**

1. Ouvrir l'adresse dans **Chrome** (Samsung Internet fonctionne aussi).
2. Toucher **Installer l'app** dans le bandeau de l'écran Pointer, ou menu ⋮ → **Installer l'application**.
3. L'app apparaît dans le tiroir d'applications. Chrome et l'app installée partagent les mêmes données.

Dans les deux cas, renseigner ensuite le nom dans Réglages (il apparaît sur le relevé).

Sur Android, le relevé se partage vers Gmail, Outlook ou toute autre app de mail ; le Raccourci ci-dessous est propre à l'iPhone. La sauvegarde JSON est enregistrée dans Téléchargements, d'où elle peut être réimportée.

## Relevé mensuel (état d'honoraires CSPO)

Historique → **Relevé** → **PDF** ou **Excel**. Les deux reprennent le modèle de la Clinique Saint-Pierre :

- une ligne par jour du mois, du 1er au dernier ; week-ends et jours fériés grisés ;
- deux plages par jour : une journée continue est coupée à 12h (« matin » jusqu'à midi, « après-midi » ensuite) ; avec une pause de midi, la plage d'avant la pause va le matin et celle d'après l'après-midi ; une prestation de plus dans la journée (fin de garde à 2h, puis journée) ajoute une ligne à la même date ;
- totaux jour et nuit en heures décimales (9,25 h = 9 h 15), case Astreinte, cadre « Cachet et signature » ;
- une garde à cheval sur deux mois est coupée à minuit : chaque relevé ne compte que ses propres jours.

Le relevé ne contient jamais de montant. À envoyer à DirMed_Prestations_indep@cspo.be début du mois qui suit les prestations.

## Pause de midi et astreinte

- **Pause** (pendant une session) termine la plage du matin ; **Reprendre** ouvre celle de l'après-midi. La pause n'est pas comptée.
- **Astreinte ce soir** (écran Pointer) coche la case Astreinte du jour ; pour une autre date, l'interrupteur **Soir d'astreinte** dans la modification d'une entrée, ou Historique → Ajouter → **Astreinte** pour un jour sans prestation. Un rappel sur place se pointe normalement. Un forfait par soir peut être indiqué dans Réglages pour l'estimation brute (0 par défaut).

## Moyenne par semaine

L'écran Pointer affiche la moyenne d'heures par semaine **du mois en cours** (du 1er à aujourd'hui) et **générale** (depuis le premier jour pointé) ; l'historique affiche celle du mois consulté. Calcul : heures de la période ÷ jours écoulés × 7. Les jours sans prestation (congés, récupération) comptent, c'est donc la moyenne réelle sur la période. La session en cours est incluse.

Dans l'historique, les jours sont regroupés par **semaine ISO** (du lundi au dimanche). Chaque séparation indique le numéro de semaine, ses dates et le **total d'heures de la semaine complète** (jour / nuit), y compris pour une semaine à cheval sur deux mois. Un seuil facultatif (Réglages → Alerte → Semaine chargée, de 40 à 80 h) signale les semaines qui le dépassent.

## Raccourci iOS facultatif « Relevé → CSPO »

Pour envoyer le relevé à son adresse professionnelle en un tap depuis la feuille de partage :

1. App **Raccourcis** → nouveau raccourci, nommé « Relevé → CSPO ».
2. Dans les détails du raccourci, activer **Afficher dans la feuille de partage**, types acceptés : **Fichiers / PDF**.
3. Ajouter l'action **Envoyer un e-mail** : destinataire = DirMed_Prestations_indep@cspo.be (ou sa propre adresse CSPO pour imprimer au bureau), objet « État d'honoraires », pièce jointe = **Entrée du raccourci**.
4. Dans cette action, désactiver **Afficher lors de l'exécution** pour un envoi direct (l'app Mail doit être configurée).

Le raccourci peut ensuite être partagé aux collègues par lien iCloud ; chacun y met sa propre adresse à l'installation.

## Développement

```bash
npm install
npm run dev      # serveur local
npm test         # tests du découpage jour/nuit et des jours fériés
npm run build    # version de production dans dist/
```

Structure :

| Dossier | Contenu |
| --- | --- |
| `src/core/` | fonctions pures : fuseau de Bruxelles, jours fériés (calcul de Pâques), découpage jour/nuit, mise en forme ; tests dans `core.test.ts` |
| `src/data/` | stockage IndexedDB, sauvegarde et import (fusion par identifiant) |
| `src/ui/` | les écrans et la feuille de correction |
| `src/core/releve.ts` | lignes du relevé CSPO : plages matin / après-midi, heures décimales, astreintes ; tests dans `releve.test.ts` |
| `src/core/stats.ts` | moyennes d'heures par semaine ; tests dans `stats.test.ts` |
| `src/pdf.ts` | relevé A4 au format CSPO (jsPDF) |
| `src/xlsx.ts` | relevé Excel au format CSPO (exceljs, chargé au premier export) |
| `src/share.ts` | feuille de partage, ou téléchargement à défaut |

Le principe : seules les sessions brutes (début, fin) sont stockées ; les lignes par jour, les totaux et l'estimation sont recalculés à l'affichage. Toutes les heures sont interprétées en heure de Bruxelles, quel que soit le fuseau du téléphone, et les nuits de changement d'heure comptent leur durée réelle.
