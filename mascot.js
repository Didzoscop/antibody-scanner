/* Mascotte d'Antibody·Scanner : une fiole d'anticorps en pixel art, dessinée image par image dans un canevas.
   Même densité que la mascotte de Petri·Capture : grille de 70 × 75 pixels, contour noir, ombre au sol.
   Le fichier fournit aussi deux petites animations de l'écran de scan : la fiole qu'on remplace dans son socle,
   et les flèches qui tournent pour inviter à tourner la fiole. */
(function(){
'use strict';
const COL = { ink:[26,26,26], glass:[214,230,226], glassHi:[244,250,248], glassLo:[157,183,177], dark:[118,142,136],
  cap:[217,102,63], capHi:[238,145,108], capLo:[163,70,42], label:[255,255,255], labelLo:[226,232,236],
  stripe:[242,196,107], stripeLo:[204,156,72], liquid:[240,163,190], liquidLo:[205,118,152], socle:[110,197,217], socleLo:[64,150,172], paper:[238,246,251] };
const calmMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);

// Petit tampon de pixels : on peint, on garde un masque de la silhouette, puis on la cerne de noir
class Pix{
  constructor(w, h){ this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); this.mask = new Uint8Array(w * h); }
  clear(){ this.d.fill(0); this.mask.fill(0); }
  set(x, y, c, a){
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x, o = i * 4;
    this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = a == null ? 255 : a;
    if (a == null) this.mask[i] = 1;
  }
  rect(x0, y0, x1, y1, c){ for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, c); }
  outline(){ // contour noir autour de la silhouette
    const { w, h, mask } = this, edge = [];
    for (let i = 0; i < w * h; i++){
      if (mask[i]) continue;
      const x = i % w, y = (i / w) | 0;
      if ((x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) edge.push(i);
    }
    edge.forEach(i => { const o = i * 4; this.d[o] = COL.ink[0]; this.d[o + 1] = COL.ink[1]; this.d[o + 2] = COL.ink[2]; this.d[o + 3] = 255; });
    edge.forEach(i => this.mask[i] = 1);
  }
  shadow(cx, cy, rx, ry){ // ombre au sol, comme Petri : encre translucide sous la silhouette
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++){
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, o = (y * this.w + x) * 4;
      if (!this.d[o + 3] && dx * dx + dy * dy <= 1){ this.d[o] = COL.ink[0]; this.d[o + 1] = COL.ink[1]; this.d[o + 2] = COL.ink[2]; this.d[o + 3] = 46; }
    }
  }
  blit(ctx, img){ img.data.set(this.d); ctx.putImageData(img, 0, 0); }
}

/* La fiole, posée debout, son centre horizontal en cx et le bas du verre en bottom.
   f : visage ({blink, look, smile}) ; cut : on ne dessine pas sous cette ligne (le socle la cache). */
function drawVial(p, cx, bottom, f, cut){
  const H = 60, top = bottom - H, L = cx - 11, R = cx + 11; // flacon allongé, corps de 22 pixels de large
  const lim = cut == null ? p.h : cut;
  const row = (y, x0, x1, pick) => { if (y >= lim) return; for (let x = x0; x < x1; x++) p.set(x, y, pick(x)); };
  const shade = (x, x0, x1, hi, mid, lo) => x <= x0 + 2 ? hi : x >= x1 - 3 ? lo : mid; // reflet à gauche, ombre à droite
  // bouchon à vis, strié
  for (let y = top; y < top + 10; y++){
    const inset = y === top ? 2 : y === top + 1 ? 1 : 0, x0 = cx - 11 + inset, x1 = cx + 11 - inset;
    row(y, x0, x1, x => (x - x0) % 3 === 2 && y > top + 1 ? COL.capLo : shade(x, x0, x1, COL.capHi, COL.cap, COL.capLo));
  }
  row(top + 10, cx - 11, cx + 11, () => COL.capLo);
  // col du flacon
  for (let y = top + 11; y < top + 14; y++) row(y, cx - 9, cx + 9, x => shade(x, cx - 9, cx + 9, COL.glassHi, COL.glass, COL.glassLo));
  // corps : verre, étiquette (bandes colorées), liquide, fond arrondi
  for (let y = top + 14; y < bottom; y++){
    const k = bottom - 1 - y, inset = k === 0 ? 4 : k === 1 ? 2 : k === 2 ? 1 : 0, x0 = L + inset, x1 = R - inset;
    let pick;
    if (y >= top + 19 && y < top + 22 || y >= top + 44 && y < top + 47) pick = x => shade(x, x0, x1, COL.stripe, COL.stripe, COL.stripeLo);
    else if (y >= top + 22 && y < top + 44) pick = x => shade(x, x0, x1, COL.label, COL.label, COL.labelLo);
    else if (y >= top + 50) pick = x => shade(x, x0, x1, COL.liquid, COL.liquid, COL.liquidLo);
    else pick = x => shade(x, x0, x1, COL.glassHi, COL.glass, COL.glassLo);
    row(y, x0, x1, pick);
  }
  // visage sur l'étiquette
  if (f){
    const ex = Math.round(f.look || 0), ey = top + 28, eh = f.blink ? 1 : 4, eo = f.blink ? 2 : 0;
    for (const sx of [cx - 5, cx + 3]) for (let y = 0; y < eh; y++) for (let x = 0; x < 2; x++) if (ey + eo + y < lim) p.set(sx + x + ex, ey + eo + y, COL.ink);
    const my = top + 35;
    if (my + 1 < lim){
      if (f.open){ for (let x = -1; x < 2; x++){ p.set(cx + x + ex, my, COL.ink); p.set(cx + x + ex, my + 1, COL.ink); } }
      else { p.set(cx - 2 + ex, my, COL.ink); p.set(cx + 1 + ex, my, COL.ink); p.set(cx - 1 + ex, my + 1, COL.ink); p.set(cx + ex, my + 1, COL.ink); }
    }
  }
}

