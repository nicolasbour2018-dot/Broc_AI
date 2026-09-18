# Brocai — cahier des charges fonctionnel

> Ce document décrit **ce que l'application doit faire** et les contraintes d'expérience. Les détails d'implémentation sont dans `architecture.md` et l'ordre de construction dans `mvp.md`.

## 1. Objectifs produit

Brocai doit servir quatre objectifs, dans cet ordre :

1. rendre la mise en vente d'un objet extrêmement simple ;
2. aider les visiteurs à repérer des objets présents physiquement sur la brocante ;
3. proposer une expérience IA photo utile et ludique ;
4. générer un jeu de données propre permettant d'analyser l'usage réel après l'événement.

Un cinquième objectif, secondaire, est de créer un effet mémorable et partageable grâce au bloc fun et au showroom tablette.

## 2. Principes UX

- **Mobile-first** : l'usage principal se fait au téléphone, depuis un QR code.
- Pas de compte, pas de mot de passe, pas de parcours d'inscription.
- Chaque écran doit avoir une intention principale claire.
- L'IA préremplit et conseille ; l'utilisateur conserve la décision finale.
- Les attentes IA doivent être explicites : `en attente`, `en cours`, `terminé`, `erreur`.
- Une estimation d'attente éventuelle doit être arrondie et prudente, jamais faussement précise.
- Une erreur IA ne doit pas faire disparaître les autres fonctions de l'application.
- Le ton peut être chaleureux et amusant, mais jamais au détriment de la compréhension.

## 3. Bloc 1 — Vendeur

### 3.1 Parcours attendu

1. Le vendeur ouvre l'espace `Je vends`.
2. Il prend une photo directement avec son téléphone **ou** choisit une image dans sa galerie.
3. L'image est envoyée à l'analyse IA.
4. L'interface affiche clairement l'état du traitement et, s'il y a une file, la position / l'attente approximative utile.
5. L'IA propose un brouillon d'annonce.
6. Le vendeur modifie librement les champs.
7. Il renseigne son numéro de stand, obligatoire.
8. Il peut ajouter un pseudo, facultatif.
9. Il prévisualise puis publie.
10. Une confirmation lui permet d'ouvrir l'annonce publiée.

### 3.2 Sortie IA attendue

La proposition IA doit rester courte et directement réutilisable :

- **titre** : concret, sans sur-promesse ;
- **description** : 1 à 3 phrases ;
- **catégorie** : simple et exploitable pour la navigation ;
- **prix conseillé** : valeur indicative, idéalement accompagnée d'une fourchette ;
- **confiance** : faible / moyenne / forte ou équivalent ;
- **touche fun** : optionnelle, courte, non prioritaire.

Le prix final doit être **entièrement modifiable** par le vendeur. Il ne faut pas imposer la suggestion IA.

### 3.3 Données obligatoires d'une annonce

- photo ;
- titre ;
- description courte ;
- catégorie si disponible ;
- prix final choisi ;
- numéro de stand ;
- date / heure de publication.

Pseudo vendeur : facultatif.

## 4. Bloc 2 — Acheteur / mini-marché

### 4.1 Objectif

Aider un visiteur à passer rapidement d'une envie à un stand physique. Ce bloc doit être fiable et indépendant du LLM.

### 4.2 Fonctions MVP

- grille / liste d'annonces ;
- photo, titre, prix et numéro de stand visibles rapidement ;
- recherche simple par mots-clés ;
- fiche annonce ;
- filtre catégorie seulement si la qualité des catégories est suffisante ;
- tri par prix : optionnel, non bloquant.

### 4.3 Hors-scope

- favoris ;
- messagerie ;
- paiement ;
- réservation ;
- panier ;
- profil utilisateur ;
- recommandation personnalisée complexe.

## 5. Bloc 3 — Assistant photo acheteur

### 5.1 Étape A : analyse automatique

La prise de photo doit immédiatement déclencher une petite fiche structurée, sans obliger l'utilisateur à écrire un prompt.

