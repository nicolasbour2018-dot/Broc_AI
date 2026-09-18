# BrocAI — Étape 10
## Plan d’implémentation final : résilience, IA, charge, production et validation événementielle

**Échéance :** brocante de la Saint‑Fiacre d’Épernon — 20 septembre 2026  
**Statut :** cadrage terminé — Audits 1 à 5 verrouillés  
**Objectif :** transformer BrocAI en version événementielle exploitable, observable, résiliente et testée en conditions réalistes, sans élargir inutilement le périmètre fonctionnel.

---

# 0. Principes gelés avant implémentation

Les décisions suivantes sont **considérées comme validées** et ne doivent pas être rouvertes sans raison technique forte.

## Infrastructure

- **VPS-2 OVH** comme serveur principal de production.
- **Mac** comme :
  - standby synchronisé ;
  - control plane indépendant ;
  - serveur de secours en cas de failover.
- Une seule instance publique en écriture à la fois.
- Pas de réplication bidirectionnelle.
- Failover **semi-automatique**, déclenché manuellement depuis la console Ops.
- Failback assisté et volontairement moins automatique.
- URL publique / QR code **permanent** : l’adresse visible par les utilisateurs ne change jamais.
- Deux tunnels applicatifs distincts :
  - `brocai-vps`
  - `brocai-mac`
- Un tunnel indépendant pour la console Ops.
- En cas de crise, une courte maintenance propre est acceptable si elle évite une bascule dangereuse.

## IA

Architecture logique :

```text
modèle principal
    ↓ échec / quota / saturation
fallback indépendant
    ↓ échec
mode "brocante à l’ancienne"
```

Le modèle final n’est **pas encore figé**.

Candidats à benchmarker :
- Qwen multimodal ;
- Gemini 3.5 Flash-Lite ;
- Gemini 3.6 Flash ;
- GPT-5.6 Luna ;
- éventuellement DeepSeek multimodal si pertinent au moment du benchmark.

Principe :
> Le plus petit / rapide / économique modèle qui passe le benchmark métier gagne.

Le modèle plus puissant ne doit être utilisé que s’il apporte réellement une amélioration mesurable.

## Queue

Deux files logiques :

```text
CORE
- vendeur
- analyse acheteur
- éventuelle question libre critique

FUN
- analyse FunLab
- quête FunLab
```

Le FunLab exploite la capacité disponible mais ne doit jamais affamer CORE.

## FunLab

Une analyse initiale doit générer autant que possible :

```text
analyse de l’objet
+ création "Donne-moi vie"
+ création "Star"
+ création "Passé imaginaire"
+ création "Pouvoir secret"
```

Les boutons affichent ensuite des résultats déjà calculés.

Objectif :

```text
4 appels IA → 1 appel IA
```

La quête avec nouvelles photos reste un nouvel appel car elle apporte de nouvelles informations.

Cooldown anti-spam contrôlé côté serveur, avec identité anonyme persistante navigateur :

- NORMAL : ~60 s
- CHARGÉ : ~120 s
- FORTE CHARGE : ~180 s
- CRITIQUE : nouvelles analyses Fun temporairement suspendues

Valeurs à **tester**, pas à considérer comme définitives.

## Monitoring

La console doit être pensée comme une **console de surveillance opérationnelle**, pas comme une simple page de statistiques.

Elle doit afficher séparément :

- LIVE ;
- READY ;
- DIAGNOSTICS ;
- queue CORE ;
- queue FUN ;
- jobs actifs ;
- p50/p95 ;
- CPU ;
- RAM ;
- disque ;
- modèle/provider actif ;
- RPM / erreurs / 429 / timeout ;
- budget / tokens ;
- cooldown Fun ;
- provider fallback ;
- dernière synchro Mac ;
- âge du backup ;
- serveur public actuel ;
- timeline d’événements automatiques et manuels.

## Données événementielles

Toutes les données nécessaires au postmortem doivent être exportables et régulièrement copiées sur le Mac.

Objectif final :

```text
prévisions NORMAL / DIFFICILE / ÇA CARTONNE
                     VS
               ÉVÉNEMENT RÉEL
```

---

# 10.1 — Gel de la baseline et préparation de l’étape 10

## Objectif

Créer un point de départ propre avant toute modification structurelle.

## À faire

