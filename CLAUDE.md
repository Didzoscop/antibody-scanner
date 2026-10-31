# Antibody scanner : contexte du projet

L'utilisateur parle français : répondre en français.

## But

Scanner l'étiquette d'une fiole d'anticorps (cytométrie) avec un téléphone fixé dans un support
imprimé en 3D. On tourne la fiole à la main devant la caméra. L'app assemble l'étiquette comme un
panorama, détecte que tout le tour a été vu et sort l'étiquette à plat, de bord à bord.

À terme, il faudra extraire : **marqueur, fluorochrome, fabricant, lot, numéro de catalogue**.
Cette étape n'est pas commencée : la v1 s'arrête à l'image à plat, par choix de l'utilisateur.

## Contraintes du montage

- Le téléphone et la fiole sont fixes : **pas de mouvement en x, y, z une fois le socle imprimé**.
  En revanche, la rotation manuelle est irrégulière, avec des allers-retours et des à-coups.
- La fiole est verticale et le texte horizontal, donc la rotation fait défiler l'étiquette horizontalement.
- La caméra voit la fiole à travers une fenêtre étroite du support : environ 118 px de large sur 630 px
  de haut dans une image 4K.
- Le diamètre des fioles varie : **ne jamais supposer de circonférence**, la mesurer par fermeture de boucle.
- Plateforme : **Android en priorité**, iPhone ensuite. Safari sur iPhone ne permet ni de régler
  l'exposition ni la mise au point, donc le « mode sport » sur iPhone demandera une app native (Swift).

## Fichiers

- `index.html` : l'interface (accueil, écran de scan, paramètres, registre). Publiée par GitHub Pages
  sur https://didzoscop.github.io/antibody-scanner/, mise à jour à chaque push sur `main`.
- `engine.js` : le moteur de scan (`ScanEngine`), indépendant de la caméra : il reçoit les pixels RGBA de la zone.
- `mascot.js` : la mascotte (fiole en pixel art, grille 70 × 75 comme celle de Petri·Capture), l'animation
  de remplacement de fiole dans le socle et les flèches de rotation.
- `fonts/ByteBounce.ttf` : police reprise de Petri·Capture.
- `manifest.webmanifest`, `sw.js`, `icons/` : app installable depuis Chrome (plein écran, paysage), utilisable
  hors ligne. Le service worker prend le réseau d'abord, donc chaque push est visible sans réinstaller.
  Les icônes sont la mascotte agrandie sur fond bleu (la version « maskable » a plus de marge).

## Direction artistique

Identique à Petri·Capture (`D:\Documents\petri-capture`, https://github.com/Didzoscop/petri-capture) :
encre `#1A1A1A`, traits de 3 px, ombres décalées pleines, boutons carrés, titres en capitales espacées,
police ByteBounce avec Pixelify Sans en secours. Seule différence : le fond est bleu pastel (`--bg:#CFE4F2`, `--paper:#F1F7FB`).

## Déroulé de l'écran de scan

L'app est **en paysage uniquement** : verrouillage d'orientation en plein écran sur Android, sinon un écran
« tournez le téléphone » couvre tout en portrait (sur écran tactile seulement). Aperçu caméra à gauche, panneau à droite.
Langue : **anglais par défaut**, français via le drapeau en haut à droite de l'accueil (`I18N` dans index.html, `data-i18n` dans le HTML,
`t('clé')` dans le JS ; tout nouveau texte doit exister dans les deux langues). Le bouton « Lens / Objectif » en haut
à droite de l'aperçu fait défiler les caméras arrière exposées par le navigateur (choix mémorisé dans `prefs.lens`) ;
il est masqué s'il n'y en a qu'une.

