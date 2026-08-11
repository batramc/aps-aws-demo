/* ============================================================
   APS on AWS — AU 2026 demo
   Client-side only. No build step, no credentials.
   ============================================================ */

/* ---------- 1. 3D VIEWER (Three.js gear assembly) ---------- */
let scene, camera, renderer, controls, gearBig, gearSmall, wire = false, autoRotate = true;

function createGearGeometry(teeth, mod, thickness, holeR) {
  const pitchR = mod * teeth / 2;
  const outerR = pitchR + mod;
  const rootR = pitchR - 1.25 * mod;
  const shape = new THREE.Shape();
  const ta = (Math.PI * 2) / teeth;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const b = i * ta;
    pts.push([b, rootR]);
    pts.push([b + ta * 0.30, rootR]);
    pts.push([b + ta * 0.38, outerR]);
    pts.push([b + ta * 0.62, outerR]);
    pts.push([b + ta * 0.70, rootR]);
  }
  pts.forEach(([ang, r], i) => {
    const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  });
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: 0.5,
    bevelSize: 0.5, bevelSegments: 2, steps: 1, curveSegments: 32
  });
  geo.center();
  return { geo, pitchR };
}

function initViewer() {
  const el = document.getElementById('viewer');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 2000);
  camera.position.set(0, 30, 95);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);

  // lights
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2233, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(40, 60, 50); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9900, 0.6); rim.position.set(-50, 10, -40); scene.add(rim);
  const fill = new THREE.PointLight(0x4aa3ff, 0.5, 400); fill.position.set(0, -40, 40); scene.add(fill);

  const steel = new THREE.MeshStandardMaterial({ color: 0x9fb3c8, metalness: 0.95, roughness: 0.32 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.38 });

  const big = createGearGeometry(28, 2.0, 8, 6);
  gearBig = new THREE.Mesh(big.geo, steel);
  scene.add(gearBig);

  const small = createGearGeometry(14, 2.0, 8, 5);
  gearSmall = new THREE.Mesh(small.geo, brass);
  gearSmall.position.x = big.pitchR + small.pitchR;   // mesh them
  gearSmall.userData.ratio = 28 / 14;
  gearSmall.rotation.z = Math.PI / 14;                // phase teeth to interlock
  scene.add(gearSmall);

  // hubs
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x5a6b80, metalness: 0.9, roughness: 0.5 });
  const hub1 = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 10, 32), hubMat);
  hub1.rotation.x = Math.PI / 2; gearBig.add(hub1);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = false; controls.minDistance = 45; controls.maxDistance = 220;
  controls.target.set(big.pitchR / 2, 0, 0);

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  const el = document.getElementById('viewer');
  if (!el.clientWidth) return;
  camera.aspect = el.clientWidth / el.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(el.clientWidth, el.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (autoRotate && gearBig) {
    gearBig.rotation.z += 0.006;
    gearSmall.rotation.z -= 0.006 * gearSmall.userData.ratio;
  }
  controls.update();
  renderer.render(scene, camera);
}

/* ---------- 2. VIEWER CONTROLS ---------- */
document.getElementById('btn-rotate').onclick = e => {
  autoRotate = !autoRotate; e.target.classList.toggle('active', autoRotate);
};
document.getElementById('btn-wire').onclick = e => {
  wire = !wire; e.target.classList.toggle('active', wire);
  [gearBig, gearSmall].forEach(g => g.material.wireframe = wire);
};
document.getElementById('btn-replay').onclick = () => runPipeline();

/* ---------- 3. PIPELINE ANIMATION ---------- */
let pipeTimer = null;
function runPipeline() {
  const steps = [...document.querySelectorAll('#pipeline li')];
  steps.forEach(s => s.classList.remove('done', 'active'));
  clearInterval(pipeTimer);
  let i = 0;
  const tick = () => {
    if (i > 0) steps[i - 1].classList.replace('active', 'done');
    if (i < steps.length) { steps[i].classList.add('active'); i++; }
    else clearInterval(pipeTimer);
  };
  tick();
  pipeTimer = setInterval(tick, 900);
}

