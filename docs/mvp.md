# Brocai — plan MVP

> Objectif : fournir au harnais un ordre d'exécution clair. Chaque étape doit produire un résultat testable. Éviter les longues phases de construction technique sans parcours utilisateur fonctionnel.

## 0. Règle générale d'exécution

Construire **verticalement** : une fonctionnalité doit traverser l'interface, la logique, la donnée et les erreurs avant de passer à la suivante.

Priorité permanente :

1. fiabilité ;
2. parcours vendeur ;
3. mini-marché acheteur ;
4. assistant photo ;
5. queue / résilience ;
6. instrumentation ;
7. test de charge ;
8. showroom ;
9. bloc fun.

## Étape 0 — Freeze du scope

### Livrables

- backlog `MVP` ;
- backlog `POST-MVP` ;
- liste des arbitrages encore ouverts ;
- maquettes très grossières des écrans principaux ;
- choix du front à utiliser pour la V1.

### Arbitrages à résoudre au plus tôt

- Streamlit ou front web léger ;
- modèle / fournisseur multimodal après petit benchmark réel ;
- stratégie de stockage d'images ;
- implémentation minimale de la queue.

### Critère de sortie

Aucun point ambigu ne doit empêcher de commencer la tranche vendeur.

---

## Étape 1 — Socle déployable

### Construire

- structure du projet ;
- configuration / variables d'environnement ;
- connexion PostgreSQL ;
- squelette de l'application ;
- healthcheck ;
- VM ;
- Cloudflare Tunnel persistant ;
- premiers logs structurés.

### Ne pas faire à cette étape

- architecture distribuée ;
- microservices ;
- back-office ;
- optimisation prématurée.

### Critère de sortie

Une URL publique ouvre l'application, le healthcheck répond et l'application peut lire/écrire dans PostgreSQL.

---

## Étape 2 — Parcours vendeur end-to-end

### Construire dans cet ordre

1. prise / import de photo ;
2. envoi à l'analyse multimodale ;
3. retour structuré ;
4. formulaire prérempli ;
5. édition de tous les champs ;
6. numéro de stand obligatoire ;
7. pseudo facultatif ;
8. publication ;
9. confirmation et fiche annonce.

### Première version acceptable de l'IA

- titre ;
- description ;
- catégorie ;
- prix indicatif ;
- confiance.

Pas besoin de perfectionner le ton fun avant que le flux complet fonctionne.

### Critère de sortie

Depuis un téléphone, une photo peut devenir une annonce réellement stockée et visible dans l'application.

---

## Étape 3 — Mini-marché acheteur

### Construire

- liste/grille des annonces ;
- fiche annonce ;
- recherche mots-clés ;
- affichage clair du prix et du numéro de stand ;
- catégorie si fiable ;
- pagination/limite simple si nécessaire.

### Contraintes

- zéro LLM ;
- zéro compte ;
- requêtes simples ;
- mobile-first.

### Critère de sortie

Un utilisateur peut chercher un objet, ouvrir sa fiche et savoir où aller sur la brocante.

---

## Étape 4 — Assistant photo acheteur

### Sous-étape A — Analyse automatique

Photo → fiche courte :

- nom ;
- catégorie ;
- description ;
- usage/style/époque avec prudence ;
- estimation indicative ;
- confiance.

### Sous-étape B — Trois vœux / questions

- trois demandes maximum par objet ;
- presets `Bonne affaire ?`, `Raconte-m'en plus`, `Négocie pour moi` ;
- champ libre ;
- contexte limité à l'objet courant ;
- compteur visible ;
- reset propre lorsqu'on change d'objet.

### Critère de sortie

La limite est réellement appliquée et l'utilisateur comprend clairement combien de demandes lui restent.

---

## Étape 5 — Queue IA et résilience

### Hypothèse de départ

- **20 tâches IA simultanées maximum** ;
- tâches supplémentaires en file ;
- ce nombre est un paramètre de départ, pas une vérité technique.

### Construire

- état d'une tâche : `queued`, `running`, `success`, `error`, éventuellement `timeout` ;
- indication de file utile ;
- ETA arrondie uniquement si elle peut être calculée proprement ;
- timeouts ;
- retry limité si pertinent ;
- gestion explicite des erreurs fournisseur ;
- séparation stricte : une panne IA ne bloque pas le catalogue.

### Critère de sortie

Un pic simulé d'analyses ne bloque pas l'application entière et les utilisateurs en attente voient un état cohérent.

---

## Étape 6 — Instrumentation minimale

### Produit

Émettre les événements critiques définis dans `cahier_des_charges.md`.

### Technique

Mesurer au minimum :

- latence IA ;
- longueur de queue ;
- temps d'attente ;
- erreurs ;
- nombre d'appels ;
- latence catalogue/recherche ;
- CPU / RAM.

### Mini-dashboard admin

