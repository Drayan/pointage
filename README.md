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

## Raccourci iOS facultatif « Relevé → CSPO »

Pour envoyer le relevé à son adresse professionnelle en un tap depuis la feuille de partage :

1. App **Raccourcis** → nouveau raccourci, nommé « Relevé → CSPO ».
2. Dans les détails du raccourci, activer **Afficher dans la feuille de partage**, types acceptés : **Fichiers / PDF**.
3. Ajouter l'action **Envoyer un e-mail** : destinataire = l'adresse CSPO, objet « Relevé de prestations », pièce jointe = **Entrée du raccourci**.
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
| `src/pdf.ts` | génération du relevé A4 (jsPDF) |
| `src/share.ts` | feuille de partage, ou téléchargement à défaut |

Le principe : seules les sessions brutes (début, fin) sont stockées ; les lignes par jour, les totaux et l'estimation sont recalculés à l'affichage. Toutes les heures sont interprétées en heure de Bruxelles, quel que soit le fuseau du téléphone, et les nuits de changement d'heure comptent leur durée réelle.
