// Petit serveur local pour l'app de scan.
//   node serve.js            -> http://localhost:8080 (PC) et https://<IP du PC>:8443 (téléphone, même Wi-Fi)
// La caméra d'un navigateur exige https : le certificat est auto-signé, le téléphone affichera
// un avertissement à accepter une fois ("Paramètres avancés" > "Continuer").
// TEST_VIDEO=chemin/video.mp4 sert en plus cette vidéo sur /test.mp4.
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");

const root = __dirname;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".mp4": "video/mp4", ".json": "application/json" };

function handler(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = p === "/test.mp4" && process.env.TEST_VIDEO ? process.env.TEST_VIDEO : path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root) && file !== process.env.TEST_VIDEO) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end("introuvable"); return; }
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) { // les vidéos ont besoin des requêtes partielles pour se repositionner
      const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    }
  });
}

const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254")).map(i => i.address);
const key = path.join(root, "cert", "key.pem"), crt = path.join(root, "cert", "cert.pem");
if (!fs.existsSync(crt)) {
  fs.mkdirSync(path.join(root, "cert"), { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map(ip => "IP:" + ip)].join(",");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825", "-keyout", key, "-out", crt,
    "-subj", "/CN=scan-fiole", "-addext", "subjectAltName=" + san], { stdio: "ignore" });
}

http.createServer(handler).listen(8080, () => console.log("PC        : http://localhost:8080"));
https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler)
  .listen(8443, () => ips.forEach(ip => console.log(`Téléphone : https://${ip}:8443`)));
