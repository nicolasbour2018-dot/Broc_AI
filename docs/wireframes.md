# Wireframes mobiles — Brocai

Ces maquettes très grossières couvrent le périmètre de l’étape 0 du MVP. Elles sont des spécifications d’interaction et de hiérarchie, pas une direction visuelle de production ni une décision produit durable. Elles emploient volontairement uniquement des gris.

## Convention proposée

- Gabarit intrinsèque mobile : `390 × 844`, lisible après mise à l’échelle à `320 px` et à `390 px` de large.
- En-tête compact, contenu sur une colonne et cartes empilées.
- Action primaire sombre, pleine largeur, placée près du bas, sauf à l’accueil où le parcours principal dépend du stand mémorisé ; les actions secondaires restent claires et en flux.
- Boutons et zones d’action principaux dessinés à `52 px` de haut ; les accès secondaires de l’accueil gardent une cible tactile d’au moins `44 px`.
- Les états IA sont des contenus dans le flux, jamais un blocage visuel de l’accès au mini-marché. Les formulations d’attente sont prudentes et arrondies.
- Les mots et données d’exemple sont illustratifs. En particulier, une analyse IA est indiquée comme telle et reste incertaine.

## Inventaire des écrans

| ID | Écran / état | Artefact | Action principale |
| --- | --- | --- | --- |
| WF-01 | Accueil | [01-accueil.svg](./assets/wireframes/01-accueil.svg) | Choisir un parcours |
| WF-02 | Vendeur — prise ou import de photo | [02-vendeur-photo.svg](./assets/wireframes/02-vendeur-photo.svg) | `Prendre une photo` |
| WF-03 | Vendeur — en attente dans la file IA | [03-vendeur-file.svg](./assets/wireframes/03-vendeur-file.svg) | `Voir le mini-marché` |
| WF-04 | Vendeur — brouillon éditable | [04-vendeur-brouillon.svg](./assets/wireframes/04-vendeur-brouillon.svg) | `Prévisualiser l’annonce` |
| WF-05 | Vendeur — aperçu | [05-vendeur-apercu.svg](./assets/wireframes/05-vendeur-apercu.svg) | `Publier l’annonce` |
| WF-06 | Vendeur — confirmation | [06-vendeur-confirmation.svg](./assets/wireframes/06-vendeur-confirmation.svg) | `Retour au mini-marché` |
| WF-07 | Mini-marché — liste | [07-marche-liste.svg](./assets/wireframes/07-marche-liste.svg) | `Rechercher` |
| WF-08 | Mini-marché — recherche | [08-marche-recherche.svg](./assets/wireframes/08-marche-recherche.svg) | `Voir l’annonce` |
| WF-09 | Mini-marché — fiche | [09-marche-detail.svg](./assets/wireframes/09-marche-detail.svg) | `Retour aux annonces` |
| WF-10 | Assistant photo — prise ou import | [10-assistant-photo.svg](./assets/wireframes/10-assistant-photo.svg) | `Prendre une photo` |
| WF-11 | Assistant photo — fiche d’analyse | [11-assistant-analyse.svg](./assets/wireframes/11-assistant-analyse.svg) | `Poser une question · 3 restantes` |
| WF-12 | Assistant photo — questions | [12-assistant-questions.svg](./assets/wireframes/12-assistant-questions.svg) | `Envoyer ma question` |
| WF-13 | Assistant photo — limite atteinte | [13-assistant-limite.svg](./assets/wireframes/13-assistant-limite.svg) | `Analyser un autre objet` |
| WF-14 | IA — en cours et erreur récupérable | [14-etats-ia.svg](./assets/wireframes/14-etats-ia.svg) | `Réessayer l’analyse` |
| WF-15 | Showroom — hub et remise à zéro | [15-showroom-reset.svg](./assets/wireframes/15-showroom-reset.svg) | `Réinitialiser la démo` |

## Parcours et notes d’interaction

### Accueil

> Mis à jour à l'[étape 12](./decisions/etape-12-refonte-ux-ui.md) : charte « Papier & étiquette », question d'accueil unique, barre d'onglets. Les SVG WF-01 à WF-06 illustrent l'ancienne disposition.

Au premier lancement sur `/`, un écran unique demande « Vous êtes… » : `Je viens chiner` (accueil visiteur) ou `Je tiens un stand` (onboarding vendeur), avec un lien `Passer`. Une barre d'onglets fixe (Accueil · Chercher · Analyser · Vendre, qui devient « Mon stand » après l'onboarding) est présente partout sauf sur cet écran et dans la caméra. Chaque écran a son URL : le bouton retour du téléphone reste dans l'application.

