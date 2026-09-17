# BrocAI — première tranche d'implémentation

Cette archive contient uniquement les nouveaux fichiers à ajouter à la racine du dépôt existant.

## Ce qui fonctionne dans cette tranche

- socle React + Vite + TypeScript ;
- API FastAPI ;
- PostgreSQL ;
- stockage local persistant des images ;
- healthcheck ;
- accueil mobile-first avec `Je vends`, `Je cherche`, `J'analyse` ;
- vendeur : photo → brouillon → édition → aperçu → publication ;
- mini-marché : liste, recherche, fiche, prix et stand ;
- événements analytics minimaux (`seller_photo_submitted`, `ai_analysis_*`, `listing_published`, `search_performed`, `listing_viewed`) ;
- Docker Compose pour PostgreSQL + backend + frontend.

## Limite volontaire

Le fournisseur multimodal réel n'est **pas encore branché**. Le backend utilise un `MockVisionProvider` clairement identifié par `analysis_mode=mock-fallback`. Cela permet de valider le flux end-to-end sans simuler faussement une analyse visuelle réelle. La prochaine tranche doit ajouter l'adaptateur multimodal et la queue persistante.

## Lancement

Depuis la racine du dépôt après copie des fichiers :

```bash
cp .env.example .env
docker compose up --build
```

Puis ouvrir `http://localhost:8080` et vérifier `http://localhost:8080/health`.

## Seller stand management update

The seller area now uses the stand number as a lightweight event-day access key. A seller can:

- enter a stand number once to open the stand dashboard;
- see all listings for that stand, including sold items;
- mark an item as sold so it disappears from the public market;
- relist an item after an accidental sold action;
- create new listings already attached to the active stand.

`listings.sold_at` is added by a small startup migration so existing PostgreSQL data is preserved. Existing listings receive `NULL` and therefore remain on sale. This is intentionally lightweight access control for the event MVP, not strong authentication.

## Étape 2 — parcours vendeur complet

Cette version complète la tranche vendeur :

- bouton `Modifier` depuis `Mes annonces` ;
- édition du titre, de la description, de la catégorie, du prix et du pseudo ;
- événement analytics `listing_updated` ;
- adaptateur Gemini multimodal réel derrière `AI_PROVIDER=gemini` ;
- sortie IA structurée et validée avant affichage ;
- niveau de confiance visible dans le brouillon ;
- aucun fallback silencieux : si Gemini est activé mais indisponible, le vendeur voit une erreur récupérable ;
- le mode `mock` reste disponible pour le développement local sans consommation API.

Pour activer Gemini :

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=votre_cle
GEMINI_MODEL=gemini-2.5-flash
```

Le modèle est configurable par variable d'environnement. La queue IA n'est pas incluse ici : elle appartient à l'étape 5 du plan MVP.
