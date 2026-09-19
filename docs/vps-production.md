# BrocAI — VPS production (étape 10.7)

Cette procédure prépare et déploie BrocAI sur le VPS de production sans encore créer le routage Cloudflare permanent ni le failover Mac. Ces éléments appartiennent à l'étape 10.8.

## Architecture 10.7

```text
Internet
   X   (pas encore d'exposition publique directe)

VPS
└── 127.0.0.1:8080
    └── nginx / frontend
        ├── /api/*     -> backend:8000
        ├── /media/*   -> backend:8000
        └── /health/*  -> backend:8000

Docker network privé
├── frontend
├── backend
└── postgres

/srv/brocai/
├── app/                 checkout Git
├── data/
│   ├── postgres/
│   ├── uploads/
│   └── backups/
└── .env                 secrets production, hors Git
```

Le seul port applicatif publié par Compose est lié à `127.0.0.1`. PostgreSQL et le backend ne publient aucun port hôte. Le tunnel Cloudflare de 10.8 pointera ensuite vers cette entrée locale.

## Cible de ressources

La configuration Compose est volontairement conservatrice pour une machine d'environ 4 vCPU / 8 Go de RAM :

- PostgreSQL : 1 vCPU, 1.5 Go maximum ;
- backend : 2.25 vCPU, 3.5 Go maximum ;
- frontend nginx : 0.5 vCPU, 512 Mo maximum ;
- le reste reste disponible pour le système, Docker, les builds et le futur tunnel Cloudflare.

Ces limites sont des garde-fous, pas des réservations.

## 1. Provisionner le VPS

Pour l'événement, privilégier une Ubuntu LTS minimale et une authentification SSH par clé. Ne pas installer d'environnement graphique ni de panneau d'administration web.

Après le premier accès SSH :

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git
```

Installer Docker Engine et le plugin Docker Compose depuis le dépôt officiel Docker pour la version Ubuntu choisie, puis vérifier :

```bash
docker --version
docker compose version
sudo systemctl status docker --no-pager
```

Ajouter l'utilisateur d'exploitation au groupe Docker si nécessaire, puis fermer et rouvrir la session SSH :

```bash
sudo usermod -aG docker "$USER"
```

## 2. Préparer l'arborescence

```bash
sudo mkdir -p /srv/brocai
sudo chown "$USER":"$USER" /srv/brocai
```

Cloner ensuite le dépôt dans `/srv/brocai/app` avec le mode d'authentification GitHub approprié au dépôt :

```bash
cd /srv/brocai
git clone <REPOSITORY_URL> app
cd app
git switch step10.7-vps-production
```

Vérifier le point de départ :

```bash
git status --short --branch
git log -3 --oneline --decorate
```

## 3. Installer la configuration secrète

Le vrai fichier de production reste en dehors du checkout Git :

```bash
cp /srv/brocai/app/.env.production.example /srv/brocai/.env
chmod 600 /srv/brocai/.env
nano /srv/brocai/.env
```

Remplacer impérativement :

- `POSTGRES_PASSWORD` ;
- `GEMINI_API_KEY` ;
- `HF_TOKEN` ;
- `ADMIN_TOKEN`.

Garder pour 10.7 :

```text
BROCAI_DATA_DIR=/srv/brocai/data
APP_BIND_HOST=127.0.0.1
APP_PORT=8080
AI_PROVIDER=gemini
AI_ROUTING_MODE=auto
```

Ne pas mettre `APP_BIND_HOST=0.0.0.0` pour « tester rapidement ». Le test distant se fait par tunnel SSH jusqu'à la mise en place de Cloudflare en 10.8.

## 4. Déployer

Depuis le checkout propre :

```bash
cd /srv/brocai/app
./scripts/deploy-vps.sh
```

Le script :

1. refuse un working tree Git sale ;
2. vérifie les secrets obligatoires ;
3. crée les répertoires persistants ;
4. valide le Compose ;
5. build les images ;
6. démarre les services avec `restart: unless-stopped` ;
7. attend `LIVE` et `READY` ;
8. affiche l'état final des conteneurs.

Il ne supprime aucun volume et ne lance aucun `docker system prune`.

## 5. Vérifier sur le VPS

```bash
curl -fsS http://127.0.0.1:8080/health/live
curl -fsS http://127.0.0.1:8080/health/ready

docker compose \
  --env-file /srv/brocai/.env \
  -f /srv/brocai/app/docker-compose.prod.yml \
  ps
```

Attendu :

- `postgres` healthy ;
- `backend` healthy ;
- `frontend` healthy ;
- `LIVE` = ok ;
- `READY` = ok avec PostgreSQL et stockage disponibles.

## 6. Tester depuis le Mac sans ouvrir le VPS au public

Depuis le Mac, ouvrir un tunnel SSH temporaire :

```bash
ssh -L 8080:127.0.0.1:8080 <VPS_USER>@<VPS_IP>
```

Puis ouvrir `http://localhost:8080` dans le navigateur local. Ce tunnel est uniquement un outil de validation de 10.7 ; il ne remplace pas le tunnel Cloudflare de production.

Tester au minimum :

- accueil ;
- catalogue ;
- publication vendeur ;
- une analyse IA réelle ;
- console Ops ;
- `/health/live` ;
- `/health/ready`.

## 7. Sécurité réseau avant 10.8

Le VPS doit accepter SSH uniquement selon la configuration choisie. Avant d'activer un firewall, vérifier le port réellement utilisé par SSH afin de ne pas se verrouiller dehors.

Le compose production n'expose ni PostgreSQL ni le backend et lie nginx à l'interface loopback. Ne pas ajouter de publication `5432`, `8000` ou `8080` sur `0.0.0.0`.

Docker gère ses propres règles réseau ; ne pas supposer qu'un firewall hôte corrige une publication Docker trop permissive. La première protection est ici l'absence de publication publique dans `docker-compose.prod.yml`.

## 8. Logs et diagnostic

Les logs Docker utilisent une rotation bornée (`10m`, 3 fichiers par service).

Commandes utiles :

```bash
docker compose --env-file /srv/brocai/.env -f docker-compose.prod.yml ps

docker compose --env-file /srv/brocai/.env -f docker-compose.prod.yml logs --tail=100 backend

docker compose --env-file /srv/brocai/.env -f docker-compose.prod.yml logs --tail=100 frontend

docker compose --env-file /srv/brocai/.env -f docker-compose.prod.yml logs --tail=100 postgres
```

La Console Ops reste la source de diagnostic applicatif normale ; les logs Docker servent au diagnostic bas niveau.

## 9. Mise à jour contrôlée

Une fois un nouveau commit validé et poussé :

```bash
cd /srv/brocai/app
git fetch origin
git switch step10.7-vps-production
git pull --ff-only
./scripts/deploy-vps.sh
```

Aucun déploiement ne doit être fait depuis un checkout contenant des changements locaux.

## 10. Critère de sortie 10.7

L'étape 10.7 est validée lorsque :

- le VPS exécute PostgreSQL, backend et frontend en continu ;
- les trois conteneurs redémarrent automatiquement après un restart Docker/VPS ;
- les données PostgreSQL et les uploads sont sous `/srv/brocai/data` ;
- `LIVE` et `READY` sont verts ;
- une requête IA réelle fonctionne depuis le VPS ;
- l'application complète est testable depuis le Mac via tunnel SSH ;
- aucun secret n'est dans Git ;
- aucun port applicatif n'est exposé publiquement ;
- les logs sont bornés ;
- le repo VPS est propre et correspond à un commit identifiable.

Après validation, créer un tag de checkpoint avant d'entamer 10.8.
