# Brocai — architecture technique MVP

> Architecture cible pour l'événement : **simple, monolithique autant que raisonnable, observable et facilement redémarrable**. Ne pas transformer ce MVP en architecture distribuée sans besoin mesuré.

## 1. Vue d'ensemble

```text
Téléphone / tablette
        |
      HTTPS
        |
Cloudflare Tunnel persistant
        |
        v
+-------------------------------------------+
|                  VM MVP                   |
|                                           |
|  Front / web app                          |
|        |                                  |
|  Logique applicative / API interne        |
|        |---------------> PostgreSQL       |
|        |                                  |
|        +---------------> Queue IA         |
|                              |            |
|                              v            |
|                    Fournisseur multimodal |
|                                           |
|  Logs + métriques + mini-dashboard admin  |
+-------------------------------------------+
```

Le showroom tablette peut être hébergé dans le même projet / sur la même VM si cela simplifie le déploiement. Son contenu métier est principalement statique.

## 2. Choix actuels

| Couche | Choix MVP | Statut |
|---|---|---|
| Accès public | Cloudflare Tunnel persistant | décidé |
| Hébergement | une VM | décidé |
| BDD | PostgreSQL | décidé |
| Front | Streamlit ou front web léger | à figer avant implémentation |
| Back-end | service unique / modules dans le même projet | orientation retenue |
| IA | modèle multimodal low-cost | fournisseur exact à valider |
| Queue | 20 tâches IA simultanées au départ | réglage MVP à tester |
| Monitoring | logs + métriques + mini-dashboard | décidé |
| Stockage images | local VM / objet / hybride | ouvert |

### Note modèle IA

Gemini a été envisagé pendant le cadrage, mais l'architecture ne doit pas dépendre d'un modèle précis. Le choix final doit être fait sur tests réels :

- qualité vision ;
- latence ;
- coût ;
- limites de débit / quotas ;
- stabilité ;
- simplicité d'intégration.

Prévoir une abstraction suffisamment petite pour changer de modèle/fournisseur sans réécrire les parcours métier, **sans construire une couche multi-provider complexe par anticipation**.

## 3. Cibles de capacité

### Application globale

- cible de test : **150 sessions/utilisateurs simultanés** ;
- les parcours déterministes (catalogue, recherche, fiches) doivent être les plus légers possible ;
- ne pas confondre nombre de visiteurs et nombre d'appels IA simultanés.

### IA

Réglage initial :

```text
MAX_AI_IN_FLIGHT = 20
```

Au-delà : mise en file.

Ce paramètre doit être configurable. Sa valeur finale dépend des limites réelles du fournisseur et des résultats du test de charge.

Aucune promesse fixe de temps d'attente ne doit être encodée dans l'UX. Afficher plutôt des catégories prudentes ou une estimation basée sur les observations récentes.

## 4. Flux vendeur

```text
Photo
  -> création tâche IA
  -> [immédiat OU queued]
  -> analyse vision
  -> JSON structuré
  -> formulaire éditable
  -> validation vendeur
  -> INSERT listing
  -> émission événement analytics
  -> fiche annonce
```

### Contrat de sortie IA suggéré

```json
{
  "title": "string",
  "description": "string",
  "category": "string|null",
  "suggested_price_eur": 0.0,
  "price_range_eur": {
    "min": 0.0,
    "max": 0.0
  },
  "confidence": "low|medium|high",
  "fun_line": "string|null"
}
```

Le contrat exact peut évoluer, mais la sortie doit être validée côté application avant affichage.

## 5. Flux acheteur / marché

```text
GET listings
   -> filtres/recherche simples
   -> liste
   -> fiche
   -> stand_number
```

Aucun appel IA ne doit être requis pour :

- ouvrir l'accueil acheteur ;
- parcourir les annonces ;
- rechercher ;
- ouvrir une fiche.

C'est une contrainte de résilience importante.

## 6. Flux assistant photo

```text
Photo
  -> tâche IA
  -> fiche structurée
  -> contexte objet court
  -> jusqu'à 3 questions
       -> preset OU champ libre
       -> réponse courte
  -> reset au changement d'objet
```

Ne pas conserver un historique long. Le contexte utile est l'analyse de l'objet + quelques messages de la session courante.

## 7. Queue IA

### États minimaux

```text
queued
running
success
error
timeout   # si utile dans l'implémentation
```

### Comportements requis

- limite globale configurable ;
- pas plus de 20 tâches simultanées au réglage initial ;
- une tâche en erreur libère son slot ;
- timeout explicite ;
- aucun blocage global du serveur à cause d'une requête IA lente ;
- position/état exposable au front ;
- métriques de durée et de queue émises automatiquement.

### ETA

Calcul possible à partir de la durée observée des dernières tâches et du nombre de travaux devant l'utilisateur. Affichage recommandé par tranches :

- `quelques secondes` ;
- `moins d'une minute` ;
- `environ 1–2 min` ;
- etc.

Ne pas afficher de précision artificielle.

### Implémentation

Rester sur l'option la plus simple compatible avec le front choisi. Ne pas introduire Redis/Celery/autre composant uniquement « parce que c'est standard » si une solution plus légère satisfait les tests. Inversement, si la queue en mémoire devient fragile face aux redémarrages ou à la concurrence, passer à une solution persistante justifiée.

## 8. Modèle de données minimal

### `listings`