`zone` (on règle le cadre, socle vide, au doigt : glisser, coins, pincer) → « Run scan » mémorise le fond
→ `wait` (fiole détectée quand la zone diffère du fond) → `scan` (flèches qui tournent, barre de progression)
→ `done` (scan enregistré dans le registre, animation de remplacement) → socle vidé → `next` → fiole posée → `scan`.
La détection compare une image 12 × N en gris au fond, avec hystérésis et 6 images de confirmation ; le fond suit
lentement la lumière quand le socle est vide. Avec une vidéo de test, la détection du socle est ignorée.
Le registre est stocké sur l'appareil (IndexedDB, base `antibody-scanner`).
- `serve.js` : serveur local pour tester. `http://localhost:8080` sur le PC, et
  `https://<IP>:8443` pour un téléphone sur le même Wi-Fi (certificat auto-signé généré dans `cert/`,
  à ne jamais commiter). `TEST_VIDEO=chemin.mp4 node serve.js` sert en plus une vidéo sur `/test.mp4`.
- `tools/*.py` : prototypes Python (OpenCV + NumPy) qui ont servi à valider l'approche.
  `unroll.py` fait la chaîne complète vidéo → étiquette à plat.
- `docs/*.png` : résultats obtenus sur la vidéo de test.

Tester l'app sur une vidéo sans caméra :
`http://localhost:8080/?video=test/fiole_siglec-f.mp4&roi=0.4792,0.2778,0.0307,0.2917`
(marche aussi en ligne : `https://didzoscop.github.io/antibody-scanner/?video=test/fiole_siglec-f.mp4&roi=…`)
(le ROI est en fractions de l'image et correspond à la vidéo de test de l'utilisateur). Avec une vidéo,
l'app avance image par image par `seeked`, ce qui marche même dans un onglet masqué, mais lentement.

## Algorithme (engine.js)

1. **Zone d'intérêt** : on ne traite que le rectangle choisi par l'utilisateur, mémorisé dans
   localStorage. La hauteur de travail est plafonnée à 720 px.
   - **Lecture des pixels** (index.html, `grab`) : `createImageBitmap(video, zone…)` découpe la zone avant
     la copie. `drawImage(video) + getImageData` copiait toute l'image 4K : ~20 ms sur PC, et c'était fait
     deux fois par image (scan + détection du socle). Avec le découpage : ~1,5 ms, une seule lecture par
     image, dont on tire aussi la petite image grise du socle (`grayOf`). Ne pas revenir en arrière.
   - Mesures sur PC (vidéo de test) : moteur ~12,7 ms par image (`register` et `registerMosaic` en
     recherche grossière puis affinage). Sur cette vidéo très tremblée, en dessous de ~30 images/s traitées,
     le suivi décroche et le tour n'est plus reconnu : la cadence est donc le point critique sur téléphone.
   - Quand on arrête un scan avant la fin, le panorama brut (`engine.panorama()`) est gardé dans le registre,
     marqué « incomplet », pour voir si le suivi a décroché. Le panneau affiche la cadence et le meilleur
     raccord trouvé (NCC / 2e candidat).
2. **Suivi du mouvement** : une estimation grossière image par image (SSD sur le gradient
   horizontal, recherche autour du dernier mouvement), puis **un recalage absolu de l'image sur le
   panorama déjà construit** (`registerMosaic`). C'est cette deuxième étape qui fait foi.
   - Pourquoi : additionner des décalages image par image accumule un biais. Sur la vidéo de test,
     la somme vaut 615 px en SSD et 709 px en corrélation de phase, contre 652 px en mesure directe
     sur 12 images. Le recalage sur le panorama donne 699 px, sans dérive.
3. **Panorama** : pour chaque colonne, on garde la meilleure capture, celle qui était la plus au
   centre de la fenêtre et la plus nette. Une image dont la netteté est inférieure à 0,6 × la
   médiane récente est ignorée : ce sont les à-coups de rotation qui abîmaient le n° de lot.
