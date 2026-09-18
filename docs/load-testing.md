# Étape 7 — charge, rafales et résilience

Ce protocole teste BrocAI sans toucher à la base PostgreSQL ni aux images de l'application réelle.

Le fichier `docker-compose.loadtest.yml` démarre uniquement un backend et un PostgreSQL dédiés au test. Utiliser **toujours** le nom de projet Compose `brocai-step7` dans les commandes ci-dessous : les volumes créés appartiennent alors exclusivement à cette campagne de test.

Le fournisseur IA est le provider `mock`. Deux variables réservées aux tests permettent de simuler un fournisseur lent ou indisponible :

- `AI_MOCK_DELAY_MS` : délai artificiel avant chaque réponse mock ;
- `AI_MOCK_FORCE_ERROR=1` : erreur fournisseur forcée après ce délai.

Ces variables n'ont aucun effet sur Gemini et ne sont pas nécessaires dans le `.env` réel.

## 1. Démarrage de la stack isolée

Depuis la racine du repo :

```bash
mkdir -p load-test-results

docker compose -p brocai-step7 -f docker-compose.loadtest.yml up -d --build

curl -fsS http://localhost:18000/health
```

La configuration de départ est volontairement proche du jour J : `MAX_AI_IN_FLIGHT=20` et 1,5 s de latence IA simulée.

## 2. Catalogue / recherche — 150 utilisateurs simultanés

```bash
python3 scripts/load_test.py \
  --output load-test-results/catalogue.json \
  catalogue --requests 1000 --concurrency 150

python3 scripts/load_test.py \
  --output load-test-results/mixed-150.json \
  mixed --sessions 150 --concurrency 150
```

Le runner sort avec un code non nul s'il rencontre une erreur HTTP.

À relever : débit, p95/p99, erreurs et comportement du dashboard admin.

## 3. Rafale IA et queue > 20

```bash
python3 scripts/load_test.py \
  --output load-test-results/queue-60.json \
  queue-burst \
  --count 60 \
  --concurrency 60 \
  --admin-token loadtest-only \
  --min-peak-queue 20
```

Le test valide automatiquement :

- les 60 jobs sont acceptés ;
- ils finissent tous en `success` ;
- le pic de queue atteint au moins 20 ;
- le nombre de jobs `running` ne dépasse jamais `MAX_AI_IN_FLIGHT`.

## 4. Parcours vendeur complet sous concurrence

Ce test fait réellement `photo -> queue -> brouillon -> publication`, mais uniquement dans la base de test isolée.

```bash
python3 scripts/load_test.py \
  --output load-test-results/seller-30.json \
  seller-flow --count 30 --concurrency 20
```

Les 30 annonces de test ne touchent pas aux annonces réelles.

## 5. Fournisseur IA en erreur

Recréer seulement le backend de test avec les erreurs mock forcées :

```bash
AI_MOCK_FORCE_ERROR=1 \
docker compose -p brocai-step7 -f docker-compose.loadtest.yml \
  up -d --force-recreate backend-loadtest
```

Puis :

```bash
python3 scripts/load_test.py \
  --output load-test-results/provider-error.json \
  queue-burst \
  --count 30 \
  --concurrency 30 \
  --admin-token loadtest-only \
  --expect error \
  --min-peak-queue 1

curl -fsS http://localhost:18000/api/listings >/dev/null && echo "Catalogue OK pendant panne IA"
```

Le point important n'est pas seulement que les jobs échouent proprement : le catalogue doit rester disponible.

Rétablir ensuite le provider mock normal :

```bash
AI_MOCK_FORCE_ERROR=0 \
docker compose -p brocai-step7 -f docker-compose.loadtest.yml \
  up -d --force-recreate backend-loadtest
```

## 6. Crash / reprise des jobs PostgreSQL

Pour rendre l'état `running` facile à observer, ralentir fortement l'IA et réduire les slots :

```bash
AI_MOCK_DELAY_MS=5000 LOADTEST_MAX_AI_IN_FLIGHT=2 \
docker compose -p brocai-step7 -f docker-compose.loadtest.yml \
  up -d --force-recreate backend-loadtest
```

