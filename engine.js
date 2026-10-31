/* Moteur de scan : assemble l'étiquette en panorama pendant que la fiole tourne, détecte le tour complet,
   puis la met à plat de bord à bord. Il ne connaît que les pixels de la zone d'intérêt (RGBA, W × H) ;
   l'interface s'occupe de la caméra. Les choix sont expliqués dans CLAUDE.md. */
(function(){
'use strict';
const CAP = 6000, OFF = 3000, MARGIN = 6;   // colonnes du panorama, origine au centre
const CLOSURE_OPS = 1.5e6;                  // travail de recherche du tour complet par image (quelques ms sur téléphone)
const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

class ScanEngine{
  constructor(W, H){
    this.W = W; this.H = H; this.H2 = H >> 1;
    this.mos = new Uint8ClampedArray(CAP * H * 4);      // panorama RGBA, rangée par rangée
    this.gm = new Float32Array(CAP * this.H2);           // panorama en gris (une ligne sur deux), colonne par colonne
    this.best = new Float32Array(CAP).fill(-1e9); this.filled = new Uint8Array(CAP);
    this.prevFx = null; this.pos = 0; this.ypos = 0; this.lastDx = 0;
    this.frames = 0; this.rejected = 0; this.sharpHist = []; this.umin = 1e9; this.umax = -1e9;
    this.closures = []; this.period = 0; this.cl = null; this.trace = [];
    this.regD = 3; this.regX = 14; this.regStep = 2; this.mosStep = 2; this.mosR = 10; this.mosaicOnly = false;
    this.ops = CLOSURE_OPS; this.ystep = 4; this.minC = .3; this.minGap = .12;
  }

  // gris (toutes les colonnes, une ligne sur deux) et son gradient horizontal
  analyse(px){
    const { W, H2 } = this, g = new Float32Array(W * H2), fx = new Float32Array(W * H2); let sharp = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W; x++){
      const i = ((2 * y) * W + x) * 4, j = i + W * 4;
      g[y * W + x] = (px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114 + px[j] * .299 + px[j + 1] * .587 + px[j + 2] * .114) / 2;
    }
    for (let y = 0; y < H2; y++) for (let x = 1; x < W - 1; x++){ const v = g[y * W + x + 1] - g[y * W + x - 1]; fx[y * W + x] = v; sharp += Math.abs(v); }
    return { px, g, fx, sharp: sharp / (W * H2) };
  }

  // Décalage (dx, dy) tel que cur[y][x] ≈ prev[y-dy][x-dx], cherché autour du dernier mouvement.
  // Recherche grossière (un dx sur deux) puis affinage autour du meilleur : deux fois moins de calcul.
  register(a, b){
    const { W, H2 } = this, S = Math.round(W * .45), D = this.regD, X = this.regX, st = this.regStep;
    const c0 = Math.round(this.lastDx), lo = Math.max(-S, c0 - X), hi = Math.min(S, c0 + X);
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
    return { dx: bx + sub, dy: 2 * by };
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
    return { pos: p0 + bp + sub, ypos: 2 * (yo2 + bd) };
  }

  // Une image de plus. Renvoie l'état pour l'interface.
  push(px){
    const f = this.analyse(px); this.frames++;
    if (this.prevFx){
      let r = null, m = null;
      if (this.mosaicOnly && this.umax > this.umin) m = this.registerMosaic(f.fx, this.pos + this.lastDx);
      if (!m){
        r = this.register(this.prevFx, f.fx);                                              // estimation grossière image par image…
        m = this.umax > this.umin ? this.registerMosaic(f.fx, this.pos + r.dx) : null;     // …affinée sur le panorama
      }
      if (m){ this.lastDx = m.pos - this.pos; this.pos = m.pos; this.ypos = m.ypos; }
      else { this.pos += r.dx; this.ypos += r.dy; this.lastDx = r.dx; }
    }
    this.prevFx = f.fx;
    this.sharpHist.push(f.sharp); if (this.sharpHist.length > 45) this.sharpHist.shift();
    const med = median(this.sharpHist);
    // les images floues (à-coups de rotation) n'entrent pas dans le panorama
    if (this.frames > 3 && f.sharp < .6 * med) this.rejected++;
    else this.write(f, Math.log(f.sharp / med));
    if (!this.period){
      if (!this.cl && this.umax - this.umin > 2.5 * this.W) this.startClosure(f);
      if (this.cl) this.stepClosure();
    }
    const cov = this.period ? this.coverage() : { coverage: 0, gap: 0 };
    // fin du scan : tout le tour a été vu, à de petits trous près (4 colonnes au plus, comblés par les voisines à la mise à plat)
    const done = !!this.period && cov.gap <= 4;
    return { frames: this.frames, rejected: this.rejected, extent: Math.max(0, this.umax - this.umin + 1), period: this.period,
      coverage: cov.coverage, tooFast: Math.abs(this.lastDx) > this.W * .3, done };
  }

  write(f, imgScore){
    const { W, H, H2, mos, gm, best, filled } = this, yo = Math.round(this.ypos), yo2 = Math.round(this.ypos / 2);
    for (let x = MARGIN; x < W - MARGIN; x++){
      const u = Math.round(x - this.pos) + OFF; if (u < 1 || u >= CAP - 1) continue;
      const s = -Math.abs(x - W / 2) / (W / 2) + imgScore;  // préférence pour le centre de la fenêtre et les images nettes
      if (s <= best[u]) continue;
      best[u] = s; filled[u] = 1; if (u < this.umin) this.umin = u; if (u > this.umax) this.umax = u;
      for (let y = 0; y < H; y++){        // ligne du panorama = ligne de l'image - ypos
        const fy = y + yo, o = (y * CAP + u) * 4;
        if (fy < 0 || fy >= H){ mos[o + 3] = 0; continue; }
        const i = (fy * W + x) * 4; mos[o] = f.px[i]; mos[o + 1] = f.px[i + 1]; mos[o + 2] = f.px[i + 2]; mos[o + 3] = 255;
      }
      for (let y = 0; y < H2; y++){ const fy = Math.min(H2 - 1, Math.max(0, y + yo2)); gm[u * H2 + y] = f.g[fy * W + x]; }
    }
  }

  // Fermeture de boucle : l'image en cours ressemble-t-elle à une zone du panorama vue loin d'ici ?
  // La recherche parcourt tout le panorama, ce qui coûte de plus en plus cher : on fige l'image au départ,
  // puis on avance par tranches de CLOSURE_OPS opérations à chaque image, pour ne jamais bloquer l'aperçu.
  startClosure(f){
    const { W, H2 } = this, yo2 = Math.round(this.ypos / 2), cols = [], R = 6, ys = [];
    for (let x = MARGIN; x < W - MARGIN; x += 2) cols.push(x);
    for (let y = R + 2; y < H2 - R - 2; y += this.ystep) ys.push(y);
    const fa = new Float32Array(cols.length * ys.length); let i = 0, fn = 0;
    for (const x of cols) for (const y of ys){ const v = f.fx[Math.min(H2 - 1, Math.max(0, y + yo2)) * W + x]; fa[i++] = v; fn += v * v; }
    if (fn === 0) return;
    // ucur : colonne du panorama sous la 1re colonne comparée
    this.cl = { cols, ys, fa, fn, R, ucur: Math.round(cols[0] - this.pos) + OFF, u0: this.umin + 2, umax: this.umax, top: { c: -1 }, all: [] };
  }
  stepClosure(){
    const { W, H2, gm, filled } = this, cl = this.cl, { cols, ys, fa, fn, R, ucur, all } = cl, end = cl.umax - 2 * cols.length - 2;
    const per = (2 * R + 1) * cols.length * ys.length;
    for (let budget = this.ops; cl.u0 < end && budget > 0; cl.u0 += 2){
      const u0 = cl.u0;
      if (Math.abs(u0 - ucur) < 2 * W) continue;
      let ok = true; for (let k = 0; k < cols.length; k++) if (!filled[u0 + 2 * k - 1] || !filled[u0 + 2 * k + 1]){ ok = false; break; }
      if (!ok) continue;
      budget -= per;
      for (let dy = -R; dy <= R; dy++){
        let s = 0, n2 = 0, i = 0;
        for (let k = 0; k < cols.length; k++){
          const ua = (u0 + 2 * k + 1) * H2 + dy, ub = (u0 + 2 * k - 1) * H2 + dy;
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
    const P = close.reduce((m, p) => p.d > 2 * W && p.d < m ? p.d : m, Infinity);
    const periodic = p => { const k = Math.max(1, Math.round(p.d / P)); return Math.abs(p.d - k * P) <= Math.max(6, .02 * p.d); };
    const second = peaks.filter(p => !(P < Infinity && periodic(p))).reduce((m, p) => p.c > m ? p.c : m, -1);
    this.trace.push({ frame: this.frames, c: +top.c.toFixed(3), second: +second.toFixed(3), P: P < Infinity ? P : 0 });   // pour le diagnostic
    if (this.trace.length > 50) this.trace.shift();
    // le vrai raccord se détache nettement de tout candidat qui n'est pas un multiple du tour (écart ≥ 0,12)
    if (P === Infinity || top.c < this.minC || top.c - second < this.minGap) return;
    // il faut deux détections concordantes parmi les dernières pour valider le tour
    const agree = this.closures.slice(-4).filter(q => Math.abs(q - P) <= 4);
    this.closures.push(P);
    if (agree.length) this.period = Math.round((agree[agree.length - 1] + P) / 2);
  }

  coverage(){
    const m = this.coverageMap(this.period), P = this.period; let n = 0, gap = 0, run = 0;
    for (const v of m) n += v;
    if (n < P) for (let i = 0; i < 2 * P; i++){ if (m[i % P]) run = 0; else if (++run > gap) gap = run; }
    return { coverage: n / P, gap: Math.min(gap, P) };
  }
  // couverture du tour répartie en n cases (pour la barre de progression)
  coverageMap(n){
    const out = new Uint8Array(n), P = this.period; if (!P) return out;
    for (let u = this.umin; u <= this.umax; u++) if (this.filled[u]) out[Math.floor(((u - OFF) % P + P) % P / P * n)] = 1;
    return out;
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
    // une colonne x vient de x, ou de x - P (même endroit, un tour plus tôt) si x dépasse le panorama
    const src = x => { if (x <= umax && filled[x]) return x; if (filled[x - P]) return x - P; if (filled[x + P]) return x + P; return -1; };
    // décalage vertical entre les deux passages, mesuré sur la zone vue deux fois
    let shift = 0;
    const seam = Math.min(umax, start + len - 1) - 20, wraps = start + len - 1 > umax;
    if (wraps){
      let bestC = -2;
      for (let dy = -12; dy <= 12; dy++){
        let s = 0, na = 0, nb = 0;
        for (let u = seam - 40; u < seam; u++){
          if (!filled[u] || !filled[u - P]) continue;
          for (let y = 14; y < H2 - 14; y++){ const a = gm[u * H2 + y], b = gm[(u - P) * H2 + y + dy]; s += a * b; na += a * a; nb += b * b; }
        }
        const c = s / Math.sqrt(na * nb + 1e-9); if (c > bestC){ bestC = c; shift = 2 * dy; }
      }
    }
    const canvas = document.createElement('canvas'); canvas.width = len; canvas.height = H;
    const img = new ImageData(len, H);
    for (let k = 0; k < len; k++){
      const x = start + k;
      let u = wraps && x > seam ? (filled[x - P] ? x - P : src(x)) : src(x);
      for (let d = 1; u < 0 && d <= 8; d++) u = src(x - d) >= 0 ? src(x - d) : src(x + d);   // petit trou : colonne voisine
      if (u < 0) continue;
      const dy = u < x - 8 ? shift : 0;   // colonne prise un tour plus tôt
      for (let y = 0; y < H; y++){
        const sy = Math.min(H - 1, Math.max(0, y + dy)), o = (sy * CAP + u) * 4, d = (y * len + k) * 4;
        img.data[d] = mos[o]; img.data[d + 1] = mos[o + 1]; img.data[d + 2] = mos[o + 2]; img.data[d + 3] = 255;
      }
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    return { canvas, junction };
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
