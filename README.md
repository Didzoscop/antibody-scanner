# Antibody·Scanner

Web app qui filme une fiole d'anticorps posée dans un socle, assemble son étiquette comme un panorama
pendant qu'on la tourne, détecte le tour complet et sort l'étiquette à plat, de bord à bord.
Tout le calcul se fait dans le navigateur du téléphone : aucune image n'est envoyée ailleurs.

**App en ligne : https://didzoscop.github.io/antibody-scanner/**

## Utiliser

L'app s'utilise en paysage, en anglais par défaut (drapeau en haut à droite de l'accueil pour passer en français).
Dans Chrome, le bouton **Install the app** de l'accueil (ou le menu ⋮ > « Installer l'application ») l'ajoute
comme une vraie app, en plein écran et utilisable hors ligne.

1. **Start scan** : l'aperçu de la caméra s'ouvre en grand. Le bouton **Lens** en haut à droite change
   d'objectif quand le téléphone en propose plusieurs.
2. **Zone de scan** (socle vide) : placez le cadre sur la fenêtre du socle, au doigt (glisser, coins, pincer).
   La zone est mémorisée.
3. **Run scan** : l'app mémorise le fond, puis attend qu'une fiole soit posée.
4. Fiole détectée : le scan démarre, les flèches invitent à tourner la fiole, la barre se remplit.
5. Scan terminé : l'étiquette est enregistrée dans le **Registre**. Retirez la fiole et posez la suivante :
   le scan suivant démarre tout seul.

Sur Android, **Paramètres** propose les réglages caméra pendant un scan (« Mode sport », mise au point, lampe),
la sensibilité de détection du socle et un mode test qui rejoue une vidéo.

Démo sur la vidéo de test :
https://didzoscop.github.io/antibody-scanner/?video=test/fiole_siglec-f.mp4&roi=0.4792,0.2778,0.0307,0.2917

## Développer en local

    node serve.js

`http://localhost:8080` sur le PC, `https://<IP du PC>:8443` sur un téléphone du même Wi-Fi
(certificat auto-signé à accepter une fois).

Le dossier `tools/` contient les prototypes Python (OpenCV) qui ont validé l'approche, `docs/` des résultats,
`test/` les vidéos de test. Le contexte technique complet est dans `CLAUDE.md`.

## Limites connues

- Safari sur iPhone ne permet ni de régler l'exposition ni de verrouiller la mise au point.
- La jonction de l'étiquette est trouvée grâce à l'espace visible entre ses deux bords.
- Quelques raccords restent visibles dans le texte.
