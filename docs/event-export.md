# BrocAI — clôture événementielle et export 10.9

## État des données

| Donnée demandée | Source avant 10.9 | Complément 10.9 |
|---|---|---|
| Événements, annonces, jobs IA | PostgreSQL (`events`, `listings`, `ai_jobs`) et exports admin CSV/JSON | Bundle complet, résultat technique IA inclus, rétention des jobs portée de 12 h à 168 h |
| Scans assistant | PostgreSQL (`assistant_scans`) | Export CSV ajouté au bundle |
| Métriques système/provider/charge | Calcul instantané de `/api/admin/metrics` | Snapshot JSON PostgreSQL toutes les 20 s et CSV dérivés |
| Actions Ops | `state/ops-actions.jsonl` sur le Mac | Export CSV des champs autorisés uniquement |
| PostgreSQL et uploads | Synchronisation VPS → Mac de 10.8 | Dump et archive en lecture seule depuis l'origine publique active |
| Configuration événementielle | Compose, environnement actif et verrouillage benchmark | Quatre fichiers JSON sans secrets |

## Commande Mac

La commande de clôture est volontairement un CLI Mac, sans bouton ni nouvel endpoint Ops :

```bash
./scripts/export-event-bundle.sh 2026-09-20
```

Elle charge la configuration Ops existante, acquiert le verrou d'opération de 10.8, puis détermine la source active avec le mécanisme d'origine Cloudflare existant. Une origine `unknown` bloque l'export. Si le VPS est actif, les lectures passent par SSH ; si le Mac est actif, elles utilisent le Compose standby local.

Le checkout depuis lequel la commande est lancée doit correspondre au commit actif. Cette vérification lie les metadata de prix du dépôt au code réellement exporté et refuse un bundle construit par une version locale différente.

L'opération ne restaure rien, n'arrête aucun service, ne supprime aucune donnée et ne modifie ni PostgreSQL ni les uploads. Elle crée uniquement des fichiers privés sur le Mac. Le dump PostgreSQL et l'archive des uploads sont acquis séquentiellement sans rendre l'application indisponible ; ils ne constituent donc pas une transaction atomique commune si de nouvelles écritures arrivent exactement pendant l'export.

## Sécurité de création

La destination n'est pas paramétrable. Elle reste sous :

```text
${BROCAI_STANDBY_ROOT}/event-exports/brocai-event-YYYY-MM-DD/
```

Le script :

- accepte uniquement une date ISO réelle au format `YYYY-MM-DD` ;
- utilise un `umask 077`, des dossiers en mode `700` et des fichiers en mode `600` ;
- construit le bundle dans un staging privé, puis le publie par renommage dans le même parent ;
- refuse si le bundle final existe déjà et ne l'écrase jamais ;
- vérifie le dump PostgreSQL, les en-têtes CSV, l'archive uploads et tous les fichiers attendus ;
- n'extrait jamais l'archive uploads et rejette les chemins absolus, traversées `..`, liens et types spéciaux ;
- neutralise les préfixes de formule dans toutes les cellules CSV ;
- produit `SHA256SUMS` pour tous les fichiers de contenu du bundle ;
- ne copie aucun `.env`, log Docker, token, mot de passe, clé SSH ou credential Cloudflare.

Le manifeste peut être revérifié depuis la racine du bundle avec :

```bash
shasum -a 256 -c SHA256SUMS
```

## Arborescence produite

```text
brocai-event-2026-09-20/
├── SHA256SUMS
├── raw/
│   ├── postgres.dump
│   ├── uploads.tar
│   ├── events.csv
│   ├── ai_jobs.csv
│   ├── listings.csv
│   ├── assistant_scans.csv
│   ├── metric_snapshots.csv
│   └── ops_actions.csv
├── snapshots/
│   ├── system_metrics.csv
│   ├── provider_metrics.csv
│   └── load_states.csv
├── metadata/
│   ├── deployment.json
│   ├── models.json
│   ├── thresholds.json
│   └── pricing_snapshot.json
└── reports/
    └── bundle-summary.json
```

