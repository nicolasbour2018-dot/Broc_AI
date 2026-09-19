# BrocAI — 10.8 Cloudflare permanent + Mac standby + control plane

## Architecture retenue

```text
                    Cloudflare
                       │
        brocai.example.tld (CNAME unique)
              ┌────────┴────────┐
              │ route active     │
              ▼                  ▼
       tunnel brocai-vps    tunnel brocai-mac
              │                  │
      127.0.0.1:8080      127.0.0.1:8081
              │                  │
            VPS             Mac standby

ops.example.tld
      │ Cloudflare Access
      ▼
tunnel brocai-ops
      ▼
127.0.0.1:8765
      ▼
control plane Mac
```

Le VPS et le Mac ont deux tunnels distincts. Le hostname public ne change jamais : le failover modifie uniquement la cible du CNAME Cloudflare entre `<VPS_UUID>.cfargotunnel.com` et `<MAC_UUID>.cfargotunnel.com`.

Aucun port BrocAI n'est ouvert publiquement sur le VPS ou le Mac. Le control plane n'expose jamais de terminal arbitraire.

## 1. SSH Mac → VPS sans mot de passe

Sur le Mac :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/brocai_vps_ed25519 -C "brocai-control-plane"
ssh-copy-id -i ~/.ssh/brocai_vps_ed25519.pub ubuntu@<VPS_IP>
ssh -i ~/.ssh/brocai_vps_ed25519 -o BatchMode=yes ubuntu@<VPS_IP> 'echo OK'
```

Si `ssh-copy-id` n'est pas disponible sur macOS :

```bash
cat ~/.ssh/brocai_vps_ed25519.pub | ssh ubuntu@<VPS_IP> 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

## 2. Créer les trois tunnels Cloudflare sur le Mac

Installer `cloudflared` :

```bash
brew install cloudflared
cloudflared tunnel login
```

Créer les tunnels localement gérés :

```bash
cloudflared tunnel create brocai-vps
cloudflared tunnel create brocai-mac
cloudflared tunnel create brocai-ops
cloudflared tunnel list
```

Noter les trois UUID. Les credentials JSON restent dans `~/.cloudflared/` et doivent être protégés (`chmod 600`).

Créer **une seule fois** le DNS public vers le VPS :

```bash
cloudflared tunnel route dns brocai-vps <PUBLIC_HOSTNAME>
```

Ne pas créer de route DNS publique pour `brocai-mac` : le script de failover modifie le CNAME existant via l'API Cloudflare.

## 3. Configurer le tunnel VPS

Copier le credential JSON du tunnel VPS vers le VPS :

```bash
scp -i ~/.ssh/brocai_vps_ed25519 ~/.cloudflared/<VPS_UUID>.json ubuntu@<VPS_IP>:/home/ubuntu/
```

Sur le VPS, après mise à jour du repo 10.8 :

```bash
cd /srv/brocai/app
sudo ./scripts/setup-vps-tunnel.sh <VPS_UUID> <PUBLIC_HOSTNAME> /home/ubuntu/<VPS_UUID>.json
rm -f /home/ubuntu/<VPS_UUID>.json
```

Le script :
- installe `cloudflared` depuis le dépôt officiel si nécessaire ;
- écrit `/etc/cloudflared/brocai-vps.yml` ;
- installe `cloudflared-brocai-vps.service` ;
- autorise uniquement deux commandes sudo non interactives pour le control plane : restart du tunnel et reboot du VPS.

## 4. Créer le token API Cloudflare minimal

Créer un API Token dédié au control plane avec au minimum `DNS Write` limité à la zone du hostname BrocAI. Relever également le `Zone ID`.

Le token API ne doit jamais être commité ni envoyé dans une conversation. Il reste uniquement dans `~/.config/brocai/ops.env` sur le Mac.

## 5. Configuration Ops sur le Mac

```bash
mkdir -p ~/.config/brocai
cp ops/ops.env.example ~/.config/brocai/ops.env
chmod 600 ~/.config/brocai/ops.env
nano ~/.config/brocai/ops.env
```

Remplir les IP/hostnames, UUID de tunnels, Zone ID, API token Cloudflare et un `BROCAI_OPS_TOKEN` aléatoire. Génération recommandée :

