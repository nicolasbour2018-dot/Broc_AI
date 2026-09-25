# Brocai — contexte projet

> **Statut** : cadrage pré-développement / MVP événementiel  
> **Cible initiale** : brocante du 20 septembre 2026  
> **Principe directeur** : livrer une expérience petite, fiable, agréable et mesurable plutôt qu'une application large mais fragile.

## 1. Objet du projet

Brocai est une web app légère pensée pour une brocante physique. Elle doit créer une expérience utile et mémorable autour des objets exposés, sans chercher à reproduire une marketplace complète.

Le projet a deux volets distincts :

1. **Brocai V1**, application réellement utilisable par les visiteurs et vendeurs le jour de la brocante.
2. **Showroom tablette**, ensemble de démonstrations de projets destinées aux personnes qui viennent au stand. Ces démos sont volontairement majoritairement fictives côté métier : l'accent est mis sur l'UX, l'UI et la compréhension de la valeur.

Ne pas confondre les deux : **Brocai doit fonctionner réellement ; le showroom peut simuler.**

## 2. Documents de contexte

- [`cahier_des_charges.md`](./cahier_des_charges.md) : besoins fonctionnels, UX, données à collecter, périmètre et hors-scope.
- [`mvp.md`](./mvp.md) : ordre d'exécution, priorités, critères de sortie et stratégie de réduction de périmètre.
- [`architecture.md`](./architecture.md) : architecture technique cible, flux, données, file IA, monitoring et exploitation.

En cas d'ambiguïté, appliquer cet ordre de priorité :

1. décisions explicites des documents ;
2. fiabilité du jour J ;
3. simplicité d'usage ;
4. instrumentation utile ;
5. enrichissements visuels ou fonctionnels.

## 3. Périmètre fonctionnel retenu

### Bloc 1 — Vendeur

Un vendeur peut :

- prendre une photo directement depuis son téléphone ou choisir une image ;
- obtenir une proposition IA préremplie ;
- modifier librement les champs ;
- renseigner obligatoirement son numéro de stand ;
- ajouter éventuellement un pseudo ;
- publier l'annonce.

L'IA doit proposer au minimum : titre, description courte, catégorie, prix indicatif et niveau de confiance. La décision finale appartient toujours au vendeur.

### Bloc 2 — Acheteur / mini-marché

Un visiteur peut :

- parcourir les annonces ;
- rechercher par mots-clés ;
- éventuellement filtrer par catégorie si la donnée est suffisamment fiable ;
- ouvrir une fiche ;
- voir immédiatement le prix et le numéro de stand.

Ce bloc ne nécessite aucun LLM.

### Bloc 3 — Assistant photo acheteur

Un visiteur photographie un objet et reçoit d'abord une **analyse automatique courte** :

- nom probable ;
- catégorie / type ;
- courte description ;
- usage, style ou époque si cela peut être inféré avec prudence ;
- estimation indicative / avis de prix ;
- niveau de confiance / incertitude.

Ensuite seulement, il peut poser **jusqu'à trois questions sur cet objet**.

Suggestions envisagées :

- **Est-ce une bonne affaire ?**
- **Raconte-m'en plus.**
- **Négocie pour moi.**

`Négocie pour moi` doit rester très bref, complice et respectueux : cible de prix éventuelle + une phrase à dire + une touche d'humour, en 2 à 3 phrases maximum.

### Bloc 4 — Laboratoire fun [OPTIONNEL]

Bloc détachable, destiné notamment à rendre l'expérience amusante pour un public jeune.

Mécanique : **3 vœux à choisir parmi 5** autour d'une photo. Le héros créatif est l'objet, pas l'utilisateur.

Pistes actuelles :

- `Donne-moi vie` : objet anthropomorphisé + mini-histoire ;
- `Fais de moi une star` : transformation visuelle façon affiche / poster ;
- `Raconte mon passé` : micro-biographie fictive assumée ;
- `Mon pouvoir secret` : pouvoir absurde + punchline ;
- cinquième vœu : à définir.