4. **Fermeture de boucle** (tour complet) : on compare l'image en cours au panorama, loin de la
   position actuelle (NCC sur le gradient, avec une petite recherche verticale). Le tour est validé
   si NCC ≥ 0,3, avec au moins 0,12 d'écart sur le 2e meilleur candidat, et deux détections concordantes
   (±4 px) parmi les 4 dernières.
   - Sur la vidéo de test, le vrai raccord donne 0,37 à 0,50 contre ~0,12 pour le 2e candidat ; avant le
     tour complet, le meilleur reste sous 0,18 et proche du 2e. L'ancien seuil (0,4 / 0,08) était trop juste
     et laissait le scan bloqué à 60 %.
   - **Coût** : cette recherche parcourt tout le panorama et coûtait 60 à 80 ms par essai sur PC (bien plus
     sur téléphone), ce qui rendait l'app très lente. Elle est maintenant répartie sur plusieurs images
     (`startClosure` fige l'image, `stepClosure` avance de `CLOSURE_OPS` opérations par image), avec une
     ligne sur quatre en hauteur. Aucune image ne dépasse ~16 ms sur PC. `engine.trace` garde les derniers
     résultats (NCC, 2e candidat, période) pour le diagnostic.
   - Comparer le panorama à lui-même ne marche pas (NCC ≈ 0,08). Comparer l'image brute au
     panorama donne 0,56.
5. **Couverture** : une fois la période connue, chaque colonne est repliée modulo la circonférence.
   Le scan se termine dès qu'il ne reste que des trous de 4 colonnes au plus sur le tour (en pratique,
   dès que le tour est reconnu) ; la mise à plat comble ces trous avec les colonnes voisines. La jauge en bas de l'écran (rouge → orange → vert) monte
   jusqu'à 60 % d'après la longueur du panorama, puis affiche la couverture réelle. Le panneau affiche
   aussi la cadence de traitement (images/s), utile pour diagnostiquer un téléphone lent.
6. **Mise à plat** : on cherche la jonction des deux bords de l'étiquette, c'est-à-dire une colonne
   sombre sur presque toute la hauteur (médiane de l'obscurité entre 5 et 95 % de la hauteur, avec un
   contraste supérieur à 25 niveaux). L'image commence juste après et finit juste avant. La partie qui
   dépasse le panorama est prise un tour plus tôt, après recalage vertical des deux passages.

## Vidéo de test et vérité terrain

La vidéo fait 4K à 60 fps, dure 5,2 s (312 images) et a été tenue à la main, donc elle vibre fortement
(décalage vertical d'environ 60 px). Elle est dans le dépôt : `test/fiole_siglec-f.mp4`.
Les vidéos ne sont versionnées que dans `test/` (voir `.gitignore`). GitHub refuse les fichiers de plus
de 100 Mo : au-delà, réduire la vidéo ou utiliser Git LFS.

Résultats : circonférence d'environ 590 à 597 px, jonction de l'étiquette trouvée, image de sortie
de 574 × 630 px.

Étiquette de référence pour vérifier une future lecture automatique :
BD Pharmingen™ (BD Biosciences), Alexa Fluor® 647 Rat Anti-Mouse **Siglec-F**, clone E50-2440,
Cat **562680**, Lot **6089689** (vérifié sur l'image brute n° 145), Exp 2020-04-30,
50 µg, 0,25 ml, 0,2 mg/ml, conservation à 4 °C. Annotation manuscrite verticale « LII3 » (incertaine).

## Limites connues et suite

- Quelques raccords restent visibles dans le texte (« Mo**ı**se », « Res**s**earch »). Pistes :
  adoucir les jonctions entre captures, et mieux gérer les zones blanches sans texture.
- La jonction n'est pas détectée si l'étiquette se chevauche elle-même (pas d'espace visible).
- L'app n'a pas encore été testée sur un vrai téléphone ni dans le socle imprimé.
  Prochaine vidéo attendue : une vraie capture dans le socle.
- Ensuite : une app native iPhone pour le mode sport, puis la lecture des champs (OCR ou modèle
  vision, contrôle de cohérence catalogue / marqueur / fluorochrome / clone, écran de confirmation).
- Exposition sur Android : `exposureTime` est en unités de 100 µs (le « mode sport » vise 10, soit 1 ms).
  Une exposition courte demande un éclairage LED diffus dans le socle, pas le flash du téléphone.

## Travail sur plusieurs PC

L'utilisateur code sur deux ordinateurs. Toujours faire `git pull` avant de commencer, puis commit
et `git push` à la fin.
