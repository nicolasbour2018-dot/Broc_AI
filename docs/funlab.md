# Étape 9 — FunLab

## Intention

Créer une expérience courte, familiale et mémorable autour des objets de brocante, sans fragiliser les parcours vendeur, marché ou assistant.

## Parcours

1. Le visiteur photographie un objet.
2. BrocAI réalise une seule analyse vision et crée un contexte court.
3. Cinq vœux sont visibles ; trois maximum peuvent réussir pour cet objet.
4. Les quatre vœux courts travaillent uniquement à partir du contexte textuel déjà extrait.
5. `Pars en quête` demande un selfie avec l’objet et deux photos prises dans la fête foraine.
6. Le résultat est présenté sous forme de carte visuelle facile à garder en capture d’écran.

## Les cinq vœux

- `Donne-moi vie` : personnage, caractère et mini-réplique.
- `Fais de moi une star` : titre d’affiche, slogan et mise en scène fictive.
- `Raconte mon passé` : biographie explicitement imaginaire.
- `Mon pouvoir secret` : pouvoir absurde, faiblesse et punchline.
- `Pars en quête` : une mini-aventure à la fête foraine.

### Pars en quête

Promesse affichée :

> Emmène ton objet à la fête foraine : un selfie, deux photos-missions, puis BrocAI raconte votre aventure.

Trois mini-aventures sont proposées :

- `La grande aventure` ;
- `Mission secrète` ;
- `Star de la fête`.

Chaque mini-aventure suit le même format :

1. selfie du visiteur avec l’objet ;
2. photo mission #1 ;
3. photo mission #2 ;
4. génération d’une histoire courte.

Les personnes présentes sur un selfie ne sont ni identifiées ni évaluées. La création reste centrée sur l’objet et l’aventure.

## Limites et coût

- un seul appel vision initial ;
- trois vœux réussis maximum, limite vérifiée côté serveur ;
- un vœu en erreur ne consomme pas de tentative ;
- les quatre vœux courts n’envoient pas de nouvelle image au modèle ;
- la quête envoie uniquement les trois photos nécessaires à l’histoire ;
- tous les jobs passent par la queue PostgreSQL existante.

## Vie privée

La photo initiale, le selfie et les photos de mission sont temporaires. Ils sont supprimés du stockage serveur après le traitement, succès ou erreur. Les analytics ne conservent pas le texte généré ni le contenu des photos.

## Événements

- `fun_photo_submitted`
- `fun_object_ready`
- `fun_wish_selected`
- `fun_wish_completed`
- `fun_session_completed`

## Test manuel minimal

1. Ouvrir `/fun` ou `FunLab` depuis l’accueil.
2. Photographier un objet et vérifier l’apparition des cinq vœux.
3. Exécuter un vœu court et vérifier que le compteur passe de 3 à 2.
4. Exécuter `Pars en quête` avec trois images et vérifier la suppression des uploads côté serveur après le résultat.
5. Utiliser trois vœux avec succès : un quatrième doit être bloqué côté serveur.
6. Forcer une erreur provider : le vœu ne doit pas être consommé et le catalogue doit rester disponible.
