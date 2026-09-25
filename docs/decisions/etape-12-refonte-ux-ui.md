# Étape 12 — Refonte UX/UI de l'application publique

- **Date de décision** : 2026-09-25
- **Décideur** : Nicolas
- **Branche** : `ux/refonte` ; rien ne rejoint `main` avant le go/no-go
- **Remplace** : la direction visuelle de l'[étape 11](./etape-11-refonte-visuelle.md) (maquette V2 pastel) pour l'application publique

## Contexte

Après la brocante du 20 septembre, l'application fonctionne mais son usage reste laborieux :

- l'onboarding général passe inaperçu ;
- les parcours visiteur sont flous ;
- la charte, avec quatre familles pastel et un serif fin, est chargée et peu lisible au soleil ;
- le mode série vendeur n'enchaîne pas les photos, la relecture impose aperçu, puis « Valider », puis « Publier tout », et un brouillon ne peut pas être supprimé ;
- les catégories du marché sont cachées dans un défilement horizontal, et rien n'explique pourquoi telles annonces s'affichent ;
- dans J'analyse, on ne comprend ni les trois questions ni le champ prix ;
- la carte FunLab n'explique pas le jeu.

L'objectif : une application cohérente, douce mais lisible en plein jour, compréhensible par quelqu'un qui n'a jamais utilisé d'application de brocante.

## Périmètre

- **Dedans** : bienvenue, accueil visiteur et vendeur, marché et fiche, J'analyse, espace vendeur (onboarding, série, tableau de bord, modification), FunLab.
- **Dehors, non modifiés** : Admin/monitoring, page ops (`ops/`), Showroom. Ils gardent l'ancienne feuille (`frontend/src/legacy.css`), chargée seulement avec leurs chunks (`src/legacy/*Entry.tsx`, en `React.lazy`). Le rendu a été comparé au pixel près avec `main` : identique, hors données dynamiques.
- **Backend** : une seule exception, `DELETE /api/seller/drafts/{image_key}` (voir plus bas).

## Charte « Papier & étiquette »

Les codes d'un vide-grenier : étiquettes de prix lisibles à 3 m, carton kraft, marquage des emplacements, grandes lettres sans empattement, couleurs franches et **pas de pastel** (mauvaise lecture à distance et au soleil).

| Token | Valeur | Usage | Contraste mesuré |
|---|---|---|---|
| `--paper` | `#fbf7ef` | fond | — |
| `--card` / `--kraft` | `#ffffff` / `#f1e7d3` | cartes / blocs secondaires, badge stand | — |
| `--ink` | `#1d1b18` | texte | 16,1:1 sur papier |
| `--ink-soft` | `#4a4640` | texte secondaire | 8,8:1 |
| `--muted` | `#55504a` | métadonnées | 7,5:1 |
| `--tag` | `#b23a24` | action principale, étiquette de prix | blanc dessus 6,0:1 |
| `--pine` | `#2f5d46` | en vente, succès | blanc dessus 7,6:1 |
| `--line-strong` | `#948a78` | bordure des champs | 3,4:1 (WCAG 1.4.11) |

- **Typographie** : Source Sans 3 partout ; Fraunces uniquement dans le logo. Corps à 17 px, jamais moins de 15 px, tailles en `rem`.
- **Cibles tactiles** ≥ 48 px ; focus visible par un contour encre de 3 px.
- **Composants signature** :
  - `PriceTag` : étiquette tomate avec œillet ;
  - `StandBadge` : cadre kraft bordé d'encre, en pointillés sur la fiche, façon marquage d'emplacement.
- **Icônes** : un jeu SVG unique (`src/ui/icons.tsx`), plus aucun emoji fonctionnel.
- **Pas de mode sombre** : usage en extérieur.
- **Audit** : axe-core (WCAG 2.2 AA), aucune violation sur les écrans publics.

## Décisions de parcours