`pricing_snapshot.json` reprend uniquement les prix allowlistés dans les fichiers benchmark verrouillés du dépôt pour les modèles effectivement configurés. `ops_actions.csv` conserve seulement `timestamp`, `actor`, `action`, `target` et `result` ; le champ libre `details` et les clés inconnues ne sont pas exportés.

## Métriques snapshotées

Les snapshots réutilisent les calculs du monitoring admin : files CORE/FUN, jobs actifs, p50/p95 d'attente par file, p50/p95 d'inférence, charge CPU existante, RAM, disque des uploads, provider/modèle identifiable le plus récent, routage, RPM sur la dernière minute, erreurs, timeouts et 429 finaux identifiables, état de charge et état du fallback.

La valeur CPU reste le proxy existant basé sur la charge système à une minute rapportée au nombre de CPU ; ce n'est pas un échantillonnage direct du temps CPU.

Les champs suivants restent explicitement à `null` et sont listés dans `reports/bundle-summary.json` :

- `active_sessions` : seuls les démarrages de sessions cumulés existent, sans notion fiable de session encore active ;
- `tokens` : l'usage provider n'est pas conservé dans les résultats de jobs actuels ;
- `estimated_cost_usd` : impossible à reconstruire proprement sans les tokens ;
- `fun_cooldown_seconds` : aucun cooldown Fun effectif n'est implémenté dans le runtime actuel.

Une erreur de persistance d'un snapshot est journalisée avec une trace par le backend, mais ne coupe pas l'application. Les snapshots suivants continuent d'être tentés.

## Parcours P10/P11

Les événements `onboarding_viewed`, `onboarding_marketplace_clicked`, `marketplace_opened`, `marketplace_category_selected`, `batch_started`, `batch_completed` et `batch_published` complètent les événements existants `session_started`, `search_performed` et `listing_viewed`. L'export `events` existant conserve leurs propriétés JSON. `device_context` vaut `visitor` ou `seller` selon le stand confirmé sur l'appareil ; `seller_stand` est nul pour un visiteur. `entry_source` indique le point d'entrée dans le parcours. Sur `listing_viewed`, `listing_stand` provient de l'annonce en base et `is_own_listing` compare les deux stands. `batch_id` relie les étapes d'une série ; les tentatives de publication successives gardent le même identifiant.

Pour reconstruire l'ordre des actions d'une session dans PostgreSQL :

```sql
SELECT session_id, created_at, event_name,
       properties->>'device_context' AS device_context,
       properties->>'seller_stand' AS seller_stand,
       properties->>'entry_source' AS entry_source,
       properties->>'listing_stand' AS listing_stand,
       properties->>'is_own_listing' AS is_own_listing,
       properties->>'batch_id' AS batch_id
FROM events
WHERE session_id = :session_id
ORDER BY created_at, id;
```

La synthèse ci-dessous compte les sessions distinctes par contexte au moment de l'événement. Une sélection de catégorie ne compte pas comme une recherche saisie. Les étapes catégorie et recherche sont des branches possibles du parcours, pas une séquence obligatoire.

```sql
SELECT COALESCE(properties->>'device_context', 'unknown') AS device_context,
       COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'marketplace_opened') AS market_sessions,
       COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'marketplace_category_selected') AS category_sessions,
       COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'search_performed' AND (properties->>'query_length')::int > 0) AS search_sessions,
       COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'listing_viewed') AS listing_sessions,
       COUNT(*) FILTER (WHERE event_name = 'listing_viewed' AND properties->>'is_own_listing' = 'false' AND properties->>'device_context' IN ('visitor', 'seller')) AS qualified_views
FROM events
WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris')
GROUP BY 1;
```

La section « Parcours » du dashboard admin lit `GET /api/admin/journeys` avec le token admin. Elle présente les dernières 15 minutes et le cumul depuis minuit en heure de Paris ; elle est chargée à l'ouverture et actualisée toutes les 15 minutes. Les événements antérieurs à cette instrumentation restent « non classés » ; aucune valeur vendeur ou visiteur n'est déduite rétroactivement. Les compteurs de vues du vendeur et de son PDF excluent ces événements non classés ainsi que les vues de son propre stand. Sans authentification vendeur, `seller` désigne un appareil avec stand confirmé, pas une identité vérifiée.
