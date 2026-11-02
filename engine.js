/* Moteur de scan : assemble l'étiquette en panorama pendant que la fiole tourne, détecte le tour complet,
   puis la met à plat de bord à bord. Il ne connaît que les pixels de la zone d'intérêt (RGBA, W × H) ;
   l'interface s'occupe de la caméra. Les choix sont expliqués dans CLAUDE.md. */
(function(){
'use strict';
// colonnes du panorama, origine au centre. Une fiole filmée en 4K de près fait ~2300 px de tour (vidéo de
// l'utilisateur) : il faut pouvoir dérouler plus d'un tour dans un seul sens.
const CAP = 12000, OFF = 6000, MARGIN = 6;
const MINP = 3;                             // circonférence minimale, en largeurs de bande (π ≈ 3,14 : la bande est posée sur la fiole)
const CLOSURE_OPS = 1.5e6;                  // travail de recherche du tour complet par image (quelques ms sur téléphone)
const REFQ_MIN = 1.5, NET = .45;            // une colonne est nette si Q ≥ NET × la netteté de référence (voir analyse)
const SETTLE = 3;                           // images de suite sans mouvement vertical avant de commencer le panorama
const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

class ScanEngine{
  constructor(W, H){
    this.W = W; this.H = H; this.H2 = H >> 1;
    this.mos = new Uint8ClampedArray(CAP * H * 4);      // panorama RGBA, rangée par rangée
    this.gm = new Float32Array(CAP * this.H2);           // panorama en gris (une ligne sur deux), colonne par colonne
    this.best = new Float32Array(CAP).fill(-1e9); this.filled = new Uint8Array(CAP);
    this.qcol = new Float32Array(CAP); this.steady = new Uint8Array(CAP);   // netteté (Q) et stabilité verticale de la capture gardée
    this.qHist = []; this.refQ = REFQ_MIN; this.settled = 0; this.started = false;
    this.prevFx = null; this.pos = 0; this.ypos = 0; this.lastDx = 0;
    this.frames = 0; this.rejected = 0; this.sharpHist = []; this.umin = 1e9; this.umax = -1e9;
    this.closures = []; this.period = 0; this.cl = null; this.trace = []; this.hintP = 0; this.hintTries = 0;
    this.regD = 3; this.regX = 14; this.regStep = 2; this.mosStep = 2; this.mosR = 10; this.mosaicOnly = false;
    this.ops = CLOSURE_OPS; this.ystep = 8; this.closR = 16; this.cstep = 4; this.closDy = 2; this.kappa = 4; this.coarseAlways = true; this.minC = .3; this.minGap = .12;
  }

  // gris (toutes les colonnes, une ligne sur deux) et son gradient horizontal
  analyse(px){
    const { W, H2 } = this, g = new Float32Array(W * H2), fx = new Float32Array(W * H2); let sharp = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W; x++){
      const i = ((2 * y) * W + x) * 4, j = i + W * 4;
      g[y * W + x] = (px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114 + px[j] * .299 + px[j + 1] * .587 + px[j + 2] * .114) / 2;
    }
    for (let y = 0; y < H2; y++) for (let x = 1; x < W - 1; x++){ const v = g[y * W + x + 1] - g[y * W + x - 1]; fx[y * W + x] = v; sharp += Math.abs(v); }
    // gradient à demi-largeur (somme de deux colonnes), pour la recherche grossière du mouvement
    const Wh = W >> 1, fxh = new Float32Array(Wh * H2);
    for (let y = 0; y < H2; y++) for (let i = 0; i < Wh; i++) fxh[y * Wh + i] = fx[y * W + 2 * i] + fx[y * W + 2 * i + 1];
    // Flou de bougé : rapport entre l'énergie du gradient fin (pas de 2 px) et celle du gradient large (8 px), en
    // horizontal (Rx) et en vertical (Ry). Une rotation floute seulement en horizontal : Q = Rx / Ry chute (vidéo de
    // test, fenêtres de 13 colonnes : nette 0,97 à 2,35 ; floutée de 5 px 0,40 à 0,97). Le rapport ne dépend presque
    // pas du contraste ni de la mise au point, contrairement à la somme des gradients qui variait du simple au
    // quadruple selon le texte vu (zones blanches, gros chiffres).
    const a2 = new Float32Array(W), a8 = new Float32Array(W), b2 = new Float32Array(W), b8 = new Float32Array(W);
    for (let y = 2; y < H2 - 2; y++) for (let x = 4; x < W - 4; x++){
      const i = y * W + x; let v = g[i + 1] - g[i - 1]; a2[x] += v * v; v = g[i + 4] - g[i - 4]; a8[x] += v * v;
      v = g[i + W] - g[i]; b2[x] += v * v; v = g[i + 2 * W] - g[i - 2 * W]; b8[x] += v * v;
    }
    const q = new Float32Array(W), Rw = 6, tex = 50 * (H2 - 4) * (2 * Rw + 1); let A2 = 0, A8 = 0, B2 = 0, B8 = 0;
    for (let x = 4; x < W - 4; x++){ A2 += a2[x]; A8 += a8[x]; B2 += b2[x]; B8 += b8[x]; }
    for (let x = 0; x < W; x++){
      let p = 0, r8 = 0, r2 = 0, t = 0;
      for (let k = Math.max(4, x - Rw); k <= Math.min(W - 5, x + Rw); k++){ p += a2[k]; r8 += a8[k]; r2 += b2[k]; t += b8[k]; }
      // fenêtre sans texture (zone blanche) : rien à lire, donc rien de flou
      q[x] = r8 + t < tex ? 9 : (p / (r8 + 1e-6)) / ((r2 + 1e-6) / (t + 1e-6));
    }
    const qf = A8 + B8 < tex * W / (2 * Rw + 1) ? 0 : (A2 / A8) / (B2 / B8);
    return { px, g, fx, fxh, sharp: sharp / (W * H2), q, qf };
  }

  // Recherche grossière du mouvement sur TOUTE la plage possible (±0,45 largeur), à demi-résolution.
  // Ne chercher qu'autour de la vitesse précédente s'emballait : après un à-coup, la vitesse estimée montait,
  // la vraie valeur sortait de la fenêtre et l'erreur s'entretenait (vidéo de l'utilisateur : 40 à 70 px/image
  // estimés pour ~20 réels, lettres répétées « cccccc » dans le panorama).
  // Continuité douce : un écart à la vitesse précédente coûte (1 + kappa × (écart / largeur)²). Sans elle, la
  // recherche large se trompe sur certaines images floues ou tremblées (vidéo de test : circonférence 7 % trop
  // courte) ; avec une fenêtre stricte, elle ne rattrape plus un à-coup.
  coarseShift(a, b){
    const { H2, regD: D } = this, Wh = this.W >> 1, S = Math.round(Wh * .45), v = this.lastDx / 2, K = this.kappa;
    let bestC = Infinity, bx = 0, by = 0;
    for (let dy = -D; dy <= D; dy++) for (let dx = -S; dx <= S; dx++){
      const x0 = Math.max(0, dx), x1 = Math.min(Wh, Wh + dx), y0 = Math.max(0, dy), y1 = Math.min(H2, H2 + dy);
      let s = 0, n = 0;
      for (let y = y0; y < y1; y += 4){ const ra = (y - dy) * Wh - dx, rb = y * Wh; for (let x = x0; x < x1; x++){ const d = b[rb + x] - a[ra + x]; s += d * d; } n += x1 - x0; }
      const c = s / n * (1 + K * ((dx - v) / Wh) ** 2); if (c < bestC){ bestC = c; bx = dx; by = dy; }
    }
    return 2 * bx;
  }

  // Décalage (dx, dy) tel que cur[y][x] ≈ prev[y-dy][x-dx], cherché autour du dernier mouvement.
  // Recherche grossière (un dx sur deux) puis affinage autour du meilleur : deux fois moins de calcul.
  register(a, b, center = this.lastDx, X = this.regX){
    const { W, H2 } = this, S = Math.round(W * .45), D = this.regD, st = this.regStep;
    const c0 = Math.round(center), lo = Math.max(-S, c0 - X), hi = Math.min(S, c0 + X);
    const cost = (dx, dy) => {
      const x0 = Math.max(1, 1 + dx), x1 = Math.min(W - 1, W - 1 + dx), y0 = Math.max(0, dy), y1 = Math.min(H2, H2 + dy);
      if (dx < lo || dx > hi || x1 - x0 < W * .45) return NaN;
      let s = 0, n = 0;
      for (let y = y0; y < y1; y += st){ const ra = (y - dy) * W - dx, rb = y * W; for (let x = x0; x < x1; x++){ const d = b[rb + x] - a[ra + x]; s += d * d; } n += x1 - x0; }
      return s / n;
    };
    let bestC = Infinity, bx = 0, by = 0;
    for (let dy = -D; dy <= D; dy++) for (let dx = lo; dx <= hi; dx += 2){ const c = cost(dx, dy); if (c < bestC){ bestC = c; bx = dx; by = dy; } }
    let l = cost(bx - 1, by), r = cost(bx + 1, by);
    if (l < bestC || r < bestC){ bx += l < r ? -1 : 1; bestC = Math.min(l, r); l = cost(bx - 1, by); r = cost(bx + 1, by); }
    let sub = 0; if (l === l && r === r){ const den = l - 2 * bestC + r; if (den > 0) sub = .5 * (l - r) / den; }
    // edge : le meilleur décalage touche le bord de la fenêtre, le vrai mouvement est sans doute au-delà
    return { dx: bx + sub, dy: 2 * by, cost: bestC, edge: (bx <= lo + 1 && lo > -S) || (bx >= hi - 1 && hi < S) };
  }

  // Position absolue de l'image dans le panorama, autour de la prédiction : l'erreur ne s'accumule pas.
  // Même principe : une position sur deux, puis affinage.
  registerMosaic(fx, pred){
    const { W, H2, gm, filled } = this, p0 = Math.round(pred), yo2 = Math.round(this.ypos / 2), R = 4, rows = [], PR = this.mosR;
    for (let y = R + 2; y < H2 - R - 2; y += this.mosStep) rows.push(y);
    const cost = (dp, dy) => {
      if (dp < -PR || dp > PR) return NaN;
      const p = p0 + dp; let s = 0, n = 0;
      for (let x = MARGIN; x < W - MARGIN; x++){
        const u = x - p + OFF; if (!filled[u - 1] || !filled[u + 1]) continue;
        const a = (u + 1) * H2 - yo2 - dy, b = (u - 1) * H2 - yo2 - dy;
        for (const y of rows){ const d = fx[y * W + x] - (gm[a + y] - gm[b + y]); s += d * d; }
        n++;
      }
      return n < (W - 2 * MARGIN) * .35 ? NaN : s / n;
    };
    let bestC = Infinity, bp = 0, bd = 0;
    for (let dp = -PR; dp <= PR; dp += 2) for (let dy = -3; dy <= 3; dy++){ const c = cost(dp, dy); if (c < bestC){ bestC = c; bp = dp; bd = dy; } }
    if (bestC === Infinity) return null;
    let l = cost(bp - 1, bd), r = cost(bp + 1, bd);
    if (l < bestC || r < bestC){ bp += l < r ? -1 : 1; bestC = Math.min(l, r); l = cost(bp - 1, bd); r = cost(bp + 1, bd); }
    let sub = 0; if (l === l && r === r){ const den = l - 2 * bestC + r; if (den > 0) sub = .5 * (l - r) / den; }
    return { pos: p0 + bp + sub, ypos: 2 * (yo2 + bd), cost: bestC };
  }

  // Une image de plus. Renvoie l'état pour l'interface.
  push(px){
    const f = this.analyse(px); this.frames++;
    // On attend que la fiole soit posée : tant qu'elle bouge verticalement (on l'enfonce dans le socle), ses images
    // ne vont pas dans le panorama. Chez l'utilisateur, les deux bords abîmés de l'étiquette venaient de ce moment-là.
    if (!this.started){
      if (this.prevFx) this.settled = Math.abs(this.register(this.prevFx, f.fx, 0, Math.round(this.W * .45)).dy) <= 2 ? this.settled + 1 : 0;
      this.prevFx = f.fx; this.prevFxh = f.fxh;
      if (this.settled < SETTLE) return { frames: this.frames, rejected: 0, extent: 0, period: 0, coverage: 0, blurry: 0, tooFast: false, done: false, settling: true };
      this.started = true;
    }
    const y0 = this.ypos;
    if (this.prevFx && this.umax > this.umin){
      let r = null, m = null;
      if (this.mosaicOnly) m = this.registerMosaic(f.fx, this.pos + this.lastDx);
      if (!m){
        // estimation image par image : autour de la vitesse précédente (précis), et autour du résultat d'une
        // recherche grossière sur toute la plage (rattrape un emballement) ; on garde la meilleure correspondance
        r = this.register(this.prevFx, f.fx);
        // fenêtre dépassée (début d'emballement) : on reprend autour d'une recherche grossière sur toute la plage.
        // Pas systématiquement : sur une étiquette aux motifs répétés, la recherche large se trompe parfois
        // (vidéo de test : circonférence 7 % trop courte si on la prend à chaque image).
        if (this.coarseAlways || r.edge) r = this.register(this.prevFx, f.fx, this.coarseShift(this.prevFxh, f.fxh), 4);
        // …affinée sur le panorama, sauf pour une image floue : son gradient, écrasé, se recale mal sur un panorama
        // net (simulation : circonférence fausse de 25 %) ; la comparer à l'image d'avant, floue aussi, est plus sûr
        if (!(f.qf > 0 && f.qf < .5 * this.refQ)) m = this.registerMosaic(f.fx, this.pos + r.dx);
      }
      if (m){ this.lastDx = m.pos - this.pos; this.pos = m.pos; this.ypos = m.ypos; }
      else { this.pos += r.dx; this.ypos += r.dy; this.lastDx = r.dx; }
    }
    this.prevFx = f.fx; this.prevFxh = f.fxh;
    // netteté de référence : les images les plus nettes de ce scan (3e quartile), au moins REFQ_MIN pour qu'un scan
    // entièrement flou ne se juge pas net
    if (f.qf > 0){ this.qHist.push(f.qf); if (this.qHist.length > 900) this.qHist.shift(); }
    if (this.frames % 5 === 0 && this.qHist.length >= 8){ const s = [...this.qHist].sort((p, q) => p - q); this.refQ = Math.max(REFQ_MIN, s[Math.floor(s.length * .75)]); }
    const steady = Math.abs(this.ypos - y0) <= 3;
    if (f.qf > 0 && f.qf < NET * this.refQ) this.rejected++;
    this.write(f, steady);
    if (!this.period){
      if (!this.cl && this.umax - this.umin > 3.5 * this.W) this.startClosure(f);
      if (this.cl) this.stepClosure();
    }
    const cov = this.period ? this.coverage() : { coverage: 0, gap: 0, blurry: 0 };
    // fin du scan : tout le tour a été vu NET, à de petits trous près (4 colonnes au plus, comblés par les voisines à
    // la mise à plat). Reconnaître le tour ne suffit plus : une zone vue seulement floue fait continuer le scan.
    const done = !!this.period && cov.gap <= 4;
    return { frames: this.frames, rejected: this.rejected, extent: Math.max(0, this.umax - this.umin + 1), period: this.period,
      coverage: cov.coverage, blurry: cov.blurry, tooFast: Math.abs(this.lastDx) > this.W * .2, done };
  }

  // Chaque colonne du panorama garde sa meilleure capture : la plus nette, prise au centre de la fenêtre et sans
  // mouvement vertical. La netteté locale (q) de la capture gardée est notée, pour savoir s'il reste des zones floues.
  // Une capture floue n'occupe une colonne que tant qu'aucune meilleure n'est passée.
  write(f, steady){
    const { W, H, H2, mos, gm, best, filled } = this, yo = Math.round(this.ypos), yo2 = Math.round(this.ypos / 2);
    // Pénalité pour l'image entière, pas pour chaque colonne : avec une note par colonne, deux colonnes voisines
    // venaient souvent d'images différentes et le texte se hachait (petites erreurs de recalage à chaque raccord).
    // Seulement une pénalité, pas de bonus : un bonus de netteté faisait préférer des colonnes vues au bord de la
    // fenêtre, déformées par le cylindre, et créait des sauts verticaux. Q varie avec le texte vu, donc on ne
    // pénalise que nettement en dessous de la référence.
    const frameScore = -(f.qf > 0 ? 4 * Math.max(0, Math.log(.8 * this.refQ / f.qf)) : 0) - (steady ? 0 : 2);
    for (let x = MARGIN; x < W - MARGIN; x++){
      const u = Math.round(x - this.pos) + OFF; if (u < 1 || u >= CAP - 1) continue;
      const s = -Math.abs(x - W / 2) / (W / 2) + frameScore;
      if (s <= best[u]) continue;
      best[u] = s; filled[u] = 1; this.qcol[u] = f.q[x]; this.steady[u] = steady ? 1 : 0;
      if (u < this.umin) this.umin = u; if (u > this.umax) this.umax = u;
      for (let y = 0; y < H; y++){        // ligne du panorama = ligne de l'image - ypos
        const fy = y + yo, o = (y * CAP + u) * 4;
        if (fy < 0 || fy >= H){ mos[o + 3] = 0; continue; }
        const i = (fy * W + x) * 4; mos[o] = f.px[i]; mos[o + 1] = f.px[i + 1]; mos[o + 2] = f.px[i + 2]; mos[o + 3] = 255;
      }
      for (let y = 0; y < H2; y++){ const fy = Math.min(H2 - 1, Math.max(0, y + yo2)); gm[u * H2 + y] = f.g[fy * W + x]; }
    }
  }
  good(u){ return this.filled[u] && this.steady[u] && this.qcol[u] >= NET * this.refQ; }

  // Fermeture de boucle : l'image en cours ressemble-t-elle à une zone du panorama vue loin d'ici ?
  // La recherche parcourt tout le panorama, ce qui coûte de plus en plus cher : on fige l'image au départ,
  // puis on avance par tranches de CLOSURE_OPS opérations à chaque image, pour ne jamais bloquer l'aperçu.
  startClosure(f){
    // R : décalage vertical cherché entre deux tours (lignes de demi-hauteur). Fiole tenue à la main : la hauteur
    // de l'étiquette varie de 20 à 50 px d'un tour à l'autre (vidéo de l'utilisateur), d'où ±16 lignes (±32 px).
    const { W, H2 } = this, yo2 = Math.round(this.ypos / 2), cols = [], R = this.closR, ys = [];
    for (let x = MARGIN; x < W - MARGIN; x += this.cstep) cols.push(x);
    for (let y = R + 2; y < H2 - R - 2; y += this.ystep) ys.push(y);
    const fa = new Float32Array(cols.length * ys.length); let i = 0, fn = 0;
    for (const x of cols) for (const y of ys){ const v = f.fx[Math.min(H2 - 1, Math.max(0, y + yo2)) * W + x]; fa[i++] = v; fn += v * v; }
    if (fn === 0) return;
    // ucur : colonne du panorama sous la 1re colonne comparée
    this.cl = { cols, ys, fa, fn, R, ucur: Math.round(cols[0] - this.pos) + OFF, u0: this.umin + 2, umax: this.umax, top: { c: -1 }, all: [] };
  }
  stepClosure(){
    const { W, H2, gm, filled } = this, cl = this.cl, { cols, ys, fa, fn, R, ucur, all } = cl, end = cl.umax - this.cstep * cols.length - 2, cs = this.cstep;
    const per = (2 * Math.floor(R / this.closDy) + 1) * cols.length * ys.length;
    for (let budget = this.ops; cl.u0 < end && budget > 0; cl.u0 += 2){
      const u0 = cl.u0;
      if (Math.abs(u0 - ucur) < MINP * W) continue;   // un tour fait au moins π × la largeur de la bande (elle est posée sur la fiole)
      if (this.hintP && Math.abs(Math.abs(ucur - u0) - this.hintP) > 12) continue;   // confirmation rapide
      let ok = true; for (let k = 0; k < cols.length; k++) if (!filled[u0 + cs * k - 1] || !filled[u0 + cs * k + 1]){ ok = false; break; }
      if (!ok) continue;
      budget -= per;
      for (let dy = -R; dy <= R; dy += this.closDy){
        let s = 0, n2 = 0, i = 0;
        for (let k = 0; k < cols.length; k++){
          const ua = (u0 + cs * k + 1) * H2 + dy, ub = (u0 + cs * k - 1) * H2 + dy;
          for (const y of ys){ const m = gm[ua + y] - gm[ub + y]; s += fa[i++] * m; n2 += m * m; }
        }
        const c = s / Math.sqrt(fn * n2 + 1e-9);
        if (c > cl.top.c) cl.top = { c, u0 };
        all.push({ c, u0 });
      }
    }
    if (cl.u0 < end) return;   // la recherche continuera à l'image suivante
    this.cl = null;
    const top = cl.top;
    // Pics de ressemblance (meilleur NCC par position, maxima locaux à ±10 colonnes)
    const best = new Map(); for (const v of all) if (!(best.get(v.u0) >= v.c)) best.set(v.u0, v.c);
    const bu = [...best].sort((p, q) => p[0] - q[0]), peaks = [];
    for (let i = 0; i < bu.length; i++){
      const [u0, c] = bu[i]; let ok = true;
      for (let j = i - 1; ok && j >= 0 && u0 - bu[j][0] <= 10; j--) if (bu[j][1] > c) ok = false;
      for (let j = i + 1; ok && j < bu.length && bu[j][0] - u0 <= 10; j++) if (bu[j][1] > c) ok = false;
      if (ok) peaks.push({ u0, c, d: Math.abs(ucur - u0) });
    }
    // Les candidats proches du meilleur ne sont pas forcément des concurrents : quand le panorama couvre plus
    // de deux tours, l'image ressemble autant à la zone vue un tour plus tôt qu'à celle vue deux tours plus tôt.
    // Ces pics-là, espacés d'un multiple du même tour, confirment le tour au lieu de le contredire.
    const close = peaks.filter(p => p.c > top.c - this.minGap);
    const P = close.reduce((m, p) => p.d > MINP * W && p.d < m ? p.d : m, Infinity);
    const periodic = p => { const k = Math.max(1, Math.round(p.d / P)); return Math.abs(p.d - k * P) <= Math.max(6, .04 * p.d); };
    const second = peaks.filter(p => !(P < Infinity && periodic(p))).reduce((m, p) => p.c > m ? p.c : m, -1);
    this.trace.push({ frame: this.frames, c: +top.c.toFixed(3), second: +second.toFixed(3), P: P < Infinity ? P : 0 });   // pour le diagnostic
    if (this.trace.length > 50) this.trace.shift();
    // le vrai raccord se détache nettement de tout candidat qui n'est pas un multiple du tour (écart ≥ 0,12)
    // (en confirmation, la recherche est restreinte autour de la période repérée : l'écart au 2e n'a pas de sens)
    if (this.hintP){
      if (P === Infinity || top.c < this.minC){ if (++this.hintTries >= 3) this.hintP = 0; return; }
    } else if (P === Infinity || top.c < this.minC || top.c - second < this.minGap) return;
    // il faut deux détections concordantes parmi les dernières pour valider le tour
    const agree = this.closures.slice(-4).filter(q => Math.abs(q - P) <= Math.max(4, .01 * P));
    this.closures.push(P);
    // tour repéré mais pas encore confirmé : la recherche suivante ne regarde qu'autour de cette période,
    // ce qui confirme en une ou deux images au lieu de reparcourir tout le panorama (plusieurs secondes)
    if (!agree.length){ this.hintP = P; this.hintTries = 0; }
    if (agree.length) this.period = Math.round((agree[agree.length - 1] + P) / 2);
  }

  // Couverture du tour par des captures nettes : chaque colonne est repliée modulo la circonférence.
  // blurry : part du tour vue, mais seulement floue (pour dire à l'utilisateur de tourner plus lentement)
  coverage(){
    const P = this.period, ok = new Uint8Array(P), seen = new Uint8Array(P);
    for (let u = this.umin; u <= this.umax; u++){ if (!this.filled[u]) continue; const k = ((u - OFF) % P + P) % P; seen[k] = 1; if (this.good(u)) ok[k] = 1; }
    let n = 0, ns = 0, gap = 0, run = 0;
    for (let k = 0; k < P; k++){ n += ok[k]; ns += seen[k]; }
    if (n < P) for (let i = 0; i < 2 * P; i++){ if (ok[i % P]) run = 0; else if (++run > gap) gap = run; }
    return { coverage: n / P, gap: Math.min(gap, P), blurry: (ns - n) / P };
  }

  // Mise à plat finale, de bord à bord. Renvoie { canvas, junction }.
  result(){
    const { H, H2, mos, gm, filled, umin, umax } = this, P = this.period;
    // jonction début/fin : colonne sombre sur presque toute la hauteur
    const dark = new Float32Array(CAP), y0 = Math.round(H * .05), y1 = Math.round(H * .95), col = [];
    for (let u = umin; u <= umax; u++){
      if (!filled[u]) continue; col.length = 0;
      for (let y = y0; y < y1; y += 2){ const o = (y * CAP + u) * 4; col.push(255 - (mos[o] * .299 + mos[o + 1] * .587 + mos[o + 2] * .114)); }
      dark[u] = median(col);
    }
    const sm = new Float32Array(CAP);
    for (let u = umin + 2; u <= umax - 2; u++) sm[u] = (dark[u - 2] + dark[u - 1] + dark[u] + dark[u + 1] + dark[u + 2]) / 5;
    let pk = umin + 2; for (let u = umin + 2; u <= umax - 2; u++) if (sm[u] > sm[pk]) pk = u;
    const vals = []; for (let u = umin; u <= umax; u++) if (filled[u]) vals.push(sm[u]);
    const base = median(vals); let start = umin, len = P, junction = false;
    if (sm[pk] - base > 25){
      const th = (sm[pk] + base) / 2; let l = pk, r = pk;
      while (l > umin && sm[l - 1] > th) l--; while (r < umax && sm[r + 1] > th) r++;
      junction = true; start = r + 1; len = P - (r - l + 1);
      while (start - P >= umin) start -= P;            // occurrence la plus à gauche
    }
    // On suit le panorama tel qu'il a été assemblé, de la jonction jusqu'à un tour plus loin. Mais chaque morceau de
    // l'étiquette a été vu une fois par tour : un bloc de BL colonnes flou ou manquant est pris dans un autre tour,
    // là où il est net. Les tours ne se superposent pas exactement (le suivi recale chaque image sur les colonnes vues
    // juste avant, pas sur le tour précédent : quelques pixels en largeur, 20 à 50 px en hauteur à la main), donc la
    // copie est recalée sur le bloc qu'elle remplace. Choisir colonne par colonne, sans recalage, hachait le texte ;
    // changer de tour sans nécessité ajoutait des raccords.
    const BL = 32, RX = 10, RY = 16, ys = [], has = u => u >= umin && u <= umax && filled[u];
    for (let y = RY + 2; y < H2 - RY - 2; y += 2) ys.push(y);
    const match = (ua, ub) => {   // (dx, dy) tel que la colonne ub + k + dx, ligne y + dy ≈ la colonne ua + k, ligne y
      let bestC = -2, bx = 0, by = 0;
      for (let dx = -RX; dx <= RX; dx++) for (let dy = -RY; dy <= RY; dy += 2){
        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, m = 0;
        for (let k = 0; k < BL; k += 2){
          const a = ua + k, b = ub + k + dx; if (!has(a) || !has(b)) continue;
          for (const y of ys){ const va = gm[a * H2 + y], vb = gm[b * H2 + y + dy]; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; m++; }
        }
        if (m < ys.length * 10) continue;
        const c = (sab - sa * sb / m) / Math.sqrt((saa - sa * sa / m) * (sbb - sb * sb / m) + 1e-9);
        if (c > bestC){ bestC = c; bx = dx; by = dy; }
      }
      return bestC > .3 ? { dx: bx, dy: 2 * by } : null;
    };
    const stat = u0 => { let g = 0, f = 0; for (let k = 0; k < BL; k++){ const u = u0 + k; if (!has(u)) continue; f++; if (this.good(u)) g++; } return { g, f }; };
    const blocks = [], carry = {};   // carry[j] : dernier recalage connu du tour j par rapport au panorama suivi
    for (let x0 = start; x0 < start + len; x0 += BL){
      const w = Math.min(BL, start + len - x0), cand = [];
      for (let j = -3; j <= 3; j++){
        const u = x0 + j * P; if (!has(u) && !has(u + w - 1)) continue;
        let off = j === 0 ? { dx: 0, dy: 0 } : null;
        // recalage mesuré seulement sur un bloc vu en entier des deux côtés : sur quelques colonnes, il se trompait
        if (j && has(x0) && has(x0 + w - 1) && has(u) && has(u + w - 1)){ const m = match(x0, u); if (m){ off = m; carry[j] = m; } }
        if (!off && carry[j]) off = carry[j];
        // pas de recalage possible : seulement en dernier recours
        cand.push({ j, u, off: off || { dx: 0, dy: 0 }, rough: !off, ...stat(u + (off ? off.dx : 0)) });
      }
      // le panorama suivi s'il est net, sinon la copie la plus nette (à égalité, la plus proche)
      let pick = cand.find(c => c.j === 0);
      if (!pick || pick.g < w - 2 || pick.f < w - 2){
        let bs = -Infinity;
        for (const c of cand){ const v = (c.rough ? -1e6 : 0) + c.g * 1000 + c.f * 10 - Math.abs(c.j); if (v > bs){ bs = v; pick = c; } }
      }
      blocks.push(pick);
    }
    const canvas = document.createElement('canvas'); canvas.width = len; canvas.height = H;
    const img = new ImageData(len, H);
    for (let k = 0; k < len; k++){
      const bk = blocks[Math.floor(k / BL)]; if (!bk) continue;
      const u0 = bk.u + bk.off.dx + k % BL; let u = u0;
      for (let d = 1; !has(u) && d <= 8; d++) u = has(u0 - d) ? u0 - d : u0 + d;   // petit trou : colonne voisine
      if (!has(u)) continue;
      for (let y = 0; y < H; y++){
        const sy = Math.min(H - 1, Math.max(0, y + bk.off.dy)), o = (sy * CAP + u) * 4, d = (y * len + k) * 4;
        img.data[d] = mos[o]; img.data[d + 1] = mos[o + 1]; img.data[d + 2] = mos[o + 2]; img.data[d + 3] = 255;
      }
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    return { canvas, junction };
  }

  // Secours quand le tour n'a pas été reconnu en direct : on cherche la circonférence dans le panorama lui-même,
  // en le comparant à lui-même décalé de P colonnes. Ici on corrèle les niveaux de gris (corrélation de Pearson),
  // pas le gradient : le pic est plus large (quelques colonnes) et ne se perd pas entre deux essais.
  // Recherche un P sur deux puis affinage. Environ 0,3 s sur PC pour 3 tours. Renvoie la période, ou 0.
  periodFromPanorama(){
    const { W, H2, gm, filled, umin, umax } = this, R = 16, ys = [];   // même tolérance verticale que ci-dessus
    for (let y = R + 2; y < H2 - R - 2; y += 4) ys.push(y);
    const minN = 1.5 * W / 3 * ys.length;   // recouvrement d'au moins 1,5 largeur de zone
    const corr = P => {
      let best = -1;
      for (let dy = -R; dy <= R; dy += 2){
        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
        for (let u = umin; u + P <= umax; u += 3){
          if (!filled[u] || !filled[u + P]) continue;
          const a0 = u * H2, b0 = (u + P) * H2 + dy;
          for (const y of ys){ const a = gm[a0 + y], b = gm[b0 + y]; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++; }
        }
        if (n < Math.max(minN, .3 * P / 3 * ys.length)) continue;   // recouvrement court : corrélation gonflée, on l'écarte
        const c = (sab - sa * sb / n) / Math.sqrt((saa - sa * sa / n) * (sbb - sb * sb / n) + 1e-9);
        if (c > best) best = c;
      }
      return best;
    };
    const curve = [];
    for (let P = Math.round(MINP * W); P <= umax - umin - 1.5 * W; P += 2) curve.push({ P, c: corr(P) });
    if (curve.length < 3) return 0;
    const top = curve.reduce((m, v) => v.c > m.c ? v : m);
    const sorted = curve.map(v => v.c).sort((p, q) => p - q), med = sorted[sorted.length >> 1];
    // plus petit écart nettement au-dessus du niveau de base et à 60 % du meilleur : un tour (le meilleur peut
    // tomber sur deux tours : 0,67 à 2 tours contre ~0,45 à 1 tour sur la vidéo de l'utilisateur)
    // pics cherchés sur la courbe lissée (±6 colonnes), pour ne pas s'arrêter sur une bosse du flanc montant
    const sm = curve.map((v, i) => { let s = 0, n = 0; for (let j = i - 3; j <= i + 3; j++) if (curve[j] && curve[j].c > -1){ s += curve[j].c; n++; } return n ? s / n : -1; });
    const smTop = Math.max(...sm);
    const ipk = sm.findIndex((v, i) => v >= .6 * smTop && v - med >= .12 && (i === 0 || sm[i - 1] <= v) && (i === sm.length - 1 || sm[i + 1] <= v));
    let k0 = ipk >= 0 ? ipk : curve.indexOf(top);
    for (let j = Math.max(0, k0 - 3); j <= Math.min(curve.length - 1, k0 + 3); j++) if (curve[j].c > curve[k0].c) k0 = j;   // sommet brut à côté
    const pk = curve[k0];
    let P = pk.P, c = pk.c;
    for (const q of [pk.P - 1, pk.P + 1]){ const cq = corr(q); if (cq > c){ c = cq; P = q; } }
    this.trace.push({ frame: this.frames, c: +c.toFixed(3), second: +med.toFixed(3), P, fallback: true });
    // seuil relatif : le niveau de base dépend de l'étiquette (~0,44 sur la vidéo de test, ~0 sur celle de
    // l'utilisateur, dont le vrai pic ne monte qu'à 0,29)
    return c >= .2 && c - med >= .15 ? P : 0;
  }

  // Panorama brut, tel qu'assemblé (scan arrêté avant la fin) : utile pour comprendre ce qui a coincé
  panorama(){
    const { H, mos, umin, umax } = this, w = umax - umin + 1, img = new ImageData(w, H);
    for (let y = 0; y < H; y++) for (let k = 0; k < w; k++){
      const o = (y * CAP + umin + k) * 4, d = (y * w + k) * 4;
      img.data[d] = mos[o]; img.data[d + 1] = mos[o + 1]; img.data[d + 2] = mos[o + 2]; img.data[d + 3] = mos[o + 3] ? 255 : 0;
    }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = H;
    canvas.getContext('2d').putImageData(img, 0, 0);
    return canvas;
  }
}
window.ScanEngine = ScanEngine;
})();