| | Visiteur | Vendeur ayant confirmé son onboarding |
| --- | --- | --- |
| En-tête | logo + nom de l'événement | logo + badge `Stand N` (ouvre son stand) |
| Premier bloc | `Que cherchez-vous ?` : recherche vers le marché | `Ajouter des objets` : ouvre la caméra en rafale |
| Ensuite | grille des rayons (5 plus fournis + `Tous les rayons`), puis `Tout juste déballé` (5 dernières annonces, prix en étiquette, stand, fraîcheur) | `Mes annonces` : 5 annonces, actives d'abord, puis par vues ; statut et nombre de vues |
| Puis | cartes `Un objet vous plaît sur un stand ?` (J'analyse) et `FunLab, le jeu de la brocante`, puis `Vous vendez ?` | liens vers les objets, J'analyse, FunLab |
| Sans annonce | message « Les vendeurs installent leurs stands » | invitation à ajouter des objets |

L'onboarding vendeur s'enchaîne ainsi : numéro de stand et pseudo facultatif, un écran de trois étapes illustrées (`J'ai compris`), puis la confirmation `Oui, c'est le stand N` ou `Changer de numéro`. `Changer de stand`, dans l'espace vendeur, relance l'onboarding après confirmation.

### Vendre

`Ajouter des objets` → caméra intégrée (rafale, vignettes retirables, galerie, `Terminer (N)`) → `Photos à analyser` → `Analyser mes N photos` → liste de brouillons éditables → `Publier les N annonces prêtes` → récapitulatif.

Si la caméra intégrée ne peut pas s'ouvrir (API absente, permission refusée, rien au bout de 6 s), l'écran bascule sur l'appareil photo du téléphone, avec un gros bouton `Photo suivante`. Chaque brouillon affiche titre, prix (avec la suggestion et la fourchette de BrocAI) et rayon ; description, petite phrase et pseudo sont repliés. Un badge `À vérifier` signale une confiance faible ou une analyse automatique indisponible. `Supprimer` retire le brouillon avec une annulation possible pendant 5 s, puis libère sa photo sur le serveur. Les brouillons prêts peuvent être publiés pendant que d'autres photos sont encore en analyse. Dans `Mes annonces`, `Marquer vendu` agit tout de suite, avec `Annuler` pendant 5 s.

### Acheter / mini-marché

`Liste` → `recherche par mots-clés` → `fiche`.

La liste et la recherche montrent chaque fois titre, prix et stand avant l’ouverture de la fiche. Aucun état IA ou dépendance IA n’est présenté dans ce parcours : il reste utilisable en cas d’indisponibilité du fournisseur.

### Assistant photo

`Photo` → `analyse automatique courte` → `jusqu’à trois questions` → `limite atteinte`.

La fiche distingue les éléments probables de l’objet de leur niveau de confiance ; elle n’affirme pas une époque ou une valeur incertaine. Sous le titre `Posez jusqu’à 3 questions sur cet objet`, chaque choix rapide dit ce qu'il renvoie : `Est-ce un bon prix ?` (avis comparant le prix du stand à l'estimation), `Racontez-m’en plus` (histoire, style, époque probable) et `Aidez-moi à négocier` (prix à proposer et phrase à dire), avec un champ libre. Le champ `Prix demandé sur le stand` précise qu'il sert au bon prix et à la négociation. Le compteur est visible avant l’envoi, et une question en erreur n'est pas décomptée. À la troisième question, la limite est expliquée comme propre à l’objet en cours ; analyser un autre objet réinitialise naturellement le contexte.

### États IA et récupération

Les libellés exposent les quatre états attendus : `en attente` (WF-03), `en cours` et `erreur` (WF-14), `terminée` (WF-11). L’erreur indique ce qui n’a pas eu lieu (« votre photo n’a pas été publiée »), offre une reprise explicite et maintient un accès au mini-marché.

### Showroom

Le hub distingue les univers Rocky, Basket, Garage et Jarvis sans suggérer des connexions réelles. L’action basse `Réinitialiser la démo` remet le scénario et les échanges locaux à zéro en un geste ; une confirmation d’exécution resterait à concevoir avec l’équipe produit avant implémentation.

## Accessibilité et responsive

Les SVG utilisent du texte réel, un titre et une description accessibles par écran, et ne reposent pas sur la couleur seule pour porter l’état : les mots `en attente`, `en cours`, `terminée` et `erreur` sont affichés. Les boutons sont représentés à 52 px de haut. Les zones horizontales font au plus 342 px dans une surface de 390 px, laissant 24 px de marge de chaque côté ; la mise à l’échelle à 320 px conserve donc marges et hiérarchie. Les illustrations sont indicatives et ne portent aucune information essentielle.

## Limites / points à décider avant production

- Le choix Streamlit ou front web léger reste ouvert : ces SVG ne présument pas du composant technique.
- La validation exacte du stand (format, moment où le blocage de publication est déclenché) n’est pas spécifiée ici.
- La gestion de notification lorsqu’une analyse en attente se termine, le comportement hors-ligne et la confirmation de reset showroom nécessitent une décision produit et une validation technique.
- Ces fichiers ne constituent pas des tests d’accessibilité avec lecteur d’écran ni des écrans interactifs ; ils servent de repère de structure avant le front.
