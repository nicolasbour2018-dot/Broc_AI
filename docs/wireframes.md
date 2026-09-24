# Wireframes mobiles — Brocai

Ces maquettes très grossières couvrent le périmètre de l’étape 0 du MVP. Elles sont des spécifications d’interaction et de hiérarchie, pas une direction visuelle de production ni une décision produit durable. Elles emploient volontairement uniquement des gris.

## Convention proposée

- Gabarit intrinsèque mobile : `390 × 844`, lisible après mise à l’échelle à `320 px` et à `390 px` de large.
- En-tête compact, contenu sur une colonne et cartes empilées.
- Action primaire sombre, pleine largeur, placée près du bas, sauf à l’accueil où les trois cartes de parcours sont les actions principales ; les actions secondaires restent claires et en flux.
- Boutons et zones d’action dessinés à `52 px` de haut (donc au-dessus de la cible tactile de `44 px`).
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

L’accueil présente les parcours `Je vends`, `Je recherche`, `J’analyse` et `FunLab` dans quatre cartes, puis un bloc d’annonces dont le contenu dépend du profil. Chaque carte est une cible complète. La direction visuelle de référence est [maquette_prototype_V2.png](./assets/maquette_prototype_V2.png) ; les éléments de la maquette sans donnée réelle derrière (favoris notamment) ne sont pas affichés.

| | Visiteur | Vendeur ayant confirmé son onboarding |
| --- | --- | --- |
| Pastille `Stand N` | absente | visible, ouvre son stand |
| Bloc d’annonces | `Dernières annonces` : 5 annonces actives les plus récentes ; bloc masqué tant qu’aucune annonce n’existe | `Mes annonces` : 5 annonces, vues décroissantes puis plus récentes ; actives avant vendues |
| Toucher une ligne | fiche de l’annonce sur le mini-marché | son stand |
| Ligne de statistiques | icône boutique et `Stand N` | nombre de vues, `0` compris |
| `Voir tout` | mini-marché | son stand |

L’onboarding vendeur s’enchaîne ainsi : numéro de stand, pseudo facultatif (prérempli ensuite dans chaque annonce), explication en un écran de trois étapes illustrées, `Valider`, puis confirmation `Stand N` avec `Changer de numéro`. La pastille n’apparaît qu’après cette confirmation. Une action discrète `Changer de stand` dans l’écran vendeur relance l’onboarding après confirmation. Voir la [décision de l’étape 11](./decisions/etape-11-refonte-visuelle.md).

### Vendre

`Photo` → `en attente` ou `analyse en cours` → `brouillon` → `aperçu` → `publication` → `confirmation`.

La photo peut venir de la caméra ou de la galerie. En file, la position et une estimation par tranche sont visibles ; l’utilisateur peut quitter l’attente pour le mini-marché. Le brouillon est modifiable avant l’aperçu : titre, description, catégorie, prix et stand sont visibles, et le prix IA n’est qu’une suggestion. Le numéro de stand est identifié comme obligatoire ; le pseudo reste facultatif. La confirmation rappelle que l’annonce est publiée et donne accès à sa fiche.

### Acheter / mini-marché

`Liste` → `recherche par mots-clés` → `fiche`.

La liste et la recherche montrent chaque fois titre, prix et stand avant l’ouverture de la fiche. Aucun état IA ou dépendance IA n’est présenté dans ce parcours : il reste utilisable en cas d’indisponibilité du fournisseur.

### Assistant photo

`Photo` → `analyse automatique courte` → `jusqu’à trois questions` → `limite atteinte`.

La fiche distingue les éléments probables de l’objet de leur niveau de confiance ; elle n’affirme pas une époque ou une valeur incertaine. Les choix rapides sont `Est-ce une bonne affaire ?`, `Raconte-m’en plus` et `Négocie pour moi`, avec un champ libre. Le compteur est visible avant l’envoi. À la troisième question, la limite est expliquée comme propre à l’objet en cours ; analyser un autre objet réinitialise naturellement le contexte.

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
