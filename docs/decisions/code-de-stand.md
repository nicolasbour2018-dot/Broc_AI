# Code de stand à 4 chiffres

- **Date de décision** : 2026-09-26
- **Décideur** : Nicolas
- **Branche** : `feat/stand-pin`
- **Précise** : « Pas de compte, pas de mot de passe » du [cahier des charges](../cahier_des_charges.md) : toujours pas de compte ni d'e-mail, mais un code court par stand.

## Contexte

Le numéro de stand était la seule preuve demandée pour publier, modifier ou marquer vendue une annonce. Il est affiché sur chaque annonce : n'importe qui pouvait modifier les annonces d'un autre stand, depuis l'application ou directement par l'API. Le stand retenu sur le téléphone (`localStorage`) servait au confort, pas à la sécurité.

## Décision

- Le **premier téléphone** qui ouvre un stand choisit un code à 4 chiffres, à l'étape 3 de l'onboarding vendeur. Un **autre téléphone** rejoint le stand avec le même code.
- Le serveur garde le hash du code (`stands`) et donne à chaque téléphone un jeton aléatoire, dont il garde aussi le hash (`stand_devices`). Le jeton est envoyé en `X-Stand-Token` sur les trois écritures : publier, modifier, marquer vendu ou remettre en vente. Un jeton ne vaut que pour son stand.
- **5 codes faux** bloquent le stand 15 minutes pour les nouveaux téléphones. Les téléphones déjà connectés ne sont pas touchés.
- **Code oublié ou stand squatté** : l'admin réinitialise le stand (« Code de stand oublié » dans la console). Le code et tous les jetons sont oubliés, les annonces restent en ligne, et le prochain téléphone choisit un nouveau code. L'organisateur vérifie l'identité du vendeur sur place.
- Les lectures restent publiques : les annonces du stand, et le bilan PDF.
- **Interrupteur** : `STAND_PIN_REQUIRED=false` (redémarrage du backend) coupe la vérification et revient au comportement précédent, sans redéployer le front.
- Chaque édition repart de zéro : aucune reprise des stands précédents. L'ancienne clé `brocai-seller-onboarding-v1` est ignorée, donc chaque vendeur repasse par l'onboarding une fois.

## Alternatives écartées

- **Identifiant et mot de passe, lien magique, SMS** : trop de friction, et un e-mail ou un numéro de téléphone deviennent obligatoires.
- **Verrouillage sur le seul premier appareil** : pas de deuxième téléphone par stand, et un téléphone perdu bloque le stand.
- **Code distribué par l'organisateur** : plus sûr contre le squat, mais demande une logistique d'impression.
- **BetterAuth** : bibliothèque TypeScript côté serveur Node, alors que le backend est en FastAPI.

## Limites assumées

C'est une protection légère pour une brocante d'un jour. Un code à 4 chiffres ne résiste pas à une fuite de la base (10 000 possibilités), et le premier arrivé sur un stand libre peut le squatter jusqu'à la réinitialisation par l'admin.