- Vérifier la branche / commit de référence.
- Vérifier :
  - frontend ;
  - backend ;
  - PostgreSQL ;
  - queue actuelle ;
  - admin ;
  - showroom ;
  - FunLab.
- Exécuter la suite de tests existante.
- Vérifier le fonctionnement réel actuel de Gemini / mock.
- Créer un tag ou commit de référence du type :

```text
pre-step-10-stable
```

- Sauvegarder une copie de la configuration locale utile.
- Vérifier que `.env` et les secrets restent exclus de Git.
- Documenter le point de reprise.

## Critère de sortie

BrocAI fonctionne exactement comme avant l’étape 10 et un rollback propre est possible.

---

# 10.2 — Prompt Lab + benchmark multi-modèles

## Objectif

Choisir les modèles sur mesures réelles plutôt que sur réputation ou benchmark généraliste.

## Corpus

Préparer environ **20 à 30 photos réelles** :

- objet facile ;
- objet ambigu ;
- mauvaise lumière ;
- photo chargée ;
- objet rare / inhabituel ;
- objet banal ;
- plusieurs catégories ;
- objets de faible valeur ;
- objets potentiellement de collection.

## Missions standardisées

Pour chaque modèle :

### Vendeur
- nom / titre ;
- description ;
- catégorie ;
- prix ;
- fourchette ;
- confiance ;
- hallucinations éventuelles.

### Assistant acheteur
- identification ;
- contexte ;
- prudence ;
- estimation ;
- qualité de la réponse.

### FunLab
- humour ;
- variété ;
- qualité de la punchline ;
- répétitions ;
- cohérence.

## Mesures techniques

Enregistrer pour chaque appel :

```text
provider
model
task
timestamp
input_tokens
output_tokens
thinking_tokens si disponibles
latency_ms
http_status
json_valid
parsed_ok
estimated_cost
raw_output
parsed_output
```

## Méthode

### Passe A — comparaison équitable

Même prompt sémantique pour tous.

### Passe B — prompt engineering

Seulement sur les 2 ou 3 meilleurs candidats.

Optimiser :
- prix de brocante réalistes ;
- style de description ;
- prudence ;
- humour ;
- ton ;
- concision ;
- stabilité JSON.

## Sortie attendue

Un rapport comparatif reproductible permettant de décider :

```text
principal
scale-up qualité
fallback indépendant
```

## Critère de sortie

Le choix final des modèles est justifié par :
- qualité ;
- latence ;
- coût ;
- quotas ;
- stabilité structurée.

---

# 10.3 — Optimisation du nombre d’inférences et des images

## Objectif

Réduire drastiquement coût, quota, congestion et latence avant d’augmenter la capacité.

## FunLab

Modifier l’analyse initiale pour produire un paquet complet :

```json
{
  "analysis": {},
  "fun": {
    "bring_to_life": {},
    "movie_star": {},
    "imaginary_past": {},
    "secret_power": {}
  }
}
```

Les boutons UI ne lancent plus d’inférence.

## Assistant acheteur

Évaluer la même logique pour les réponses prédéfinies :

- bonne affaire ;
- raconte-m’en plus ;
- négocie pour moi.

Si la qualité est suffisante :
- pré-générer ces réponses pendant l’analyse initiale ;
- conserver uniquement la vraie question libre comme appel supplémentaire.

## Images

Ajouter redimensionnement / compression avant envoi.

Cible initiale :
- grand côté ≈ 1024–1280 px ;
- qualité JPEG/WebP raisonnable ;
- conserver orientation correcte ;
- ne pas détériorer les cas métier.

## Télémétrie

Ajouter :
- taille image originale ;
- taille envoyée ;
- ratio de compression ;
- tokens visuels si exposés par le provider.

## Critère de sortie

Une session Fun classique nécessite **une seule inference** et la qualité visuelle reste suffisante.

---

# 10.4 — Couche multi-provider, routing et fallback IA

## Objectif

Décorréler BrocAI d’un fournisseur unique.

## À implémenter

Créer une abstraction provider homogène :

```text
analyze_seller()
analyze_object()
generate_fun_bundle()
answer_question()
```

Chaque provider doit exposer :
- timeout ;
- erreur normalisée ;
- usage tokens ;
- coût estimé ;
- modèle ;
- provider ;
- statut.

## Router

Logique :

```text
provider principal
    ↓
retry borné si pertinent
    ↓
fallback indépendant
    ↓
mode dégradé
```

