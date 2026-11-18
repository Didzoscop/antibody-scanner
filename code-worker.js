/* Lecture des codes 2D (zxing-wasm) dans un fil à part : pendant le scan, le suivi de la rotation ne doit jamais
   attendre. Lire le code sur le fil principal (v0.16) ralentissait le traitement des images sur téléphone, et le suivi
   décrochait (panorama haché, morceaux répétés). Reçoit { bitmap } (ImageBitmap transféré), répond
   { codes: [{ text, format }] } (liste vide si rien). */
let ready = null;
function load(){
  return ready || (ready = new Promise((ok, ko) => {
    try { importScripts('https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.7/dist/iife/reader/index.js'); ok(); } catch (e){ ready = null; ko(e); }
  }));
}
let canvas = null;
self.onmessage = async e => {
  const { bitmap } = e.data;
  try {
    await load();
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const x = canvas.getContext('2d', { willReadFrequently: true });
    x.drawImage(bitmap, 0, 0); bitmap.close();
    const im = x.getImageData(0, 0, canvas.width, canvas.height);
    // tous les formats, 1D et 2D (DataMatrix, QR, GS1-128, GS1 DataBar, EAN/UPC, Code 39…), plusieurs par image
    const r = await self.ZXingWASM.readBarcodes(im, { tryHarder: true, maxNumberOfSymbols: 4, textMode: 'HRI' });
    self.postMessage({ codes: r.filter(o => o.text && o.isValid !== false).map(o => ({ text: o.text, format: o.format })) });
  } catch (err){ try { bitmap.close(); } catch (_){} self.postMessage({ codes: [], error: String(err) }); }
};
