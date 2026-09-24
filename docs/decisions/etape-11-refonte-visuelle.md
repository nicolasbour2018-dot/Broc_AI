# Étape 11 — Refonte visuelle pour la brocante de Saint-Arnoult

- **Date de décision** : 2026-09-24
- **Décideur** : Nicolas
- **Échéance** : brocante de Saint-Arnoult-en-Yvelines, samedi 26 septembre 2026
- **Référence visuelle** : [maquette_prototype_V2.png](../assets/maquette_prototype_V2.png) (accueil uniquement)

## Contexte

La brocante du 20 septembre 2026 a tourné sur `main` (dernier commit du 20/09). Ses données ont été récupérées et pré-analysées ; cette analyse motive la refonte visuelle. La prochaine brocante réutilise le même QR code. La base de données est réinitialisée avant samedi : l'application est éphémère par événement.

## Périmètre

- **Dedans** : BrocAI public — accueil, `Je vends`, `Je recherche`, `J’analyse`.
- **FunLab** : la carte d’accueil et les ajustements déjà présents (`.view-funlab`) sont conservés ; `funlab.css` n’est pas retravaillé.
- **Dehors** : Showroom et Admin.
- **Règle** : aucun élément visuel creux. Un élément de la maquette sans donnée réelle derrière (favoris) n’est pas affiché.
- **Accessibilité** : WCAG AA sur le texte ; les pastilles d’icône suivent la maquette.
- **Typographie** : Fraunces est conservée pour les titres. Son `J` majuscule, posé sur la ligne de base avec une boule, diffère du `J` descendant de la maquette ; l’écart est accepté (décision du 2026-09-24).

## Livrables et ordre

Une PR par livrable. Tout ajout non mergé et testé **vendredi 25/09 à 18 h** est abandonné ; le design n’en dépend pas.

1. **Design** (`step11-UI-graphic-chart`) : la surcouche CSS actuelle est conservée ; seuls les débordements de l’ancienne base beige (fonds `html`/`body`, `theme-color`) sont corrigés. Les parcours sont harmonisés visuellement sans changement de mise en page, dans l’ordre `Je recherche`, `Je vends`, `J’analyse`.
2. **Dernières annonces** pour les visiteurs : 5 annonces actives les plus récentes, à partir de la liste existante du mini-marché.
3. **Vues par annonce** exposées dans l’API, à partir de l’événement `listing_viewed` déjà compté par le rapport vendeur.
4. **Onboarding vendeur et verrou local** : numéro de stand, pseudo facultatif, explication en un écran de trois étapes illustrées, `Valider`, confirmation `Stand N` avec `Changer de numéro`. L’état est mémorisé sous une nouvelle clé `brocai-seller-onboarding-v1` ; l’ancienne clé `brocai-seller-stand` est ignorée. Le pseudo préremplit `seller_alias`. Une action discrète `Changer de stand` relance l’onboarding après confirmation. **Repli** : sans cette PR, le comportement du 20/09 est conservé et l’accueil n’affiche jamais la pastille.

Le comportement de l’accueil par profil est décrit dans [wireframes.md](../wireframes.md#accueil).

## Mise en production

- Retour arrière : tag `event-2026-09-20` sur `main`.
- Gel vendredi 25/09 à 18 h, déploiement vendredi soir, jamais le samedi matin.
- Répétition sur un iPhone et un Android réels en 4G :
  1. visiteur via QR code : accueil sans pastille, dernières annonces, fiche, recherche ;
  2. vendeur : onboarding, pastille, photo, analyse, publication, `Mes annonces`, visibilité depuis un autre appareil, marquer vendu ;
  3. `J’analyse` et FunLab : une photo aboutit ;
  4. états dégradés : backend coupé, message lisible, reprise fonctionnelle ;
  5. lecture en extérieur, luminosité maximale.
- **No-go** si 1, 2 ou 4 échoue : retour au tag, sans correctif de dernière minute. 3 et 5 ne bloquent pas.

## Dette connue, acceptée pour samedi

- Le verrou du stand est local à l’appareil : quiconque saisit un numéro peut encore gérer ce stand.
- Aucune séparation des données par événement ; la réinitialisation de la base en tient lieu.
- La cascade CSS superpose deux palettes ; la base n’est pas réécrite en tokens.

## Après l’événement

Réécriture de la base CSS en tokens, WCAG AA strict (icônes comprises), identité de stand côté serveur (réservation ou code par stand), champ d’événement sur les données.