Pas de boucle infinie.

## Circuit breaker

Déclencher protection si :
- 429 répétés ;
- timeout répétés ;
- erreurs 5xx ;
- provider inaccessible.

Prévoir hystérésis avant réactivation.

## Scale-up qualité

Optionnel selon benchmark :

```text
résultat low confidence
→ appel ponctuel modèle supérieur
```

Ne pas escalader automatiquement chaque requête.

## Mode "brocante à l’ancienne"

Si aucun provider n’est disponible :
- marché disponible ;
- recherche disponible ;
- publication vendeur possible en mode manuel ;
- message UX clair ;
- FunLab IA suspendu ;
- assistant IA suspendu.

## Critère de sortie

On peut provoquer la panne du provider principal et observer :
1. fallback ;
2. puis mode dégradé ;
sans casser le marché.

---

# 10.5 — Scheduler CORE / FUN + rate limiting adaptatif

## Objectif

Transformer la queue FIFO actuelle en ordonnanceur de production.

## Modèle

```text
Entrées
   ├── CORE
   └── FUN
          ↓
   Scheduler adaptatif
          ↓
 Provider rate limiter
          ↓
 Modèle / fallback
```

## Priorités

CORE doit être prioritaire.

FUN peut utiliser la capacité libre mais ne doit pas monopoliser les workers.

Valeurs de départ à tester sur une enveloppe théorique de 20 slots :

- NORMAL : FUN max ~12–14
- CHARGÉ : FUN max ~8
- FORTE CHARGE : FUN max ~3–4
- CRITIQUE : FUN = 0 nouvelle inference

Les valeurs finales dépendent du benchmark provider.

## Rate limiter provider

Le scheduler doit respecter :
- concurrence maximale ;
- RPM ;
- TPM si nécessaire ;
- budget / quota ;
- circuit breaker.

Un `MAX_AI_IN_FLIGHT=20` ne doit jamais signifier « envoyer 20 requêtes instantanément » si le fournisseur n’en accepte que 5/min.

## Cooldown Fun

Identity :
- UUID anonyme persistant ;
- `localStorage` côté navigateur ;
- validation **serveur**.

Recharger la page ou ouvrir un nouvel onglet ne doit pas contourner le cooldown.

## Hystérésis

Montée en protection rapide.

Descente plus lente.

Exemple :
- 2 mesures mauvaises → montée ;
- 2–3 min stables → descente.

## UX queue

Abandonner la position exacte si les priorités rendent celle-ci trompeuse.

Afficher plutôt :
- analyse en cours ;
- quelques secondes ;
- forte affluence ;
- FunLab temporairement en pause.

## Critère de sortie

Un flood FUN ne peut pas affamer CORE.

---

# 10.6 — Monitoring V2 / Console Ops applicative

## Objectif

Créer la vraie console de surveillance BrocAI.

## Trois endpoints visibles

### `/health/live`

Vérifie :
- processus backend vivant.

### `/health/ready`

Vérifie :
- backend ;
- PostgreSQL ;
- stockage ;
- composants nécessaires pour servir l’application.

En cas d’indisponibilité réelle :

```text
HTTP 503
```

### `/api/admin/diagnostics`

Expose :
- état CORE / FUN ;
- latence ;
- backlog ;
- providers ;
- rate limits ;
- fallback ;
- tokens ;
- budget ;
- CPU ;
- RAM ;
- disque ;
- sauvegardes ;
- cooldown ;
- mode dégradé.

## Console

Vue visuelle :

```text
LIVE          🟢
READY         🟢
DIAGNOSTICS   🟡

PUBLIC HOST   VPS
CORE          NORMAL
FUN           CHARGÉ
PROVIDER      Qwen
FALLBACK      READY
MAC SYNC      01:14 ago
```

## Timeline

Journaliser :

```text
timestamp
actor = automatic | Nicolas
action
target
reason
result
duration
details
```

Exemples :
- provider switch ;
- 429 ;
- FunLab bridé ;
- sync ;
- restart ;
- reboot ;
- failover ;
- failback.

## Critère de sortie

Une panne injectée doit être identifiable depuis la console sans lire les logs Docker.

---

# 10.7 — Déploiement production VPS-2

## Objectif

Mettre l’architecture finale sur le vrai serveur cible.

## VPS