Ce bloc est le premier à supprimer si le planning ou la stabilité l'exigent.

## 4. Showroom tablette

Le stand doit aussi permettre de montrer plusieurs projets dans une seule expérience de démonstration :

- **Rocky** : dashboard, offres, matching, Gmail simulé, suivi des candidatures, statistiques et chatbot ;
- **Basket** : équipe / joueurs, indicateurs, tendances, comparaisons et vue match ;
- **Garage** : clients, véhicules, interventions, devis, planning et indicateurs ;
- **Jarvis** : assistant grand public futuriste, agenda familial, maison, courses, routines, conversation.

Les données métier peuvent être entièrement figées et simulées. Il n'est pas demandé de recréer les back-ends réels.

Pour Rocky et Jarvis, un **LLM comédien** peut être réel : il reçoit un décor fictif, des données fictives et des limites strictes, puis improvise uniquement à l'intérieur de cette simulation. Il ne doit jamais accéder à de vrais mails, calendriers, appareils, comptes ou services externes.

## 5. Contraintes et décisions fortes

### Décisions actuelles

- Web app mobile-first accessible par QR code.
- Une architecture d'exploitation simple autour d'une **VM unique** pour le MVP.
- Accès public via un **Cloudflare Tunnel persistant**.
- **PostgreSQL** pour les annonces et les événements analytics.
- Objectif de test : **150 sessions/utilisateurs simultanés sur le parcours global**.
- Réglage initial : **20 analyses IA simultanées maximum**, surplus en file d'attente.
- La file doit afficher un état compréhensible et, si pertinent, une estimation d'attente arrondie.
- Le catalogue et les fonctions sans IA doivent rester disponibles même si le fournisseur IA est indisponible.
- Pas de comptes utilisateurs dans le MVP.
- Collecte de données minimale et principalement anonyme.

### Arbitrages encore ouverts

- Streamlit en production ou front web léger plus contrôlé.
- Fournisseur / modèle multimodal exact après tests réels de qualité, coût, latence et quotas. Gemini est une piste de travail, pas une contrainte d'architecture.
- Stockage des images : disque/volume de la VM, stockage objet externe ou hybride.
- Implémentation exacte de la queue.
- Les cinq vœux finaux du bloc fun.

## 6. Hors-scope MVP

Ne pas implémenter sans décision explicite :

- création de comptes, login, mots de passe ;
- messagerie entre utilisateurs ;
- favoris ;
- panier, réservation, paiement ou transaction ;
- carte interactive complexe ;
- CMS / back-office lourd ;
- historique long des conversations IA ;
- automatisations multi-agents dans Brocai ;
- vraies intégrations Gmail, calendrier ou domotique dans le showroom.

## 7. Règles de travail pour le projet

- **Ne pas élargir spontanément le scope.** Une fonctionnalité ajoutée doit remplacer quelque chose de moins important ou être explicitement validée.
- Construire par **tranches verticales testables**, pas par couches techniques isolées pendant plusieurs jours.
- Préserver la séparation entre fonctions déterministes et fonctions IA.
- Toute sortie IA visible par l'utilisateur reste éditable ou clairement présentée comme indicative.
- Une panne IA ne doit pas casser le mini-marché.
- Instrumenter les flux critiques dès le MVP ; ne pas repousser toute la mesure à la fin.
- Les démos du showroom doivent rester **des démonstrations transparentes**, même lorsqu'un LLM réel improvise derrière l'interface.
- Avant toute optimisation ou sophistication, démontrer le besoin par un test réel ou une métrique.

## 8. Définition synthétique du succès

Le jour J, le projet est réussi si :

- un vendeur peut publier rapidement une annonce depuis son téléphone ;
- un acheteur peut trouver un objet et son stand sans compte ;
- l'analyse photo reste utilisable même sous un pic grâce à la queue ;
- les erreurs sont compréhensibles et récupérables ;
- les données d'usage et techniques sont exportables pour analyse après l'événement ;
- les démos tablette sont fluides, belles, réinitialisables et ne dépendent pas de systèmes métier complexes.