/* ---------- 4. KIRO TERMINAL (typewriter) ---------- */
const kiroScript = [
  ['t-cmd', '$ kiro deploy --from-natural-language\n'],
  ['t-nl', '  "Deploy this APS viewer app to ECS Fargate behind an ALB,\n'],
  ['t-nl', '   store uploaded models in S3 with pre-signed URLs,\n'],
  ['t-nl', '   and add Cognito sign-in. Front it with CloudFront."\n\n'],
  ['t-dim', '⋯ Synthesizing infrastructure as code (AWS CDK)\n'],
  ['t-ok', '✔ VPC + Application Load Balancer\n'],
  ['t-ok', '✔ ECS Fargate service (2 tasks, auto-scaling)\n'],
  ['t-ok', '✔ S3 bucket "adsk-models" + pre-signed URL policy\n'],
  ['t-ok', '✔ Cognito user pool + hosted sign-in UI\n'],
  ['t-ok', '✔ CloudFront distribution (global, TLS 1.2+)\n'],
  ['t-dim', '⋯ Deploying stack …\n'],
  ['t-ok', '✔ Deployed in 4m 12s\n'],
  ['t-url', '→ https://d3xampl3.cloudfront.net\n']
];
let kiroRan = false;
function runKiroTerminal() {
  if (kiroRan) return; kiroRan = true;
  const out = document.getElementById('kiro-out'); out.innerHTML = '';
  let li = 0, ci = 0;
  const type = () => {
    if (li >= kiroScript.length) return;
    const [cls, text] = kiroScript[li];
    if (ci === 0) { const s = document.createElement('span'); s.className = cls; s.id = 'ln' + li; out.appendChild(s); }
    document.getElementById('ln' + li).textContent += text[ci];
    ci++;
    if (ci >= text.length) { li++; ci = 0; setTimeout(type, 90); }
    else setTimeout(type, text[ci - 1] === '\n' ? 40 : 12);
  };
  type();
}

/* ---------- 5. QUICKSIGHT-STYLE CHARTS ---------- */
let chartsBuilt = false;
function buildCharts() {
  if (chartsBuilt || typeof Chart === 'undefined') return; chartsBuilt = true;
  Chart.defaults.color = '#9fb0c3';
  Chart.defaults.font.family = "'Segoe UI',sans-serif";
  const grid = { color: 'rgba(255,255,255,.06)' };

  new Chart(document.getElementById('c-bar'), {
    type: 'bar',
    data: {
      labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
      datasets: [{ data: [1620, 1810, 1740, 2050, 2210, 2380], backgroundColor: '#ff9900', borderRadius: 5 }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { grid }, x: { grid: { display: false } } } }
  });

  new Chart(document.getElementById('c-doughnut'), {
    type: 'doughnut',
    data: {
      labels: ['us-east-1', 'eu-west-1', 'ap-southeast-2', 'us-west-2'],
      datasets: [{ data: [42, 28, 18, 12], backgroundColor: ['#ff9900', '#4aa3ff', '#3fb950', '#b46bff'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } }, cutout: '58%' }
  });

  new Chart(document.getElementById('c-line'), {
    type: 'line',
    data: {
      labels: ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
      datasets: [{ data: [1210, 1340, 1490, 1560, 1720, 1860], borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.15)', fill: true, tension: .35, pointRadius: 3 }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { grid }, x: { grid: { display: false } } } }
  });

  new Chart(document.getElementById('c-carbon'), {
    type: 'bar',
    data: {
      labels: ['Steel', 'Aluminum', 'Concrete', 'Polymer', 'Glass'],
      datasets: [{ data: [18.4, 9.1, 7.8, 4.2, 2.8], backgroundColor: '#3fb950', borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', plugins: { legend: { display: false } },
      scales: { x: { grid, ticks: { font: { size: 9 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }
    }
  });
}

/* ---------- 6. PERSONA SWITCHING ---------- */
document.querySelectorAll('.persona-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.persona-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.persona;
    document.querySelectorAll('.persona-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.panel !== p);
    });
    if (p === 'story') runPipeline();
    if (p === 'developer') { kiroRan = false; runKiroTerminal(); }
    if (p === 'analyst') buildCharts();
    setTimeout(onResize, 60);
  };
});

/* ---------- 7. BOOT ---------- */
window.addEventListener('load', () => {
  initViewer();
  setTimeout(runPipeline, 600);
});