Cible :
- OVH VPS-2 ;
- Docker / Docker Compose ;
- PostgreSQL ;
- backend ;
- frontend ;
- tunnel Cloudflare.

## Compose production

Ajouter notamment :
- `restart: unless-stopped` ;
- healthchecks pertinents ;
- volumes persistants ;
- secrets hors Git ;
- logs bornés ;
- ressources raisonnables.

## Données

Organisation recommandée :

```text
/srv/brocai/
├── app/
├── data/
│   ├── uploads/
│   └── backups/
└── .env
```

## Sécurité

- aucune clé dans Git ;
- SSH par clé ;
- limiter les ports entrants ;
- trafic web public via Cloudflare ;
- admin/ops non public sans authentification.

## Critère de sortie

Le VPS-2 supporte le scénario nominal et est administrable proprement.

---

# 10.8 — Cloudflare permanent + Mac standby + control plane

## Objectif

Garantir un QR permanent et pouvoir administrer / secourir BrocAI depuis le téléphone.

## Tunnels

Prévoir :

```text
brocai-vps
brocai-mac
brocai-ops
```

Le hostname public du QR ne change jamais.

Le routage bascule entre VPS et Mac.

## Mac standby

Le Mac reste :
- allumé ;
- branché ;
- connecté ;
- synchronisé.

## Synchronisation

Automatique toutes les ~2 min :

- dump PostgreSQL ;
- uploads ;
- données analytics ;
- état de configuration.

Mesurer :

```text
standby_sync_age
```

Warning si trop ancien.

## Scripts

Créer et tester :

```text
scripts/sync-standby.sh
scripts/restart-vps-services.sh
scripts/restart-vps.sh
scripts/failover-to-mac.sh
scripts/failback-to-vps.sh
```

Chaque script doit :
- vérifier les préconditions ;
- journaliser ;
- être idempotent autant que possible ;
- échouer proprement ;
- produire un résultat lisible.

## Console Ops

Hébergée sur le Mac, accessible depuis téléphone via tunnel privé.

Actions autorisées uniquement via boutons bornés :
- Sync now ;
- restart services ;
- restart tunnel ;
- reboot VPS ;
- failover Mac ;
- failback VPS.

Pas de terminal shell arbitraire exposé au web.

## Critère de sortie

Depuis un téléphone en 4G, on peut diagnostiquer et relancer BrocAI sans toucher physiquement au Mac.

---

# 10.9 — Backups, export et Event Data / Postmortem

## Objectif

Garantir qu’après l’événement on puisse reconstruire précisément ce qui s’est passé.

## Raw datasets

Exporter au minimum :

```text
events.csv
ai_jobs.csv
listings.csv
system_metrics.csv
provider_metrics.csv
ops_actions.csv
load_states.csv
```

## Snapshots temporels

Toutes les 10–30 secondes environ :

```text
timestamp
active_sessions
queued_core
queued_fun
running_core
running_fun
core_wait_p50
core_wait_p95
fun_wait_p50
fun_wait_p95
inference_p50
inference_p95
cpu
ram
disk
provider
model
rpm
429
timeouts
tokens
estimated_cost
load_state
fun_cooldown
fallback_state
```

## Metadata

Conserver la configuration de la journée :

```text
deployment.json
models.json
thresholds.json
pricing_snapshot.json
```

Sans cela, l’analyse postérieure perdrait son contexte.

## Bundle final

Arborescence cible :

```text
brocai-event-2026-09-20/
├── raw/
├── snapshots/
├── reports/
└── metadata/
```

## Bouton final

Console Ops :

```text
Clôturer l’événement et exporter
```

Doit :
1. prendre dump DB ;
2. synchroniser images ;
3. exporter datasets ;
4. figer configuration ;
5. produire agrégats ;
6. vérifier intégrité ;
7. sauvegarder le bundle sur Mac.

Ne rien supprimer du VPS.

## Vie privée

Ne pas enregistrer d’IP inutile.

Utiliser identifiants pseudonymes/anonymes uniquement.

## Critère de sortie

Toutes les données nécessaires au postmortem existent sur le Mac même si le VPS disparaît après l’événement.

---

# 10.10 — Campagne de tests intégrés

## Principe

Le stress test lourd utilise majoritairement un provider simulé reproduisant :
- latence réelle ;
- 429 ;
- timeout ;
- erreurs ;
- limites observées.