Sortie attendue :

- nom probable de l'objet ;
- catégorie / type ;
- description très courte ;
- usage, style ou époque lorsque cela peut être raisonnablement inféré ;
- estimation indicative / avis de prix si possible ;
- niveau de confiance / avertissement d'incertitude.

L'outil ne doit pas présenter comme certain ce qui n'est qu'une hypothèse visuelle.

### 5.2 Étape B : trois questions / « trois vœux »

Après l'analyse, l'utilisateur peut poser **au maximum trois demandes pour cet objet**. Le but est à la fois de maîtriser les coûts et de rendre la limite amusante plutôt que punitive.

Présets actuels :

#### Est-ce une bonne affaire ?

Mettre le prix affiché en perspective, rappeler les incertitudes et fournir une réponse courte.

#### Raconte-m'en plus

Donner un peu de contexte : usage, style, histoire possible, époque potentielle, éléments distinctifs.

#### Négocie pour moi

Format souhaité :

- éventuelle cible de prix ;
- une phrase courte que l'acheteur pourrait dire ;
- un clin d'œil humoristique ;
- 2 à 3 phrases maximum.

Ton : complice, respectueux, jamais agressif, humiliant ou insistant.

Un champ libre peut rester disponible afin que les trois questions ne soient pas limitées aux seuls presets.

## 6. Bloc 4 — Laboratoire fun [OPTIONNEL]

### 6.1 Intention

Créer un souvenir amusant lié à la brocante, notamment pour les jeunes ou les accompagnants qui ne seraient pas spontanément intéressés par les annonces.

L'expérience part d'une photo et propose **5 vœux**, dont l'utilisateur peut en consommer **3**.

### 6.2 Direction créative

Le sujet créatif principal est **l'objet**. Si une personne apparaît sur la photo, l'objectif n'est pas de la transformer ou de la juger : la transformation doit rester centrée sur l'objet autant que possible.

Pistes :

1. **Donne-moi vie** — objet anthropomorphisé + mini-histoire en deux phrases.
2. **Fais de moi une star** — objet mis en scène dans une affiche / poster.
3. **Raconte mon passé** — biographie fictive courte et explicitement imaginaire.
4. **Mon pouvoir secret** — pouvoir absurde + punchline.
5. **Pars en quête** — mini-aventure dans la fête foraine : un selfie avec l’objet, deux photos prises selon une mission courte, puis une histoire souvenir générée à partir des trois images.

Le vœu `Pars en quête` doit expliquer son objectif avant le départ : *« Emmène ton objet à la fête foraine : un selfie, deux photos-missions, puis BrocAI raconte votre aventure. »* Les photos et selfies sont temporaires et ne doivent pas être conservés au-delà du traitement. Les quatre autres vœux réutilisent le contexte textuel de l’analyse initiale afin d’éviter de renvoyer l’image à chaque génération.

### 6.3 Règle de priorité

Ce bloc n'est développé **qu'après stabilisation des trois blocs principaux**.

## 7. Showroom tablette

### 7.1 Intention

Les personnes qui viennent au stand doivent pouvoir tester plusieurs projets sous forme de prototypes très soignés, mais techniquement légers.

Le showroom n'est pas une reconstitution des back-ends. C'est un **décor de cinéma interactif** : interfaces crédibles, données figées, scénarios déterministes, animations et éventuellement un LLM réel jouant dans un contexte fictif.

### 7.2 Univers à montrer

#### Rocky

À montrer :

- dashboard ;
- offres ;
- matching ;
- suivi candidatures ;
- emails / Gmail simulés ;
- statistiques ;
- chatbot.

Les offres, emails, scores, graphiques et actions peuvent être fictifs.

#### Basket

À montrer :

- tableau de bord équipe / joueurs ;
- indicateurs ;
- tendances ;
- comparaison ;
- vue match.

Dataset et scénarios peuvent être entièrement figés.

#### Garage

À montrer :