| champ | type indicatif | contrainte |
|---|---|---|
| `id` | UUID ou int | PK |
| `image_path` / `image_url` | text | requis |
| `title` | text | requis |
| `description` | text | requis |
| `category` | text nullable | facultatif |
| `price_eur` | numeric | requis |
| `stand_number` | text | requis |
| `seller_alias` | text nullable | facultatif |
| `created_at` | timestamp | requis |

### `events`

Schéma conseillé : événement générique append-only.

| champ | rôle |
|---|---|
| `id` | identifiant |
| `session_id` | session anonyme |
| `event_name` | type d'événement |
| `timestamp` | date/heure |
| `properties` | JSON/JSONB avec données minimales |

Ne pas placer de contenu personnel inutile dans `properties`.

### Queue / jobs

La persistance des jobs est **optionnelle** selon l'implémentation. Si une table est nécessaire, garder un schéma minimal : id, type de tâche, statut, timestamps, erreur, métriques. Ne pas y dupliquer inutilement les images ou réponses complètes.

## 9. Images

Le choix final reste ouvert.

Contraintes :

- il faut conserver les images nécessaires aux annonces tant qu'elles sont publiées ;
- les images temporaires de scan / fun ne doivent pas être conservées sans besoin ;
- compresser/redimensionner avant ou pendant l'upload si utile pour latence et coût ;
- prévoir une politique simple de nettoyage après l'événement.

Solution acceptable pour le MVP si elle passe les tests : stockage sur volume persistant de la VM. Un stockage objet externe est un enrichissement possible si sa mise en place est réellement plus sûre ou plus simple à exploiter.

## 10. Résilience

### Si l'IA ralentit

- nouvelles tâches en queue ;
- catalogue toujours disponible ;
- statut visible ;
- timeouts maîtrisés.

### Si l'IA tombe

- vendeur : message clair et possibilité de réessayer ; une saisie manuelle de secours peut être envisagée si elle reste simple ;
- assistant photo : indisponibilité explicite ;
- mini-marché : reste opérationnel.

### Si l'application redémarre

Le redémarrage doit être documenté et rapide. Les annonces déjà publiées restent en PostgreSQL. Les tâches IA en vol peuvent être perdues si la queue est volontairement non persistante ; cette conséquence doit être connue et acceptée ou corrigée selon les tests.

## 11. Observabilité

### Logs

Logs structurés avec au minimum :

- timestamp ;
- niveau ;
- composant ;
- event/request id si disponible ;
- durée ;
- statut ;
- code erreur sans secret.

Jamais de clé API dans les logs.

### Métriques principales

- requêtes / minute ;
- latence web ;
- latence IA ;
- taille queue ;
- temps d'attente queue ;
- tâches IA en cours ;
- succès / erreur / timeout ;
- CPU ;
- RAM ;
- nombre de publications ;
- nombre de recherches / scans.

### Dashboard admin

Doit permettre de répondre rapidement à :

- l'application est-elle vivante ?
- la VM est-elle saturée ?
- la queue grossit-elle ?
- l'IA répond-elle ?
- quel est le taux d'erreur ?

Pas besoin d'un outil d'observabilité lourd pour le MVP si un écran admin ou une solution légère suffit.

## 12. Analytics

Instrumenter via événements plutôt que via logique d'analyse embarquée. Les données seront exploitées après la brocante dans un notebook / pipeline data.

Événements clés :

```text
session_started
nav_opened
seller_photo_submitted
ai_analysis_started
ai_analysis_completed
listing_published
search_performed
listing_viewed
object_scan_completed
object_chat_question
fun_wish_selected
error_shown
```

Le showroom ajoute :

```text
demo_opened
feature_clicked
chat_started
message_count
demo_duration_s
demo_reset
```

## 13. Showroom — architecture spécifique

Le showroom doit rester très léger :

```text
UI riche
  -> datasets / JSON locaux ou embarqués
  -> scénarios déterministes
  -> animations / transitions
  -> [optionnel] LLM comédien
```

Le LLM comédien reçoit un état fictif mais **n'exécute aucune vraie action**.

Exemple de règle système conceptuelle :

```text
Tu joues l'assistant d'une démonstration fictive.
Tu peux raisonner et répondre à partir des données de démonstration fournies.
Tu ne disposes d'aucun accès réel à Gmail, calendrier, maison, CRM ou système externe.
Si une action est demandée, tu peux simuler le résultat dans la démo mais tu ne dois jamais prétendre qu'une action réelle a été effectuée.
```

## 14. Sécurité et secrets

- secrets uniquement via variables d'environnement / secret store adapté ;
- jamais dans le dépôt ;
- endpoint admin protégé de manière adaptée au contexte ;
- requêtes entrantes validées ;
- taille/type des images bornés ;
- rate limiting raisonnable si nécessaire ;
- ne pas exposer directement les ports internes inutiles de la VM ;
- Cloudflare constitue la façade publique prévue.

## 15. Principes de décision technique

1. Choisir la solution la plus simple qui satisfait un test réel.
2. Paramétrer les seuils plutôt que les coder en dur quand ils dépendent des quotas.
3. Ne pas ajouter une dépendance d'infrastructure sans raison mesurée.
4. Préférer un monolithe lisible à plusieurs services faiblement justifiés.
5. Conserver une frontière claire autour des appels IA pour pouvoir changer de modèle.
6. Tout composant critique doit avoir une stratégie de panne compréhensible.
7. Le test de charge tranche les débats de capacité ; les estimations seules ne suffisent pas.