Une campagne plus petite utilise les vraies APIs.

## Scénario A — NORMAL

Objectif :
- usage réaliste ;
- aucune protection inutile.

Tester :
- vendeurs ;
- acheteurs ;
- marché ;
- FunLab ;
- admin ;
- showroom.

Attendu :
- queue quasi vide ;
- p95 faible ;
- aucun fallback ;
- FunLab NORMAL.

## Scénario B — DIFFICILE

Objectif :
- environ 150 sessions concurrentes ;
- burst IA ;
- Fun flood important ;
- CORE arrive pendant le flood.

Attendu :
- CORE prioritaire ;
- FUN bridé ;
- catalogue intact ;
- queue stable ;
- monitoring cohérent.

## Scénario C — ÇA CARTONNE !!

Objectif :
- dépasser volontairement la cible ;
- 300 sessions puis montée progressive ;
- éventuellement 500 si le système tient ;
- énorme backlog Fun.

But :
> Trouver le point de rupture réel.

Mesurer :
- CPU ;
- RAM ;
- RPS ;
- p95 ;
- queue ;
- erreurs ;
- moment de fermeture Fun ;
- moment où CORE commence à souffrir.

---

# 10.11 — Chaos IA

## Tests

Injecter successivement :

```text
latence élevée
429
timeout
5xx
JSON invalide
provider down
fallback down
```

## Attendu

```text
principal
→ fallback
→ mode brocante à l’ancienne
```

Le marché doit rester accessible.

Le système ne doit pas amplifier une panne par des retries agressifs.

---

# 10.12 — Chaos infrastructure

## Tests

### Backend

Tuer brutalement le backend.

Vérifier :
- détection ;
- restart ;
- récupération des jobs persistants.

### PostgreSQL

Arrêter DB.

Vérifier :
- READY = 503 ;
- diagnostic précis ;
- récupération.

### Tunnel

Arrêter `cloudflared`.

Vérifier :
- diagnostic distinct ;
- restart possible.

### VPS

Simuler panne totale.

Depuis téléphone :
1. ouvrir console Ops ;
2. vérifier dernier backup ;
3. vérifier Mac READY ;
4. déclencher failover ;
5. chronométrer ;
6. réouvrir **le même QR en 4G** ;
7. publier une annonce ;
8. vérifier qu’elle existe sur le Mac.

Objectifs :

```text
RPO cible ≈ 2 min
RTO cible ≤ 5 min
```

---

# 10.13 — Test "téléphone uniquement"

## Objectif

Prouver que l’exploitation distante est réellement utilisable le jour J.

Fermer le portable utilisé sur le stand.

Depuis le téléphone uniquement :

- vérifier LIVE ;
- vérifier READY ;
- lire DIAGNOSTICS ;
- voir queue CORE/FUN ;
- voir provider ;
- voir sync Mac ;
- lancer sync ;
- restart backend ;
- restart tunnel ;
- reboot VPS si nécessaire ;
- déclencher failover.

## Critère de sortie

Aucune action opérationnelle critique normale ne nécessite un terminal local.

---

# 10.14 — Rapport de readiness

À l’issue de la campagne, générer automatiquement un rapport comparable au format :

```text
BROCAI EVENT READINESS

NORMAL                         PASS
LOAD 150                       PASS
STRESS 300                     PASS
FUN FLOOD                      PASS
CORE PRIORITY                  PASS
PRIMARY PROVIDER FAILURE       PASS
FALLBACK                       PASS
DEGRADED MODE                  PASS
BACKEND CRASH RECOVERY         PASS
POSTGRES RECOVERY              PASS
CLOUDFLARE RECOVERY            PASS
VPS → MAC FAILOVER             PASS
PHONE-ONLY OPERATIONS          PASS

Observed RTO: ...
Observed RPO: ...
Observed break point: ...
AI cost during tests: ...
Residual risks: ...
```

---

# 10.15 — GO / NO-GO final

## Bloquants NO-GO

Ne pas considérer BrocAI prêt si l’un des points suivants subsiste :

- perte de données ;
- queue non récupérable ;
- CORE affamé par FUN ;
- fallback IA inutilisable ;
- mode dégradé cassé ;
- failover Mac non testé ;
- QR pouvant devenir obsolète ;
- monitoring incapable d’identifier une panne critique ;
- console Ops inaccessible à distance ;
- exports événementiels incomplets.

