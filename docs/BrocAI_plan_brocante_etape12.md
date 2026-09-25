# BrocAI — Plan d'amélioration pour la brocante

Objectif : améliorer l'usage réel de BrocAI pour la prochaine brocante sans révolutionner l'architecture, en priorisant l'activation visiteur, la réduction de friction côté vendeur et une instrumentation plus fiable des parcours.

## Vue d'ensemble

| Étape | Objectif | Modifications prévues | Priorité | Risque | Mode Plan Codex ? |
|---|---|---|---:|---:|---|
| **P0 — Base propre** | Partir de l'étape 11 réellement opérationnelle | Vérifier `main`, déployer sur VPS, smoke test mobile, tester accueil, vendeur, marketplace, analyse, FunLab | 🔴 Critique | Faible | **Non** — exécution/validation simple |
| **P1 — Onboarding application** | Faire comprendre BrocAI dès la première ouverture | Écran d'accueil initial léger, affiché une seule fois par téléphone ; expliquer marketplace, localisation par stand et analyse photo ; CTA principal vers les objets ; lien secondaire vendeur | 🔴 Très haute | Faible | **Oui, léger** — utile pour cadrer stockage local, navigation et non-régression du seller onboarding |
| **P2 — Home orienté visiteur** | Faire du visiteur autonome l'utilisateur par défaut | Réorganiser le home : marketplace principale, analyse ensuite, FunLab secondaire, vendeur moins dominant ; si un stand est déjà mémorisé, adapter automatiquement le home au contexte vendeur | 🔴 Très haute | Faible/modéré | **Oui** — logique conditionnelle + plusieurs états UI |
| **P3 — Marketplace brocante** | Passer du “Leboncoin miniature” à un outil pour chiner physiquement | Revoir wording, mettre numéro de stand très visible, accentuer « trouvez l'objet puis retrouvez le vendeur » | 🔴 Très haute | Faible | **Non** si seulement UI/copy ; **Oui** si la refonte touche plusieurs composants |
| **P4 — Navigation par catégories** | Éviter le mur de 100–200 annonces | Catégories visibles, compteur par catégorie si simple, affichage plus structuré, conservation de la photo comme élément principal, prix + stand visibles immédiatement | 🔴 Très haute | Modéré | **Oui** — vérifier modèle de données, filtres, API et comportement de recherche |
| **P5 — Flux marketplace** | Ne plus jeter l'utilisateur dans toutes les annonces | Vue initiale type « derniers objets publiés », catégories accessibles immédiatement, possibilité de voir tout le catalogue | 🟠 Haute | Faible/modéré | **Oui**, avec P4 idéalement dans le même plan |
| **P6 — Recherche / zéro résultat** | Éviter les impasses | État vide propre, « Effacer les filtres », « Voir tous les objets », vérifier les incohérences de catégories existantes | 🟠 Haute | Faible | **Non** — patch localisé |
| **P7 — Mode série vendeur** | Réduire fortement la friction de publication | Jusqu'à ~10 photos successives, miniatures, bouton « Analyser mes X objets », création de plusieurs jobs via la queue existante, progression, vérification puis publication multiple | 🔴 Très haute | **Modéré/élevé** | **Oui, clairement** — c'est l'étape qui mérite le plus un vrai Plan Codex |
| **P8 — Gestion simple des lots** | Autoriser plusieurs objets vendus ensemble | Une photo de plusieurs objets peut produire une seule annonce de type lot ; pas de nouvelle entité métier `lot` | 🟠 Moyenne | Faible/modéré | **Non** si c'est seulement prompt + UX ; **Oui** si Codex découvre qu'il faut toucher au modèle |
| **P9 — FunLab** | Rendre le bonus compréhensible sans le refaire | Repositionner comme section secondaire « Pour s'amuser », conserver FunLab mais ajouter une promesse explicite du type « Fais parler ton objet » | 🟢 Moyenne | Très faible | **Non** |
| **P10 — Instrumentation parcours** | Mesurer enfin les vrais usages visiteurs et vendeurs | Événements onboarding, marketplace, catégorie, recherche, fiche, batch vendeur ; session/context/source | 🔴 Très haute | Modéré | **Oui** — il faut d'abord cartographier proprement la télémétrie existante |
| **P11 — Distinguer vendeur / visiteur** | Ne plus confondre vérification d'annonce et véritable usage marketplace | `device_context`, `seller_stand`, `entry_source`, `listing_stand`, `is_own_listing`, reconstruction du funnel par session | 🔴 Très haute | Modéré | **Oui**, à traiter avec P10 dans le même plan |
| **P12 — Validation finale** | Geler une version fiable pour demain | Tests mobile, seller onboarding, série, catégories, recherche, instrumentation, IA, queue, health VPS ; correction uniquement des blockers | 🔴 Critique | Faible | **Non** — exécution/test, pas conception |
| **P13 — Gel + tag** | Éviter le patch de dernière minute destructeur | Commit propre, tag version brocante, déploiement VPS, sauvegarde, aucun ajout fonctionnel ensuite | 🔴 Critique | Très faible | **Non** |

## Regroupements recommandés en mode Plan Codex

### Plan A — Marketplace : P4 + P5

À traiter ensemble en mode Plan.

Objectif : structurer l'exploration sans reconstruire le moteur de recherche.