| Sujet | Décision |
|---|---|
| Onboarding | Une seule question plein écran : « Je viens chiner » ou « Je tiens un stand » (ou « Passer ») ; puis des aides d'une ligne à la première utilisation (`brocai-tips-v1`) |
| Ton | Vouvoiement partout, tutoiement dans FunLab |
| Navigation | Barre d'onglets Accueil · Chercher · Analyser · Vendre (« Mon stand » après l'onboarding) ; chaque écran a son URL, le bouton retour du téléphone reste dans l'application |
| Routes | `/`, `/objets` (`?q=`, `?rayon=`, `?tout=1`), `/objets/:id`, `/analyser`, `/stand`, `/stand/serie` (`?camera=1`), `/stand/annonce/:id`, `/fun` |
| Accueil visiteur | Recherche, grille des rayons, « Tout juste déballé », carte J'analyse, carte FunLab, « Vous vendez ? » |
| Marché | Grille des rayons avec icônes et compteurs, rayons vides masqués ; puces de filtres retirables ; chaque section dit son tri ; fraîcheur (« il y a 12 min ») sur chaque carte |
| Photos vendeur | Caméra intégrée (`getUserMedia`) en rafale, avec vignettes, galerie et « Terminer » ; repli automatique sur la caméra du téléphone (API absente, permission refusée ou caméra qui ne s'ouvre pas en 6 s) |
| Analyse | L'étape « Analyser mes N photos » est conservée ; on peut ajouter des photos à une série déjà lancée |
| Relecture | Liste de brouillons éditables sur place, puis « Publier les N annonces prêtes » ; plus d'aperçu ni de validation ; badge « À vérifier » si la confiance est faible ou si l'analyse automatique est indisponible |
| Suppression | Toast « supprimé · Annuler » pendant 5 s, puis suppression de la photo côté serveur |
| Vendu | « Marquer vendu » agit tout de suite, avec un toast « Annuler » pendant 5 s |
| J'analyse | « Posez jusqu'à 3 questions » ; chaque question annonce ce qu'elle renvoie ; le prix du stand est explicitement rattaché à « Bon prix ? » et « Négocier », les deux réponses qui l'utilisent (`_cached_assistant_answer`) |
| FunLab | Illustration + promesse ; la mécanique « 1 photo → 3 vœux parmi 5 → cartes à garder » est expliquée en trois étapes |
| Événement | `EVENT_NAME` / `EVENT_DATE` dans `frontend/src/event.ts`, **à mettre à jour avant chaque déploiement** |

## Exception backend

`DELETE /api/seller/drafts/{image_key}` libère la photo d'un brouillon supprimé :

- clé strictement validée (`<32 hex>.<ext>`), sinon 400 ;
- 409 si une annonce utilise la photo ;
- idempotent : une photo absente renvoie aussi 204 ;
- émet l'événement serveur `seller_draft_deleted`.

Tests : `backend/tests/test_seller_drafts.py`.

## Analytics

L'allowlist client n'est pas modifiée ; tous les événements existants sont conservés. Les nouvelles interactions passent par `feature_clicked` :

- `welcome_role`, `home_search`, `home_category`, `tab_bar` ;
- `camera` (opened, fallback, denied, captured, done) ;
- `seller_draft` (deleted, undone), `listing_sold` (undone), `tip` (dismissed).

**Changement de sens** : `onboarding_marketplace_clicked` est émis sur « Je viens chiner », qui mène à l'accueil visiteur et non plus directement au marché. L'étape « Marché choisi depuis l'accueil » des parcours admin ne mesure donc plus exactement la même chose qu'au 20/09.

## Dette connue

- L'endpoint de suppression ne vérifie pas les jobs IA en cours ; l'interface interdit la suppression pendant l'analyse.
- Une photo supprimée dont le toast n'a pas expiré (page fermée brutalement) peut rester sur le serveur ; elle disparaît avec la réinitialisation de l'événement.
- La caméra intégrée exige HTTPS (c'est le cas derrière Cloudflare) et reste à valider sur iPhone et Android réels.
- Le verrou de stand reste local à l'appareil (inchangé depuis l'étape 11).

## Go/no-go

Sur iPhone Safari et Android Chrome, en HTTPS, sur un déploiement de prévisualisation :

1. première visite en visiteur : recherche, rayon, fiche, bouton retour ;
2. vendeur : onboarding, rafale de 5 photos, repli si la permission est refusée, analyse, modification, suppression + annulation, publication, visibilité depuis un autre appareil, vendu + annulation ;
3. J'analyse avec prix du stand, 3 questions ;
4. FunLab : un vœu ;
5. backend coupé : messages lisibles, reprise ;
6. lecture en plein soleil, luminosité maximale.

**No-go** si 1, 2 ou 5 échoue. La checklist sera publiée en artifact partagé pour les testeurs.

## Résultat du go/no-go (25/09, soir)

- Déployé en production le 25/09 (`70e2956`, PR #27), décision **GO** de Nicolas. iPhone : 6 scénarios sur 6 OK ; Android non coché.
- Deux remarques non bloquantes, corrigées ensuite :
  - un bouton `Retour` dans la page sur le marché, J'analyse, FunLab et Mon stand (il suit l'historique, avec l'accueil comme repli) ;
  - la caméra ouverte depuis l'accueil ou le stand empile désormais l'écran de série sous elle : `Terminer` ramène aux photos prises au lieu du stand (`openSeriesCamera`).
