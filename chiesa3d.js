// Vista 3D della chiesa: sala, palco e ledwall con la forma vera presa dalla configurazione.
// Caricata solo quando si apre la vista (three.js da CDN).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let stato = null;

export function apri(evId) {
  chiudi();
  const ev = DB.events.find(x => x.id === evId); if (!ev) return;
  const A = pmAllInfo(ev); if (!A.L.length) { toast('Nessuno schermo da mostrare'); return; }

  const box = document.createElement('div');
  box.id = 'v3d';
  box.innerHTML = `<div class="v3dbar"><b>🧊 Ledwall chiesa in 3D</b><span class="sp"></span>
    <button class="btn sec sm" data-v3dvista="sala">Dal fondo</button><button class="btn sec sm" data-v3dvista="palco">Dal palco</button><button class="btn sec sm" data-v3dvista="alto">Dall'alto</button>
    <label class="btn sec sm" style="margin:0">🖼 Prova un'immagine<input type="file" accept="image/*" hidden id="v3dimg"></label>
    <button class="btn sec sm" data-v3dpm="1">🎯 Pixelmap</button><button class="btn sm" data-v3dclose="1">✕ Chiudi</button></div>
    <div class="v3dhint mut">Trascina per girare, rotella o due dita per lo zoom. Il modello è una ricostruzione approssimativa dai video.</div>`;
  document.body.appendChild(box);
  document.documentElement.classList.add('v3dopen');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  box.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15120f');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 2; controls.maxDistance = 60;

  // ---- misure (metri) ----
  const it0 = A.L[0].c.it, modW = (+it0.modW || 500) / 1000, modH = (+it0.modH || 1000) / 1000;
  const scale = modW / it0.pxW;                         // metri per pixel
  const gapM = A.gap * scale;                           // la band è leggermente staccata
  const wallW = A.L.reduce((a, o) => a + o.c.pxW * scale, 0) + gapM * (A.L.length - 1);
  const ledTop = 4.7, stageH = 0.4;
  const roomW = Math.max(30, wallW + 6), roomD = 26, roomH = 6.2;

  // ---- luci ----
  scene.add(new THREE.HemisphereLight('#fff6e8', '#3a2f25', 0.55));
  const dir = new THREE.DirectionalLight('#fff3e0', 0.5); dir.position.set(5, 12, 10); scene.add(dir);

  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const add = (geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); scene.add(me); return me; };

  // ---- sala ----
  add(new THREE.BoxGeometry(roomW, 0.1, roomD), mat('#cdbfa5'), 0, -0.05, roomD / 2 - 1);                // pavimento in marmo chiaro
  add(new THREE.BoxGeometry(roomW, 0.1, roomD), mat('#e9e4dc'), 0, roomH, roomD / 2 - 1);                // soffitto
  add(new THREE.BoxGeometry(roomW, roomH, 0.2), mat('#4a3a2e'), 0, roomH / 2, -0.6);                      // parete del palco in legno scuro
  add(new THREE.BoxGeometry(0.2, roomH, roomD), mat('#d8d0c4'), -roomW / 2, roomH / 2, roomD / 2 - 1);    // pareti laterali
  add(new THREE.BoxGeometry(0.2, roomH, roomD), mat('#d8d0c4'), roomW / 2, roomH / 2, roomD / 2 - 1);
  // fascia scura del controsoffitto sopra il ledwall
  add(new THREE.BoxGeometry(roomW, 0.6, 1.4), mat('#5b4a3d'), 0, roomH - 0.3, 0.2);
  // listelli verticali in legno sotto il ledwall
  const listMat = mat('#3d3027');
  for (let x = -roomW / 2 + 0.3; x < roomW / 2; x += 0.35) add(new THREE.BoxGeometry(0.06, 1.6, 0.06), listMat, x, 0.8, -0.5);

  // faretti a incasso
  const ledMat = new THREE.MeshBasicMaterial({ color: '#fffdf5' });
  for (let x = -roomW / 2 + 3; x < roomW / 2 - 1; x += 4) for (let z = 3; z < roomD - 2; z += 4) {
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), ledMat, x, roomH - 0.06, z);
  }
  for (let k = -1; k <= 1; k++) { const l = new THREE.PointLight('#fff1dc', 18, 18, 1.6); l.position.set(k * 9, roomH - 0.4, 6); scene.add(l); }

  // casse appese
  const nero = mat('#141414');
  [[-wallW * 0.32, 1.6], [wallW * 0.18, 1.6], [-wallW * 0.05, 7], [wallW * 0.35, 7]].forEach(([x, z]) => add(new THREE.BoxGeometry(0.7, 0.9, 0.6), nero, x, roomH - 1.05, z));

  // ---- palco ----
  const stageW = Math.min(16, wallW * 0.6), stageD = 4.2;
  add(new THREE.BoxGeometry(stageW, stageH, stageD), mat('#e7dcc6'), -wallW * 0.05, stageH / 2, stageD / 2 - 0.3);
  add(new THREE.BoxGeometry(5, stageH * 0.5, 1.2), mat('#e2d6be'), -wallW * 0.05, stageH * 0.25, stageD - 0.3 + 0.6); // gradino
  // pulpito bianco svasato
  const pul = add(new THREE.CylinderGeometry(0.55, 0.12, 1.15, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.4, side: THREE.DoubleSide }), -wallW * 0.05, stageH + 0.58, stageD - 1.1);
  add(new THREE.CylinderGeometry(0.25, 0.3, 0.06, 24), mat('#f1f1f1'), pul.position.x, stageH + 0.03, pul.position.z);
  // pianoforte a coda
  const piano = new THREE.Group();
  const pianoNero = new THREE.MeshStandardMaterial({ color: '#0c0c0c', roughness: 0.25, metalness: 0.2 });
  const corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 24, 1, false, 0, Math.PI), pianoNero); corpo.scale.set(0.8, 1, 1.5); corpo.position.y = 0.85; piano.add(corpo);
  const tast = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.3, 0.45), pianoNero); tast.position.set(0, 0.85, 0.2); piano.add(tast);
  [[-0.6, 0.1], [0.6, 0.1], [0, -1.2]].forEach(([x, z]) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7), pianoNero); g.position.set(x, 0.35, z); piano.add(g); });
  piano.position.set(-wallW * 0.05 + 3.3, stageH, 1.8); piano.rotation.y = Math.PI; scene.add(piano);
  // leggii e asta microfono
  [[-2.2, 2.5], [-1.4, 2.8], [4.8, 2.6]].forEach(([dx, z]) => { add(new THREE.CylinderGeometry(0.02, 0.02, 1.2), nero, -wallW * 0.05 + dx, stageH + 0.6, z); add(new THREE.BoxGeometry(0.5, 0.35, 0.02), nero, -wallW * 0.05 + dx, stageH + 1.2, z); });

  // ---- sedie (due blocchi con corridoio centrale) ----
  const sedia = new THREE.Group();
  const stoffa = mat('#e8e1d4'), legno = mat('#7a4b2c');
  const sed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.48), stoffa); sed.position.y = 0.45; sedia.add(sed);
  const sch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), stoffa); sch.position.set(0, 0.8, 0.22); sedia.add(sch);
  [-0.27, 0.27].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.45), legno); b.position.set(x, 0.65, 0); sedia.add(b); });
  const piede = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.42), nero); piede.position.y = 0.21; sedia.add(piede);
  const meshes = [];
  sedia.traverse(o => { if (o.isMesh) meshes.push(o); });
  const posti = [];
  for (let r = 0; r < 12; r++) {
    const z = stageD + 2.6 + r * 1.0;
    const half = Math.min(roomW / 2 - 1.5, 7 + r * 0.25);
    for (let x = 1.0; x <= half; x += 0.56) { posti.push([x, z]); posti.push([-x, z]); }
  }
  meshes.forEach(m => {
    const inst = new THREE.InstancedMesh(m.geometry, m.material, posti.length);
    const d = new THREE.Object3D();
    posti.forEach(([x, z], i) => { d.position.set(x + m.position.x, m.position.y, z + m.position.z); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); });
    scene.add(inst);
  });
  // parapetto in vetro della zona centrale
  add(new THREE.BoxGeometry(roomW * 0.5, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: '#a8d8cf', transparent: true, opacity: 0.25 }), 0, 0.45, stageD + 1.6);

  // ---- ledwall: un pannello per ogni modulo acceso ----
  const schermi = [];
  let x0 = -wallW / 2;
  A.L.forEach(o => {
    const c = o.c, wM = c.pxW * scale, hM = c.pxH * scale;
    const cv = document.createElement('canvas');
    const k = Math.min(1, 3072 / c.pxW); cv.width = Math.max(64, Math.round(c.pxW * k)); cv.height = Math.max(32, Math.round(c.pxH * k));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const ledMatS = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const cab = mat('#0a0a0a');
    const mw = c.it.pxW * scale, mh = c.it.pxH * scale;
    for (let r = 0; r < c.rows; r++) for (let q = 0; q < c.cols; q++) {
      if (c.off.has(q + ',' + r)) continue;
      const g = new THREE.PlaneGeometry(mw * 0.995, mh * 0.995);
      const uv = g.attributes.uv;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, (q + uv.getX(v)) / c.cols, 1 - (r + 1 - uv.getY(v)) / c.rows);
      const cx = x0 + (q + 0.5) * mw, cy = ledTop - (r + 0.5) * mh;
      add(g, ledMatS, cx, cy, -0.42);
      add(new THREE.BoxGeometry(mw, mh, 0.08), cab, cx, cy, -0.47);
    }
    schermi.push({ o, cv, tex, xPx: schermi.reduce((a, s) => a + s.o.c.pxW, 0) });
    x0 += wM + gapM;
  });
  const luceLed = new THREE.PointLight('#9fb8ff', 6, 14, 1.4); luceLed.position.set(0, 3, 2); scene.add(luceLed);

  // ---- contenuto: pixelmap animata o immagine di prova ----
  let img = null;
  const disegna = t => {
    schermi.forEach(s => {
      const g = s.cv.getContext('2d');
      if (img) {
        const W = A.W, H = A.H, kx = s.cv.width / s.o.c.pxW;
        g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, s.cv.width, s.cv.height);
        // l'immagine copre tutto il canvas 9984×1152, ogni schermo prende la sua parte
        const sc = Math.max(W / img.width, H / img.height), iw = img.width * sc, ih = img.height * sc, ox = (W - iw) / 2, oy = (H - ih) / 2;
        g.drawImage(img, (ox - s.xPx) * kx, oy * kx, iw * kx, ih * kx);
      } else pmDraw(g, s.o.c, t, s.o.s);
      s.tex.needsUpdate = true;
    });
  };

  const viste = {
    sala: [[0, 1.7, roomD - 3], [0, 3, 0]],
    palco: [[-wallW * 0.05, 2.2, 8], [-wallW * 0.05, 3.2, 0]],
    alto: [[wallW * 0.4, roomH - 0.5, 15], [0, 2, 3]],
  };
  const vai = n => { const [p, tg] = viste[n]; camera.position.set(...p); controls.target.set(...tg); controls.update(); };
  vai('sala');

  const size = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  size(); addEventListener('resize', size);

  let ultimo = 0, vivo = true;
  const loop = now => {
    if (!vivo) return;
    if (now - ultimo > 66) { disegna((now / 1000) % PM_LOOP); ultimo = now; }   // ~15 fps per la texture basta
    controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v3dclose) chiudi();
    else if (b.dataset.v3dvista) vai(b.dataset.v3dvista);
    else if (b.dataset.v3dpm) img = null;
  });
  box.querySelector('#v3dimg').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const im = new Image(); im.onload = () => { img = im; }; im.src = URL.createObjectURL(f);
  });
  const esc = e => { if (e.key === 'Escape') chiudi(); };
  addEventListener('keydown', esc);

  stato = { stop: () => { vivo = false; removeEventListener('resize', size); removeEventListener('keydown', esc); renderer.dispose(); box.remove(); document.documentElement.classList.remove('v3dopen'); } };
}

export function chiudi() { if (stato) { stato.stop(); stato = null; } }