```bash
openssl rand -hex 32
```

## 6. Protéger le hostname Ops avant de créer son DNS

Dans Cloudflare Zero Trust, créer une application Access self-hosted pour `<OPS_HOSTNAME>` et une policy Allow limitée au compte / identité de l'opérateur.

Puis seulement :

```bash
cloudflared tunnel route dns brocai-ops <OPS_HOSTNAME>
```

La console demande en plus `BROCAI_OPS_TOKEN` : Cloudflare Access + token applicatif constituent deux barrières indépendantes.

## 7. Installer le Mac standby et les launch agents

Depuis le repo 10.8 sur le Mac :

```bash
./scripts/setup-mac-standby.sh
```

Le script prépare un clone indépendant dans `~/BrocAI-standby`, configure :
- tunnel `brocai-mac` ;
- tunnel `brocai-ops` ;
- control plane local `127.0.0.1:8765` ;
- synchronisation automatique toutes les 120 s ;
- BrocAI standby local sur `127.0.0.1:8081`.

La sync VPS → Mac se suspend automatiquement si le hostname public pointe vers le Mac, afin de ne jamais écraser les données produites pendant un failover.

Les syncs et transitions partagent un verrou d'opération inter-processus. Une transition déjà demandée bloque toute nouvelle sync, attend la fin d'une sync active, puis conserve le verrou jusqu'à stabilisation de l'origine publique.

## 8. Actions disponibles

La Console Ops expose uniquement :

```text
Sync now
Restart services
Restart tunnel
Reboot VPS
Failover → Mac
Failback → VPS
```

Les opérations destructrices exigent une confirmation explicite côté client et côté serveur. Les scripts sont idempotents autant que possible et écrivent une timeline JSONL dans `~/BrocAI-standby/state/ops-actions.jsonl`.

## 9. Sémantique failover / failback

### Failover VPS → Mac

1. acquiert le verrou de transition et attend la fin d'une éventuelle sync active ;
2. vérifie que le DNS pointe vers le VPS ;
3. arrête frontend et backend sur le VPS, en laissant PostgreSQL disponible ;
4. exécute une sync finale depuis PostgreSQL et le stockage persistant d'uploads du VPS ;
5. vérifie `READY` sur le Mac et le tunnel Mac ;
6. bascule le CNAME vers le tunnel Mac ;
7. vérifie `https://<PUBLIC_HOSTNAME>/health/ready` ;
8. restaure le VPS comme standby non public.

Avant la validation publique du Mac, toute erreur restaure les services et la route VPS, puis vérifie au mieux son état `READY`. Après cette validation, une erreur secondaire sur le standby VPS ne provoque plus de rollback du trafic.

### Failback Mac → VPS

Le failback est volontairement plus conservateur :

1. vérifie le VPS ;
2. coupe temporairement le tunnel public Mac (courte maintenance) ;
3. fige backend/frontend Mac ;
4. dump PostgreSQL + uploads Mac ;
5. restaure ces données sur le VPS ;
6. redémarre et valide le VPS ;
7. repointe le CNAME vers le tunnel VPS ;
8. valide publiquement le VPS, ce qui constitue le point de commit ;
9. remet le Mac en standby sans autoriser de rollback DNS après ce commit.

Ainsi, les écritures faites pendant un failover ne sont pas perdues.

Le control plane ne fixe pas de timeout de sous-processus pour `sync`, `failover` et `failback`, afin de laisser leurs traps terminer le cleanup ou le rollback. Les autres actions et le statut restent bornés. Le reboot VPS n'est déclaré réussi qu'après observation d'un nouvel identifiant de boot puis d'un état `READY`.

## 10. Critère de sortie 10.8

10.8 est validée seulement après un test réel téléphone/4G :
- hostname public stable ;
- VPS public nominal ;
- `standby_sync_age` inférieur à ~5 min ;
- console Ops accessible via Access ;
- failover VPS → Mac réussi avec le même QR/hostname ;
- publication d'une annonce sur Mac ;
- failback Mac → VPS avec l'annonce conservée ;
- restart service/tunnel et reboot VPS déclenchables depuis la console ;
- aucun port BrocAI exposé directement.