Afficher au minimum :

- état du service ;
- queue actuelle ;
- appels récents / volume ;
- latence récente ;
- taux d'erreur ;
- état VM.

Le dashboard doit être fonctionnel, pas sophistiqué.

### Critère de sortie

Chaque flux critique produit des données exploitables et un export CSV/JSON est possible.

---

## Étape 7 — Charge, rafales et répétition technique

### Test global

Cible : **150 sessions/utilisateurs simultanés** sur le parcours global.

Ce chiffre sert de **cible de test**, pas de promesse abstraite de capacité.

### Tests spécifiques

- navigation catalogue concurrente ;
- recherches ;
- publications ;
- rafale de demandes photo ;
- queue > 20 ;
- fournisseur IA ralenti ;
- fournisseur IA en erreur ;
- redémarrage de l'application ;
- consommation mémoire sur une durée prolongée.

### Critère de sortie

Seuils mesurés et documentés, bugs bloquants corrigés, comportement sous surcharge compris.

---

## Étape 8 — Showroom tablette

### Socle commun

Créer une seule application / un seul hub contenant :

- Rocky ;
- Basket ;
- Garage ;
- Jarvis.

Mutualiser :

- navigation ;
- design system ;
- mécanisme de reset ;
- éventuel wrapper de chatbot.

### Principe

Toutes les données métier peuvent être statiques. Les actions peuvent être simulées. Un petit délai ou spinner est acceptable s'il améliore la lisibilité de la démonstration.

### LLM comédien

Pour Rocky/Jarvis uniquement si utile :

- contexte fictif court ;
- aucune connexion externe ;
- reset entre visiteurs ;
- coût borné ;
- aucune fausse affirmation d'action réelle.

### Critère de sortie

Chaque univers peut être testé sans dépendre d'un back-end métier réel et le showroom se réinitialise en un geste.

---

## Étape 9 — Laboratoire fun [OPTIONNEL]

Ne commencer que si les étapes 1 à 8 sont suffisamment stables.

### V1 du bloc

- une photo d’objet et une seule analyse vision initiale ;
- 5 vœux visibles, dont 3 réussis maximum par objet ;
- `Donne-moi vie`, `Fais de moi une star`, `Raconte mon passé`, `Mon pouvoir secret` ;
- `Pars en quête` : selfie avec l’objet + deux photos-missions dans la fête foraine + mini-histoire finale ;
- résultat visuel facile à garder en capture d’écran ;
- photos temporaires supprimées après traitement ;
- limite de trois appliquée côté serveur et passage par la queue IA existante.

### Critère de sortie

Les cinq vœux sont compréhensibles sur mobile, trois créations maximum peuvent réussir pour un objet, la quête photo produit un souvenir, et le bloc peut être désactivé sans affecter les autres parcours.

---

## Étape 10 — Répétition jour J

### Vérifier

- QR codes ;
- URL publique ;
- téléphone Android/iOS si possible ;
- tablette ;
- réseau disponible ;
- fonctionnement caméra ;
- reset showroom ;
- monitoring ;
- export des logs/événements ;
- procédure de redémarrage ;
- procédure si l'IA tombe ;
- procédure si la VM doit être relancée.

### Livrable

Un **runbook court** utilisable sous pression.

### Critère de sortie

Une répétition complète peut être menée sans improviser les opérations critiques.

---

# Ordre de sacrifice si le temps manque

Supprimer / repousser dans cet ordre :

1. bloc fun ;
2. raffinements du showroom ;
3. tri par prix et filtres secondaires ;
4. animations / embellissements ;
5. touches rédactionnelles fun non essentielles.

**Ne pas sacrifier** :

- publication vendeur ;
- catalogue / recherche de base ;
- numéro de stand ;
- isolation des pannes IA ;
- queue si la concurrence IA peut saturer ;
- erreurs compréhensibles ;
- instrumentation minimale.

# Definition of Done MVP

Le MVP est « prêt événement » uniquement si :

- [ ] une annonce peut être publiée depuis un téléphone ;
- [ ] la photo peut provenir directement de la caméra ;
- [ ] tous les champs proposés par l'IA peuvent être corrigés ;
- [ ] le numéro de stand est obligatoire ;
- [ ] le mini-marché fonctionne sans LLM ;
- [ ] la recherche fonctionne ;
- [ ] l'assistant photo gère sa limite de trois questions ;
- [ ] les tâches IA peuvent être mises en queue ;
- [ ] une panne IA ne bloque pas les annonces ;
- [ ] les erreurs sont explicites ;
- [ ] les événements produit sont enregistrés ;
- [ ] les métriques techniques essentielles sont visibles ;
- [ ] les données peuvent être exportées ;
- [ ] un test de charge a été réalisé et documenté ;
- [ ] le showroom peut être reset rapidement ;
- [ ] le runbook jour J existe.
