# BrocAI — showroom tablette (étape 8)

Le showroom est une surface de démonstration séparée de l'application publique BrocAI.

## Accès

Après déploiement :

```text
/showroom
```

L'accueil public BrocAI conserve uniquement ses trois parcours `Je vends`, `Je cherche` et `J’analyse`.

## Principe

Le showroom est volontairement déterministe et autonome :

- aucun compte externe ;
- aucune donnée personnelle réelle ;
- aucune connexion Gmail, calendrier, domotique, CRM ou système métier ;
- aucun appel LLM nécessaire ;
- toutes les données présentées sont fictives ;
- toutes les actions sont des simulations locales.

Cette décision privilégie la fluidité et la fiabilité le jour de la brocante. Un LLM « comédien » pourra être ajouté plus tard si sa valeur est démontrée, sans être requis pour le MVP événementiel.

## Univers

### Rocky

- dashboard de recherche d'emploi ;
- offres et matching ;
- pipeline de candidatures ;
- assistant conversationnel déterministe.

### Basket Lab

- indicateurs équipe ;
- profils joueurs ;
- vue match ;
- comparaison de joueurs.

### Garage OS

- vue atelier ;
- planning ;
- interventions ;
- devis simulé.

### Jarvis

- résumé du jour ;
- agenda fictif ;
- maison/domotique simulée ;
- assistant conversationnel déterministe.

## Reset

Le bouton `Reset` remet immédiatement le showroom au hub et réinitialise les états locaux des démonstrations. Aucune donnée métier n'est écrite en base par les démos.

## Analytics

Les événements suivants sont envoyés dans la table `events` existante :

- `demo_opened` ;
- `feature_clicked` ;
- `chat_started` ;
- `message_count` ;
- `demo_duration_s` ;
- `demo_reset`.

Le texte des conversations n'est jamais envoyé dans les analytics.

## Validation manuelle

```bash
npm --prefix frontend run build

docker compose up -d --build
open http://localhost:8080/showroom
```

À vérifier sur tablette ou en responsive :

1. ouvrir chacun des quatre univers ;
2. parcourir chaque onglet ;
3. utiliser au moins une interaction Rocky, Garage et Jarvis ;
4. tester les deux assistants déterministes ;
5. utiliser `Reset` depuis une démo ;
6. vérifier qu'un retour au hub ne touche pas à BrocAI public ;
7. vérifier les événements via l'export admin `events`.