- clients ;
- véhicules ;
- interventions ;
- devis ;
- planning ;
- indicateurs.

Les données et historiques sont fictifs.

#### Jarvis

À montrer :

- assistant conversationnel futuriste ;
- agenda familial ;
- maison / domotique simulée ;
- courses ;
- routines.

Aucune action réelle sur une maison, un calendrier ou un compte externe.

### 7.3 LLM comédien

Rocky et Jarvis peuvent utiliser un vrai LLM pour donner de la vie à la démo.

Le LLM reçoit :

- un personnage / ton ;
- un monde fictif ;
- un ensemble de données fictives ;
- ce qu'il a le droit de prétendre simuler ;
- l'interdiction de prétendre qu'une action externe réelle a été exécutée.

Contraintes :

- reset entre deux visiteurs ;
- historique court ;
- pas de connexion à de vraies données personnelles ;
- pas d'action externe ;
- démonstration présentée honnêtement comme telle.

## 8. Instrumentation et données à récupérer

L'analyse sera réalisée **après** l'événement. Brocai doit donc surtout produire des données propres et exportables.

### 8.1 Événements produit Brocai

| Événement | Champs utiles | Usage analytique |
|---|---|---|
| `session_started` | `session_id`, `timestamp`, type d'appareil approximatif | volume et temporalité des sessions |
| `nav_opened` | écran, écran précédent | parcours réellement utilisés |
| `seller_photo_submitted` | timestamp, taille image par tranche | volume vendeur |
| `ai_analysis_started` | fonctionnalité, position de file | formation de la queue |
| `ai_analysis_completed` | latence, succès, niveau de confiance | performance IA |
| `listing_published` | catégorie, tranche de prix, stand | contenu mis en vente |
| `search_performed` | longueur requête, nombre de résultats | utilité de la recherche |
| `listing_viewed` | id annonce, écran source | attractivité des annonces |
| `object_scan_completed` | catégorie, confiance | usages de l'assistant photo |
| `object_chat_question` | preset/libre, index du vœu | questions les plus utilisées |
| `fun_wish_selected` | nom du vœu, succès génération | popularité du bloc fun |
| `error_shown` | fonctionnalité, code erreur | points de rupture UX |

### 8.2 Mesures techniques

- longueur de queue au moment d'une demande ;
- temps d'attente avant démarrage ;
- temps d'exécution IA ;
- taux d'erreur API par fonctionnalité ;
- nombre d'appels IA par type de fonctionnalité ;
- volume/tokens estimés si disponibles ;
- temps de réponse des requêtes catalogue / recherche ;
- CPU / RAM ;
- erreurs serveur par tranche horaire.

### 8.3 Showroom

Événements minimaux :

- `demo_opened` : Rocky / Basket / Garage / Jarvis ;
- `feature_clicked` ;
- `chat_started` ;
- `message_count` ;
- `demo_duration_s` ;
- `demo_reset`.

Par défaut, **ne pas conserver le texte brut des conversations** du showroom.

## 9. Minimisation des données

- pas d'email ou téléphone nécessaire ;
- pas d'identité réelle nécessaire ;
- identifiant de session aléatoire et éphémère ;
- ne pas collecter une donnée simplement « au cas où » ;
- pour les fonctions photo / selfie, éviter la conservation de l'image source au-delà de ce qui est nécessaire au fonctionnement ;
- séparer autant que possible les métriques d'usage des contenus générés.

## 10. Critères fonctionnels de réussite

Le MVP est acceptable si :

- un vendeur publie une annonce depuis son téléphone sans compte ;
- l'annonce est immédiatement visible dans le mini-marché ;
- un acheteur trouve son numéro de stand ;
- l'assistant photo produit une fiche puis accepte au maximum trois questions ;
- une demande IA peut attendre dans une file sans bloquer le reste de l'application ;
- une indisponibilité IA ne casse pas le catalogue ;
- les données d'usage peuvent être exportées en CSV ou JSON ;
- le showroom peut être remis à zéro rapidement entre deux visiteurs.
