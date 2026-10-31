# Scan de fiole : prototype web

Web app qui filme la fiole en rotation, assemble l'étiquette comme un panorama, détecte le tour
complet et sort l'étiquette à plat, recadrée de bord à bord. Tout le calcul se fait dans le
navigateur du téléphone : aucune image n'est envoyée ailleurs.

**App en ligne : https://didzoscop.github.io/antibody-scanner/** (s'ouvre directement sur le téléphone).

Le dossier `tools/` contient les prototypes Python (OpenCV) qui ont validé l'approche, et `docs/` des résultats.

## Lancer

Sur le PC (Node.js requis) :

    node serve.js

- PC : http://localhost:8080
- Téléphone, sur le même Wi-Fi : l'adresse `https://<IP du PC>:8443` affichée au démarrage.
  Le certificat est auto-signé : accepter l'avertissement une fois (« Paramètres avancés » > « Continuer »).
  Si la page ne s'ouvre pas, autoriser Node.js dans le pare-feu Windows (réseaux privés).

## Utiliser

1. « Démarrer la caméra ».
2. Placer le cadre jaune sur l'étiquette : toute sa hauteur, environ 5 à 8 mm de large au centre de la fiole.
   La position est mémorisée pour la fois suivante.
3. Sur Android, ouvrir « Réglages caméra » : « Mode sport » (exposition 1 ms), et régler la mise au point si besoin.
4. « Lancer le scan », puis tourner la fiole doucement, dans un sens ou dans l'autre.
   La barre se remplit, et le tour est confirmé par une vibration. L'anneau vert montre les zones couvertes.
5. Le scan s'arrête tout seul : « Enregistrer l'image ».

« Tester avec une vidéo » rejoue une vidéo enregistrée comme si c'était la caméra.
Paramètres d'URL utiles pour les tests : `?video=test.mp4&roi=x,y,l,h` (fractions de l'image).

## Limites connues

- Safari sur iPhone ne permet ni de régler l'exposition ni de verrouiller la mise au point
  (il faudra une app native pour le mode sport sur iPhone).
- La jonction de l'étiquette est trouvée grâce à l'espace visible entre ses deux bords.
  Si une étiquette se chevauche, l'image commence à un endroit arbitraire.
- Quelques raccords restent visibles dans le texte (lettres doublées ou rognées).