/* Mascotte en attente : elle respire (petit sautillement), cligne des yeux et jette un œil de côté de temps en temps. */
class Mascot{
  constructor(el){
    this.el = el; this.t = Math.random() * 3; this.blinkAt = rnd(1.5, 4); this.lookAt = rnd(3, 6); this.look = 0; this.lookT = 0; this.lookEnd = 0;
    const c = this.canvas = document.createElement('canvas'); c.width = 70; c.height = 75; el.appendChild(c);
    this.ctx = c.getContext('2d'); this.img = this.ctx.createImageData(70, 75); this.p = new Pix(70, 75);
  }
  step(dt){
    this.t += dt;
    if (this.t > this.lookAt){ this.lookT = Math.random() < .5 ? -1 : 1; this.lookEnd = this.t + rnd(.8, 1.4); this.lookAt = this.t + rnd(4, 7); }
    if (this.t > this.lookEnd) this.lookT = 0;
    this.look += (this.lookT - this.look) * Math.min(1, dt * 12);
  }
  render(){
    const p = this.p; p.clear();
    const ph = (this.t % 1.6) / 1.6, hop = calmMotion ? 0 : Math.round(2 * Math.max(0, Math.sin(ph * 2 * Math.PI)));
    if (this.t > this.blinkAt + .14) this.blinkAt = this.t + rnd(2, 5);
    const blink = this.t > this.blinkAt;
    drawVial(p, 35, 69 - hop, { blink, look: this.look });
    p.outline(); p.shadow(35, 71.3, 13 - hop, 2.4);
    p.blit(this.ctx, this.img);
  }
}

/* Remplacement de la fiole : celle qui est scannée sort du socle par le haut, la suivante descend à sa place. */
class Swap{
  constructor(el){
    this.el = el; this.t = 0;
    const c = this.canvas = document.createElement('canvas'); c.width = 70; c.height = 96; el.appendChild(c);
    this.ctx = c.getContext('2d'); this.img = this.ctx.createImageData(70, 96); this.p = new Pix(70, 96);
  }
  step(dt){ this.t = (this.t + dt) % 3.4; }
  render(){
    const p = this.p, t = this.t, rest = 88, cut = 78; p.clear();
    const ease = u => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
    let cx = 35, y = rest, face = { look: 0 };
    if (t < 1.4){ y = rest - 70 * ease((t - .25) / 1.0); face = { look: 0, open: t > .25 && t < 1.2 }; }   // la fiole scannée remonte et sort
    else { y = rest - 70 * (1 - ease((t - 1.6) / 1.0)); face = { look: t > 2.7 ? 1 : 0 }; }                  // la suivante descend dans le socle
    if (t >= 1.4 && t < 1.6) y = -99;
    drawVial(p, cx, Math.round(y), face, cut);
    // socle : bloc avec une fente, la fiole y est enfoncée
    for (let yy = cut; yy < 92; yy++) for (let x = 12; x < 58; x++) p.set(x, yy, x < 15 ? COL.paper : x > 54 ? COL.socleLo : COL.socle);
    for (let x = 21; x < 49; x++) p.set(x, cut, COL.socleLo);
    p.outline(); p.shadow(35, 93.4, 25, 2);
    p.blit(this.ctx, this.img);
  }
}

/* Flèches qui tournent autour d'un axe vertical : une ellipse dont la moitié avant passe devant la fiole. */
class Spin{
  constructor(el){
    this.el = el; this.t = 0;
    const c = this.canvas = document.createElement('canvas'); c.width = 60; c.height = 20; el.appendChild(c);
    this.ctx = c.getContext('2d'); this.img = this.ctx.createImageData(60, 20); this.p = new Pix(60, 20);
  }
  step(dt){ this.t += dt; }
  render(){
    const p = this.p, cx = 30, cy = 10, rx = 25, ry = 6; p.clear();
    const a0 = calmMotion ? 0 : this.t * 2.2;
    for (const k of [0, Math.PI]){ // deux flèches qui se suivent sur l'ellipse
      for (let s = 0; s < 1.9; s += .02){
        const a = a0 + k - s, x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a), front = Math.sin(a) > 0;
        p.set(x, y, front ? COL.paper : COL.glassLo); p.set(x, y + 1, front ? COL.paper : COL.glassLo);
      }
      const a = a0 + k, x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a), dir = -Math.sin(a) >= 0 ? 1 : -1; // pointe de flèche
      for (let j = 0; j < 4; j++) for (let i = -j; i <= j; i++) p.set(x + dir * (3 - j), y + i, COL.paper);
    }
    p.outline();
    p.blit(this.ctx, this.img);
  }
}

// une seule boucle pour toutes les animations, à 30 images par seconde
const all = [];
let last = 0;
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
  if (document.hidden) return;
  all.forEach(m => {
    if (!m.el.getClientRects().length) return;
    m.acc = (m.acc || 0) + dt;
    if (m.acc < 1 / 30) return;
    m.step(Math.min(.1, m.acc)); m.acc = 0; m.render();
  });
}
requestAnimationFrame(frame);
const make = K => el => { const m = new K(el); all.push(m); m.render(); return m; };
window.VialMascot = { create: make(Mascot), swap: make(Swap), spin: make(Spin) };
})();