À vérifier avant modification :
- structure actuelle des catégories ;
- données déjà disponibles côté backend ;
- logique de filtres existante ;
- composants frontend déjà utilisés par la marketplace ;
- comportement de la recherche ;
- manière la plus simple d'introduire une vue « derniers objets publiés » ;
- absence de régression sur l'ouverture des fiches.

Principe :
> La photo reste l'élément principal. Les catégories et le numéro de stand servent à rendre la brocante navigable, pas à transformer BrocAI en marketplace e-commerce classique.

---

### Plan B — Mode série vendeur : P7

Mode Plan fortement recommandé.

Objectif : permettre au vendeur de photographier plusieurs objets à la suite puis de lancer leurs analyses en une seule action UX.

Principe architectural à conserver :
> Le mode série doit être une orchestration UX de plusieurs traitements unitaires existants, et non une nouvelle architecture batch backend sauf nécessité démontrée.

À inspecter avant modification :
- workflow vendeur actuel ;
- logique de capture/photo ;
- création des jobs IA ;
- queue existante ;
- polling / suivi des jobs ;
- états frontend ;
- publication des annonces ;
- comportement en cas d'échec partiel ;
- limites de concurrence et quota.

Cible UX :
1. prendre jusqu'à environ 10 photos ;
2. afficher les miniatures ;
3. permettre de supprimer/remplacer une photo avant analyse ;
4. lancer « Analyser mes X objets » ;
5. créer plusieurs jobs unitaires via le système existant ;
6. afficher la progression ;
7. permettre de relire/corriger chaque résultat ;
8. publier plusieurs annonces.

---

### Plan C — Instrumentation : P10 + P11

À traiter ensemble en mode Plan.

Objectif : reconstruire les vrais parcours sans confondre vendeur, visiteur, contrôle d'annonce et véritable usage marketplace.

Événements / propriétés à envisager :
- `session_id`
- `device_context`: `visitor` / `seller`
- `seller_stand`
- `entry_source`
- `listing_stand`
- `is_own_listing`
- `onboarding_viewed`
- `onboarding_marketplace_clicked`
- `marketplace_opened`
- `marketplace_category_selected`
- `marketplace_search`
- `listing_opened`
- `batch_started`
- `batch_size`
- `batch_completed`
- `batch_published`

Cas à pouvoir distinguer :
1. **Visiteur réel** : appareil sans stand → marketplace → fiche d'un stand.
2. **Vendeur vérifiant sa propre annonce** : appareil vendeur → fiche du même stand.
3. **Vendeur qui chine** : appareil vendeur → fiche d'un autre stand.
4. **Vendeur gérant ses annonces** : entrée depuis « Mes annonces ».

Limite acceptée :
> Sans authentification, `seller` signifie « appareil sur lequel un stand est enregistré », pas identité réelle de la personne. Cette précision est suffisante pour l'expérimentation terrain.

---

## Ordre de travail recommandé

`P0 → P1/P2 → P3/P4/P5/P6 → P7/P8 → P9 → P10/P11 → P12 → P13`

### Bloc A — Activation visiteur
- P1 — Onboarding application
- P2 — Home orienté visiteur
- P3 — Marketplace brocante
- P4 — Navigation par catégories
- P5 — Flux marketplace
- P6 — Recherche / zéro résultat

### Bloc B — Réduction de friction vendeur
- P7 — Mode série vendeur
- P8 — Gestion simple des lots

### Bloc C — Mesure terrain
- P10 — Instrumentation parcours
- P11 — Distinction vendeur / visiteur

### Bonus
- P9 — FunLab

---

## Ordre de sacrifice si le temps manque

1. **FunLab**
2. **Gestion des lots**
3. **Polish secondaire de la marketplace**
4. **Mode série vendeur**

À préserver en priorité :
- onboarding visiteur ;
- home orienté visiteur ;
- marketplace structurée ;
- catégories ;
- instrumentation fiable ;
- validation mobile et VPS.

---

## Principes produit à conserver

- Un seul QR code.
- Le visiteur est l'utilisateur autonome par défaut.
- Le vendeur est accompagné humainement et dispose d'un onboarding spécifique.
- Le home peut devenir contextuel si un stand est mémorisé localement.
- La photo reste le point d'entrée principal.
- Pas de formulaires e-commerce lourds.
- Le numéro de stand est central : l'objectif est de relier découverte numérique et déplacement physique.
- Le mode série doit réutiliser la queue et les jobs unitaires existants.
- Un lot = une annonce.
- Une série = plusieurs annonces.
- Pas de sophistication IA supplémentaire sans bénéfice direct.
- Les changements doivent privilégier impact terrain, simplicité et faible risque avant la brocante.
- Après P12/P13 : gel fonctionnel, correction uniquement des blockers.

## Objectif de cette deuxième brocante

La première brocante a surtout validé que BrocAI fonctionnait techniquement.

Cette itération doit permettre de vérifier trois choses :

1. **Les visiteurs comprennent-ils spontanément l'intérêt de BrocAI ?**
2. **Les vendeurs peuvent-ils publier davantage d'objets avec moins de friction ?**
3. **Sommes-nous capables de mesurer correctement les vrais parcours et de distinguer usage visiteur, usage vendeur et simple vérification d'annonce ?**