## Non-bloquants possibles

Peuvent rester imparfaits :
- humour FunLab ;
- petites imperfections visuelles ;
- formulations ;
- micro-optimisations non critiques.

Priorité absolue :
> résilience du cœur avant perfection esthétique.

---

# 10.16 — Jour J

## Avant ouverture

- vérifier VPS ;
- vérifier Mac standby ;
- sync manuelle ;
- vérifier tunnels ;
- vérifier console Ops ;
- vérifier modèles ;
- vérifier budget ;
- vérifier QR en 4G ;
- exporter un snapshot initial.

## Pendant

Surveiller principalement :
- READY ;
- CORE p95 ;
- FUN state ;
- provider ;
- fallback ;
- 429 ;
- coût ;
- sync age ;
- CPU/RAM ;
- timeline.

Ne pas intervenir si les protections automatiques fonctionnent correctement.

## Incident

Ordre logique :

```text
identifier
→ laisser les protections automatiques agir
→ restart service si nécessaire
→ reboot VPS si nécessaire
→ failover Mac en dernier recours infra
```

## Fin

Déclencher :

```text
Clôturer l’événement et exporter
```

---

# 10.17 — Postmortem après la brocante

Comparer :

```text
NORMAL prévu
DIFFICILE prévu
ÇA CARTONNE prévu
ÉVÉNEMENT RÉEL
```

Analyser notamment :

- fréquentation BrocAI ;
- taux d’usage par module ;
- FunLab ;
- publications ;
- recherches ;
- pics ;
- queue ;
- p95 ;
- CPU/RAM ;
- providers ;
- coûts ;
- throttling ;
- fallbacks ;
- erreurs ;
- interventions ;
- éventuel failover.

Questions finales :

1. Le dimensionnement était-il correct ?
2. Quel a été le vrai facteur limitant ?
3. Le FunLab a-t-il généré plus de charge que prévu ?
4. Le cœur a-t-il été correctement protégé ?
5. Quel modèle a offert le meilleur ratio qualité/coût ?
6. Les cooldowns étaient-ils trop forts ou trop faibles ?
7. Quelle capacité maximale réelle a été observée ?
8. Quelle évolution serait nécessaire pour transformer BrocAI en produit réutilisable ?

---

# Ordre d’exécution recommandé

```text
10.1  Baseline / rollback
10.2  Prompt Lab & benchmark modèles
10.3  Optimisation des inférences / images
10.4  Multi-provider / fallback
10.5  Scheduler CORE/FUN / cooldown / rate limit
10.6  Monitoring V2
10.7  VPS-2 production
10.8  Cloudflare + Mac standby + control plane
10.9  Data / backups / postmortem
10.10 Tests NORMAL / DIFFICILE / ÇA CARTONNE
10.11 Chaos IA
10.12 Chaos infrastructure
10.13 Test téléphone uniquement
10.14 Readiness report
10.15 GO / NO-GO
10.16 Jour J
10.17 Postmortem
```

---

# Dépendances importantes

```text
10.2 ─┐
10.3 ─┼→ 10.4 → 10.5 → 10.6
      │
10.7 ─┴→ 10.8 → 10.9
                    ↓
              10.10–10.14
                    ↓
                  10.15
                    ↓
                  10.16
                    ↓
                  10.17
```

Le benchmark modèle doit être suffisamment avancé avant de figer le routing, mais il ne doit pas bloquer la préparation du VPS.

---

# Principe directeur de l’étape 10

> Ne pas chercher à rendre BrocAI impossible à casser.  
> Chercher à savoir exactement comment il se comporte sous pression, protéger le cœur, dégrader proprement les fonctions non essentielles, rendre chaque panne visible et disposer d’un chemin de récupération simple.

---

# Point de reprise pour une nouvelle conversation

Message conseillé :

> Nous reprenons BrocAI à l’étape 10. Les audits 1 à 5 sont terminés et verrouillés. Le plan d’implémentation officiel est le fichier `BrocAI_Etape_10_Plan_Implementation.md`. Ne réouvre pas les arbitrages déjà actés sauf blocage technique démontré. Commence par l’étape 10.1, vérifie le repo actuel avant toute modification et avance tranche par tranche avec critères de sortie explicites. La priorité est de livrer une version événementielle fiable pour la brocante du 20 septembre 2026.
