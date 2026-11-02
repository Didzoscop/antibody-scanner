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
   localStorage. La hauteur de travail est plafonnée à 480 px.
   - **Vidéo brute de l'utilisateur (v0.10)** : fiole tenue par le haut, tournée aux doigts, 4K 30 i/s, 16 s
     (pas dans le dépôt, trop lourde). Trois défauts trouvés et corrigés :
     1. **Emballement du suivi** : la recherche image par image ne regardait qu'autour de la vitesse précédente
        (±14 px). Après un à-coup, la vitesse estimée montait (40–70 px/image pour ~20 réels), la vraie valeur
        sortait de la fenêtre et l'erreur s'entretenait : lettres répétées « cccccc » dans le panorama.
        Correction : `coarseShift`, recherche à demi-résolution sur toute la plage à chaque image, avec une
        continuité douce (coût × (1 + κ (écart/largeur)²), κ = 4). Sans continuité, la vidéo de test donne une
        circonférence 7 % trop courte ; avec une fenêtre stricte, la vidéo de l'utilisateur s'emballe.
     2. **Décalage vertical entre deux tours** de 20 à 50 px (main) : recherche verticale du tour portée à
        ±16 lignes (±32 px), avec une colonne sur 4 et une ligne sur 8 pour garder le coût. Confirmation rapide
        d'un tour repéré : la recherche suivante ne regarde qu'autour de cette période (`hintP`).
     3. **Trou jamais comblé** : une zone vue seulement floue (pendant un à-coup) restait vide et le scan ne
        finissait jamais. Les images floues remplissent maintenant les colonnes vides, en plus basse priorité.
     Autres : panorama de 12 000 colonnes (circonférence ~2300 px en 4K de près), circonférence minimale de
     3 largeurs de bande (une fausse période de 242 px apparaissait), hauteur de travail plafonnée à 480 px
     (2,5× plus rapide), secours à l'arrêt avec seuil relatif, courbe lissée et recouvrement ≥ 0,3 P.
     Résultats : vidéo de l'utilisateur, tour reconnu à 8,9 s, P = 1560 (attendu ~1550 à 480 px de haut,
     diamètre ~728 px en 4K), étiquette lisible (lot TA0225, exp 06 2028) ; vidéo de test, P = 456 (≈ 587 × 480/630).
     Limite : cette étiquette fait tout le tour sans espace visible, la coupe est approximative.
   - **Vitesse** : le suivi tient jusqu'à ~0,3 × la largeur de la bande par image (simulation, bande de 60 px :
     16 px/image OK, 22 px → circonférence fausse, 30 px → bloqué). Au-delà, le panorama se brouille.
     Le cadre clignote en rouge dès 0,2 × la largeur (« Trop vite ! »). Une bande plus étroite tolère donc moins
     de vitesse : resserrer le cadre n'aide pas l'utilisateur, au contraire.
   - **Tentative abandonnée (v0.9, non publiée)** : détecter la perte du suivi (à-coup) et se recaler dans le
     panorama après un retour en arrière. Ça marchait sur les simulations d'à-coups, mais : un seuil sur la
     ressemblance au panorama donne de fausses alertes dans les zones blanches de l'étiquette (le NCC y tombe
     naturellement à ~0,15) ; ne pas écrire les images douteuses fait caler le panorama ; et un à-coup mal
     interprété écrit deux fois le même morceau d'étiquette, si bien que le panorama se répète vraiment à la
     mauvaise période (un contrôle par autocorrélation ne l'attrape pas). Plusieurs réglages ont même rendu
     fausses des rotations douces. À reprendre seulement avec de vraies vidéos de l'utilisateur.
   - **Cadre large** (index.html, `setupCrop`) : on ne traite qu'une bande centrale d'au plus 0,25 × la hauteur
     du cadre. Capture d'écran de l'utilisateur (fiole tenue à la main, sans socle, cadre couvrant ~80 % du
     diamètre) : raccord bloqué à 0,04–0,07 alors que l'étiquette avait fait le tour. Cause : sur un cylindre,
     les bords sont écrasés et défilent moins vite que le centre. Simulation (texture de l'étiquette réelle
     projetée sur un cylindre) : cadre à 80 % du diamètre → raccord 0,45, circonférence fausse de 6 % ;
     moitié centrale → 0,96, juste, tour reconnu après 1,1 tour. La fenêtre du socle (rapport 0,2) n'est pas
     rognée : une bande de 58 px décroche sur la vidéo de test.
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
   centre de la fenêtre, sans flou de bougé et sans mouvement vertical.
   - **Démarrage (v0.11)** : le panorama ne commence qu'après 3 images sans mouvement vertical (`SETTLE`).
     Capture de l'utilisateur (fiole BD Horizon BUV395) : les deux bords abîmés de l'étiquette (flous, décalés
     de ~100 px en hauteur, rayés) venaient tous les deux du début du scan, quand la fiole était encore en
     train d'être posée (le bord droit est le même endroit, pris un tour plus tôt).
   - **Mesure du flou (v0.11)** : `analyse` calcule, par colonne (fenêtre de 13), Rx = énergie du gradient fin
     (pas de 2 px) / énergie du gradient large (8 px) en horizontal, Ry pareil en vertical, et Q = Rx / Ry.
     Une rotation ne floute qu'en horizontal, donc Q chute ; le rapport ne dépend presque pas du contraste ni
     du texte (l'ancienne netteté, somme des |gradients|, variait du simple au quadruple selon le texte vu, et
     une somme L1 ne baisse presque pas avec le flou). Vidéo de test, fenêtres locales : nette 0,97 à 2,35
     (5 %–95 %), floutée de 3 px 0,62–1,65, de 5 px 0,40–0,97, de 7 px 0,29–0,73. Fenêtre sans texture : Q = 9.
     Référence `refQ` = 3e quartile du Q des images du scan (au moins 1,5) ; une colonne est **nette** si
     Q ≥ 0,45 × refQ et si l'image n'a pas bougé verticalement de plus de 3 px (`good(u)`).
     Ne pas mesurer Q sur une étiquette déjà assemblée : les raccords entre colonnes font du gradient fin.
   - **Choix de la capture** : centre de la fenêtre + pénalité de flou pour l'image entière
     (4 × ln(0,8 refQ / Q) sous 0,8 refQ, rien au-dessus) − 2 si mouvement vertical. Deux pièges essayés :
     une note par colonne fait venir deux colonnes voisines d'images différentes et hache le texte ; un bonus
     de netteté (et non une simple pénalité) fait préférer des colonnes vues au bord de la fenêtre, écrasées
     par le cylindre, et crée des sauts verticaux dans le panorama.
   - Une image floue (Q < 0,5 refQ) n'est pas recalée sur le panorama, seulement sur l'image d'avant : son
     gradient écrasé se recale mal sur un panorama net (simulation : circonférence fausse de 25 %).
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
   - **Plus de deux tours** : l'image ressemble alors autant à la zone vue un tour plus tôt qu'à celle vue
     deux tours plus tôt, et l'ancien test d'écart échouait toujours (bloqué à 60 % avec « 0.6 / 0.6 » chez
     l'utilisateur). On cherche donc les pics de ressemblance ; ceux espacés d'un multiple du plus petit écart
     (> 2 largeurs de zone) confirment le tour, et seul un pic hors de ces multiples compte comme concurrent.
     La période retenue est le plus petit écart. Testé sur une rotation simulée de 2,7 tours (texture de
     l'étiquette réelle) : période 574 pour 573.
   - **Secours à l'arrêt** (`periodFromPanorama`) : malgré tout ça, l'utilisateur restait bloqué à 60 % avec
     un panorama brut correct. Quand on appuie sur Stop, l'app compare le panorama à lui-même décalé de P
     colonnes, en **niveaux de gris** (Pearson) et non en gradient : le pic est large de quelques colonnes,
     alors que sur le gradient il tient sur une seule colonne et se perd. Validé si r ≥ 0,4 et r − médiane
     de la courbe ≥ 0,15 ; on prend le plus petit pic à 85 % du meilleur (un tour, pas deux).
     Vidéo de test : 586 px (r 0,66, médiane 0,44) ; simulations 1,4 et 3,2 tours : 573 et 574 pour 573 ;
     panorama de moins d'un tour : refusé. ~0,1 à 0,6 s sur PC. Si rien n'est trouvé, le panorama brut est
     gardé (« incomplet »).
   - Le service worker revalide chaque fichier (`cache: 'no-cache'`) : sinon le cache HTTP de GitHub Pages
     pouvait servir l'ancien engine.js pendant 10 minutes après un push.
   - Comparer le panorama à lui-même en gradient ne marche pas (NCC ≈ 0,08). Comparer l'image brute au
     panorama donne 0,56.
5. **Couverture** : une fois la période connue, chaque colonne est repliée modulo la circonférence.
   Le scan se termine quand il ne reste, sur le tour, que des trous de 4 colonnes au plus parmi les colonnes
   **nettes** (v0.11 : avant, il suffisait que le tour soit reconnu, même avec des zones floues). Sinon le
   message « Continuez, plus lentement » s'affiche et la jauge ne monte qu'avec les zones vues nettes.
   La mise à plat comble les petits trous avec les colonnes voisines.
   - **Diamètre** : rien ne suppose de diamètre (tour reconnu par fermeture de boucle, panorama de 12 000
     colonnes). Mais la jauge plafonnait à 60 % dès 8 largeurs de cadre : avec un objet plus gros (spray
     nasal testé par l'utilisateur), elle restait bloquée à 60 % bien avant le tour complet. Elle tend
     maintenant vers 60 % sans s'y bloquer (60 × (1 − e^(−longueur / 5 largeurs))), et « tour pas reconnu »
     n'apparaît qu'après 16 largeurs de cadre.
   Le panneau affiche aussi la cadence de traitement (images/s), utile pour diagnostiquer un téléphone lent.
6. **Mise à plat** : on cherche la jonction des deux bords de l'étiquette, c'est-à-dire une colonne
   sombre sur presque toute la hauteur (médiane de l'obscurité entre 5 et 95 % de la hauteur, avec un
   contraste supérieur à 25 niveaux). L'image commence juste après et finit juste avant.
   - **Par blocs de 32 colonnes (v0.11)** : on suit le panorama tel quel ; un bloc flou, manquant ou au-delà
     du panorama est pris dans un autre tour (x ± kP), recalé en largeur (±10) et en hauteur (±32 px) par
     Pearson sur un bloc vu en entier des deux côtés (sur quelques colonnes, le recalage se trompait), le
     dernier recalage connu servant ensuite. On ne change de tour que si le bloc courant a des colonnes floues :
     changer sans nécessité ajoutait des raccords.
   - Simulations (vidéo de test, ~2 px/image) : aller avec flou de 7 px sur deux passages puis retour net, et
     aller avec deux passages accélérés ×5 et floutés. L'ancien moteur : circonférence 493 et 475, texte haché
     ou flou ; le nouveau : 450 et 444, étiquette lisible en entier. Vidéo de test seule : 455 (ancien 460,
     attendu ~447 à 480 px de haut).

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

- À vérifier sur de vraies vidéos : les seuils de netteté (0,45 × refQ, plancher 1,5) viennent de la vidéo de
  test et de flous simulés. Si le scan ne finit jamais avec « Continuez, plus lentement », baisser `NET`.
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
