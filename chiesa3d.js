// Vista 3D della chiesa: modello vero della sala (SketchUp → chiesa3d.glb) e ledwall con la forma presa dalla configurazione.
// Caricata solo quando si apre la vista (three.js da CDN).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let stato = null;

export function apri(evId) {
  chiudi();
  const ev = DB.events.find(x => x.id === evId); if (!ev) return;
  const A = pmAllInfo(ev); if (!A.L.length) { toast('Nessuno schermo da mostrare'); return; }

  const box = document.createElement('div');
  box.id = 'v3d';
  box.innerHTML = `<div class="v3dbar"><b>🧊 Ledwall chiesa in 3D</b><span class="sp"></span>
    <button class="btn sec sm" data-v3dvista="sala">Dal fondo</button><button class="btn sec sm" data-v3dvista="palco">Da metà sala</button><button class="btn sec sm" data-v3dvista="alto">Di lato</button>
    <label class="btn sec sm" style="margin:0">🖼 Prova un'immagine<input type="file" accept="image/*" hidden id="v3dimg"></label>
    <button class="btn sec sm" data-v3dpm="1">🎯 Pixelmap</button><button class="btn sm" data-v3dclose="1">✕ Chiudi</button></div>
    <div class="v3dhint mut">Trascina per girare, rotella o due dita per lo zoom. Modello vero della sala (progetto SketchUp), ledwall con la forma della configurazione.</div>`;
  document.body.appendChild(box);
  document.documentElement.classList.add('v3dopen');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  box.appendChild(renderer.domElement);
  const caric = document.createElement('div'); caric.className = 'v3dload'; caric.textContent = 'Carico il modello della chiesa…';
  caric.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;pointer-events:none';
  box.appendChild(caric);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15120f');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 0.5; controls.maxDistance = 45;

  // ---- luci ----
  scene.add(new THREE.HemisphereLight('#fffaf0', '#6b5a48', 1.5));
  const dir = new THREE.DirectionalLight('#fff3e0', 0.6); dir.position.set(30, 20, 5); scene.add(dir);

  // ---- modello vero della sala (SketchUp dell'architetto, alleggerito) ----
  // Coordinate del modello in metri: ledwall sulla parete z = -27.7, da x 14.15 a 37.15, bordo alto a 4.5 m.
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load('./chiesa3d.glb?v=1', g => {
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const ms = [].concat(o.material);
      if (ms.some(m => m.name === 'Sfondo ledwall')) { o.visible = false; return; }   // al suo posto mettiamo i moduli veri
      ms.forEach(m => { m.metalness = 0; m.roughness = Math.max(0.6, m.roughness ?? 1); if (!o.geometry.attributes.normal) m.flatShading = true; });
    });
    scene.add(g.scene); caric.remove();
  }, ev => { if (ev.total) caric.textContent = `Carico il modello della chiesa… ${Math.round(ev.loaded / ev.total * 100)}%`; },
  err => { console.error(err); caric.textContent = 'Non riesco a caricare il modello della chiesa'; });

  // ---- ledwall: un pannello per ogni modulo acceso, messo dove sta nel modello ----
  const it0 = A.L[0].c.it, modW = (+it0.modW || 500) / 1000;
  const scale = modW / it0.pxW;                         // metri per pixel
  const MAIN = { o: new THREE.Vector3(14.15, 4.5, -27.68), dx: new THREE.Vector3(1, 0, 0) };
  // la BAND è sulla parete di sinistra, girata verso la sala: dal punto più vicino al pubblico fino all'angolo del ledwall
  const bandA = new THREE.Vector3(13.31, 4.5, -24.34), bandB = new THREE.Vector3(14.10, 4.5, -27.23);
  const bandDx = bandB.clone().sub(bandA).normalize(), bandN = new THREE.Vector3(0, 1, 0).cross(bandDx).negate();
  const larg = Math.max(...A.L.map(o => o.c.pxW));
  const altri = A.L.filter(o => o.c.pxW !== larg);
  const posto = o => {
    if (o.c.pxW === larg) return MAIN;
    // gli altri schermi stanno sulla parete della band, uno dopo l'altro, finendo all'angolo del ledwall
    const dopo = altri.slice(altri.indexOf(o) + 1).reduce((a, x) => a + x.c.pxW * scale, 0);
    const start = bandB.clone().addScaledVector(bandDx, -(o.c.pxW * scale + dopo)).addScaledVector(bandN, 0.02);
    return { o: start, dx: bandDx };
  };
  const schermi = [];
  const cab = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.9 });
  A.L.forEach(o => {
    const c = o.c, P = posto(o);
    const nrm = new THREE.Vector3(0, 1, 0).cross(P.dx).negate();      // verso la sala
    const cv = document.createElement('canvas');
    const k = Math.min(1, 3072 / c.pxW); cv.width = Math.max(64, Math.round(c.pxW * k)); cv.height = Math.max(32, Math.round(c.pxH * k));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const ledMatS = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const mw = c.it.pxW * scale, mh = c.it.pxH * scale;
    const grp = new THREE.Group(); grp.position.copy(P.o);
    grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(P.dx, new THREE.Vector3(0, 1, 0), nrm));
    for (let r = 0; r < c.rows; r++) for (let q = 0; q < c.cols; q++) {
      if (c.off.has(q + ',' + r)) continue;
      const g = new THREE.PlaneGeometry(mw * 0.995, mh * 0.995);
      const uv = g.attributes.uv;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, (q + uv.getX(v)) / c.cols, 1 - (r + 1 - uv.getY(v)) / c.rows);
      const pan = new THREE.Mesh(g, ledMatS); pan.position.set((q + 0.5) * mw, -(r + 0.5) * mh, 0.01); grp.add(pan);
      const box3 = new THREE.Mesh(new THREE.BoxGeometry(mw, mh, 0.06), cab); box3.position.set((q + 0.5) * mw, -(r + 0.5) * mh, -0.03); grp.add(box3);
    }
    scene.add(grp);
    schermi.push({ o, cv, tex, xPx: schermi.reduce((a, s) => a + s.o.c.pxW, 0) });
  });
  const luceLed = new THREE.PointLight('#9fb8ff', 8, 16, 1.4); luceLed.position.set(25.6, 3, -24); scene.add(luceLed);

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
    sala: [[25.6, 1.7, -4], [25.6, 3, -27.7]],
    palco: [[22, 1.6, -14], [25, 3, -27.7]],
    alto: [[31, 2.4, -19], [18, 3, -27.5]],
  };
  const vai = n => { const [p, tg] = viste[n]; camera.position.set(...p); controls.target.set(...tg); controls.update(); };
  vai('sala');

  const size = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 75 : 55; camera.updateProjectionMatrix(); };
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