Avant le crash, mémoriser aussi le nombre d'annonces présentes dans la base de test :

```bash
BEFORE_LISTINGS="$(curl -fsS http://localhost:18000/api/listings | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
echo "Annonces avant crash: $BEFORE_LISTINGS"
```

Soumettre 12 jobs sans attendre leur fin :

```bash
python3 scripts/load_test.py \
  queue-burst \
  --count 12 \
  --concurrency 12 \
  --admin-token loadtest-only \
  --submit-only \
  --jobs-file load-test-results/restart-jobs.json
```

Simuler ensuite un crash brutal du backend, pas un arrêt gracieux :

```bash
docker compose -p brocai-step7 -f docker-compose.loadtest.yml kill -s KILL backend-loadtest

docker compose -p brocai-step7 -f docker-compose.loadtest.yml up -d backend-loadtest
```

Puis vérifier que les jobs `running` laissés par le crash sont repris et terminent :

```bash
python3 scripts/load_test.py \
  --output load-test-results/restart-recovery.json \
  resume \
  --jobs-file load-test-results/restart-jobs.json \
  --expect success

AFTER_LISTINGS="$(curl -fsS http://localhost:18000/api/listings | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
echo "Annonces après crash: $AFTER_LISTINGS"
test "$BEFORE_LISTINGS" = "$AFTER_LISTINGS" && echo "Persistance annonces OK"
```

Cette séquence vérifie à la fois la persistance des annonces et le mécanisme déjà présent dans `AiQueueService.start()`, qui repasse les anciens jobs `running` en `queued` au redémarrage.

## 7. Soak test mémoire

Revenir à la configuration normale de test :

```bash
AI_MOCK_DELAY_MS=1500 LOADTEST_MAX_AI_IN_FLIGHT=20 \
docker compose -p brocai-step7 -f docker-compose.loadtest.yml \
  up -d --force-recreate backend-loadtest
```

Puis lancer au moins 10 minutes :

```bash
python3 scripts/load_test.py \
  --output load-test-results/soak-10min.json \
  soak --duration 600 --concurrency 30 --admin-token loadtest-only
```

Le rapport inclut le pic de RAM du process backend et la charge système observée. Pour la répétition finale, 20 à 30 minutes est préférable si le temps le permet.

## 8. Lecture directe du dashboard

```bash
curl -fsS \
  -H 'X-Admin-Token: loadtest-only' \
  http://localhost:18000/api/admin/metrics \
  | python3 -m json.tool
```

## 9. Seuils de décision pragmatiques

Ils ne constituent pas un SLA : ils servent à repérer rapidement un comportement dangereux avant la brocante.

- catalogue/recherche : zéro erreur sur la campagne locale ;
- 150 sessions concurrentes : pas de crash backend ou PostgreSQL ;
- queue : `running <= MAX_AI_IN_FLIGHT` en permanence ;
- panne IA : catalogue toujours disponible ;
- restart : jobs persistés récupérés après crash ;
- soak : pas de croissance mémoire continue évidente ni de saturation durable.

Les p95/p99 réels doivent être consignés dans les rapports plutôt que d'inventer un seuil absolu avant mesure.

## 10. Test final via Cloudflare

Une fois les tests locaux verts, les scénarios **catalogue** et **mixed** peuvent être relancés contre l'URL publique avec `--base-url` :

```bash
python3 scripts/load_test.py \
  --base-url https://URL-PUBLIQUE-BROCAI \
  --output load-test-results/public-mixed-150.json \
  mixed --sessions 150 --concurrency 150
```

Ne pas lancer `queue-burst` ou `seller-flow` contre la production avec Gemini simplement pour tester la charge : cela consommerait inutilement le quota et polluerait les données réelles.

## 11. Nettoyage

Cette commande supprime uniquement la stack et les volumes du projet de test `brocai-step7` :

```bash
docker compose -p brocai-step7 -f docker-compose.loadtest.yml down -v
```

Ne jamais ajouter `-v` à la commande `docker compose down` de la stack BrocAI réelle.
