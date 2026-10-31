"""Déroule l'étiquette d'une fiole filmée en rotation, et la recadre de bord à bord.
Usage: python unroll.py video.mp4 sortie.png [x0 x1 y0 y1]"""
import cv2, sys, numpy as np

X0, X1, Y0, Y1 = map(int, sys.argv[3:7]) if len(sys.argv) > 6 else (1840, 1958, 600, 1230)

# 1. Lecture de la zone d'intérêt uniquement
cap = cv2.VideoCapture(sys.argv[1])
rois = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    rois.append(f[Y0:Y1, X0:X1].copy())
T = len(rois); H, W = rois[0].shape[:2]

# 2. Suivi du décalage (x, y) image par image
def prep(r):
    g = cv2.cvtColor(r, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
sharp = np.array([cv2.Laplacian(cv2.cvtColor(r, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() for r in rois])
win = cv2.createHanningWindow((W, H), cv2.CV_32F)
P = [prep(r) for r in rois]
pos = np.zeros(T); dy = np.zeros(T)
for t in range(1, T):
    (a, b), _ = cv2.phaseCorrelate(P[t - 1], P[t], win)
    pos[t] = pos[t - 1] + a; dy[t] = dy[t - 1] + b
dy -= np.median(dy)

c = np.arange(W)
score_col = -np.abs(c - W / 2) / (W / 2)            # préférence pour le centre de la fenêtre
score_img = 0.5 * np.log(sharp / np.median(sharp))   # pénalité pour les images floues

def assemble(width, wrap):
    best = np.full(width, -1e9); out = np.zeros((H, width, 3), np.uint8); filled = np.zeros(width, bool)
    for t in range(T):
        u = np.round(c - pos[t] - umin).astype(int)
        if wrap:
            u %= width
        M = np.float32([[1, 0, 0], [0, 1, -dy[t]]])
        fr = cv2.warpAffine(rois[t], M, (W, H), flags=cv2.INTER_LINEAR)
        for ci in range(8, W - 8):
            ui = u[ci]
            s = score_col[ci] + score_img[t]
            if 0 <= ui < width and s > best[ui]:
                best[ui] = s; out[:, ui] = fr[:, ci]; filled[ui] = True
    return out, filled

# 3. Panorama linéaire, puis détection de la période (= circonférence) par auto-similarité
umin = int(np.floor(-pos.max())); CW = int(np.ceil(W - pos.min())) - umin
lin, filled = assemble(CW, wrap=False)
g = cv2.Sobel(cv2.cvtColor(lin, cv2.COLOR_BGR2GRAY).astype(np.float32), cv2.CV_32F, 1, 0)
g[:, ~filled] = 0
cands = []
for p in range(3 * W, CW - W // 2):
    a, b = g[:, :CW - p], g[:, p:]
    cands.append(((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9), p))
corr, period = max(cands)
print(f"{T} images, panorama {CW}px, circonférence détectée: {period}px (corrélation {corr:.2f})")
if corr < 0.05:
    sys.exit("Tour incomplet: pas de recouvrement détecté")

# 4. Alignement fin des deux passages sur la zone de recouvrement (corrige la dérive accumulée)
ov = CW - period
A = cv2.cvtColor(lin[:, period:], cv2.COLOR_BGR2GRAY).astype(np.float32)   # 2e passage
B = cv2.cvtColor(lin[:, :ov], cv2.COLOR_BGR2GRAY).astype(np.float32)       # 1er passage, même zone
(ddx, ddy), _ = cv2.phaseCorrelate(cv2.Sobel(B, cv2.CV_32F, 1, 0), cv2.Sobel(A, cv2.CV_32F, 1, 0),
                                   cv2.createHanningWindow((ov, H), cv2.CV_32F))
period_f = period + ddx
lin1 = cv2.warpAffine(lin, np.float32([[1, 0, 0], [0, 1, ddy]]), (CW, H))  # 1er passage recalé sur le 2e
print(f"recalage des passages: dx={ddx:+.1f}px dy={ddy:+.1f}px -> circonférence {period_f:.1f}px")

# 5. Détection du bord de l'étiquette: colonne sombre sur toute la hauteur (jonction début/fin)
gray = cv2.cvtColor(lin, cv2.COLOR_BGR2GRAY).astype(np.float32)
dark = np.median(255 - gray[int(H * .18):int(H * .95)], axis=0)
dark[~filled] = 0
dark = np.convolve(dark, np.ones(5) / 5, 'same')
centre = int(np.argmax(dark[W:CW - W])) + W
seuil = (dark[centre] + np.median(dark[filled])) / 2
gauche = droite = centre
while dark[gauche - 1] > seuil: gauche -= 1
while dark[droite + 1] > seuil: droite += 1
jonction = droite - gauche + 1
print(f"jonction de l'étiquette: colonnes {gauche}-{droite}")

# 6. Début de l'étiquette = juste après la jonction. On prend le 2e passage, puis on complète
#    avec le 1er passage (décalé d'un tour), en raccordant au milieu de la zone de recouvrement.
debut = droite + 1
longueur = int(round(period_f)) - jonction
raccord = period + ov // 2                       # colonne du raccord dans le panorama linéaire
x = np.arange(debut, debut + longueur, dtype=np.float32)
mx = np.where(x < raccord, x, x - period_f).astype(np.float32)
src_img = np.where((x < raccord)[None, :, None],
                   cv2.remap(lin, np.tile(mx, (H, 1)), np.tile(np.arange(H, dtype=np.float32)[:, None], (1, longueur)), cv2.INTER_LINEAR),
                   cv2.remap(lin1, np.tile(mx, (H, 1)), np.tile(np.arange(H, dtype=np.float32)[:, None], (1, longueur)), cv2.INTER_LINEAR))
cv2.imwrite(sys.argv[2], src_img)
print("sortie", longueur, "x", H)
