/* ============================================================
   APS Digital Twin on AWS — IoT sensor overlay (AU 2026)
   Credential-free stand-in that mirrors the APS DataViz (IoT)
   Extension: sensor sprites, heatmap, 24h charts, time slider.
   Swap generateSeries() for an AWS IoT/Timestream data adapter to go live.
   ============================================================ */

// ---------- 1. DATA MODEL (simulated telemetry) ----------
const STEPS = 288;                       // 24h @ 5-min resolution
const ZONES = [
  { id:'assembly',  name:'Assembly Line', base:26, col:0, row:0 },
  { id:'welding',   name:'Welding Bay',   base:55, col:1, row:0, anomaly:true },
  { id:'paint',     name:'Paint Booth',   base:58, col:2, row:0 },
  { id:'packaging', name:'Packaging',     base:23, col:0, row:1 },
  { id:'qc',        name:'QC Lab',        base:21, col:1, row:1 },
  { id:'utilities', name:'Utilities',     base:34, col:2, row:1 },
];
const WARN = 60, ALARM = 80;

function rnd(seed){ let s=seed%2147483647; if(s<=0)s+=2147483646; return ()=>(s=s*16807%2147483647)/2147483647; }
function generateSeries(zone, i){
  const r = rnd(1000 + i*7);
  const temp=[], hum=[], vib=[];
  for(let t=0;t<STEPS;t++){
    const daily = 6*Math.sin((t/STEPS)*Math.PI*2 - Math.PI/2);   // cool at night, warm midday
    let noise = (r()-0.5)*2.5;
    let anomaly = 0;
    if(zone.anomaly){ const d=t-190; anomaly = 34*Math.exp(-(d*d)/(2*14*14)); } // ~15:50 spike
    const tv = zone.base + daily + noise + anomaly;
    temp.push(+tv.toFixed(1));
    hum.push(+Math.max(18, Math.min(85, 52 - (tv-zone.base)*0.7 + (r()-0.5)*4)).toFixed(0));
    vib.push(+Math.max(0.2, 1.4 + (tv-zone.base)*0.05 + (r()-0.5)*0.6).toFixed(2));
  }
  return { temp, hum, vib };
}
ZONES.forEach((z,i)=> z.series = generateSeries(z,i));

const statusOf = t => t>=ALARM ? 'alarm' : t>=WARN ? 'warn' : 'ok';
const STATUS_COLOR = { ok:'#3fb950', warn:'#e3a008', alarm:'#f0503a' };
const STATUS_LABEL = { ok:'Normal', warn:'Warning', alarm:'ALARM' };

// heatmap: temp -> color (blue -> green -> amber -> red)
function tempColor(t){
  const stops=[[18,[59,111,224]],[40,[63,185,80]],[62,[227,160,8]],[85,[240,80,58]]];
  let a=stops[0], b=stops[stops.length-1];
  for(let i=0;i<stops.length-1;i++){ if(t>=stops[i][0] && t<=stops[i+1][0]){ a=stops[i]; b=stops[i+1]; break; } }
  if(t<stops[0][0]) return stops[0][1];
  if(t>stops[stops.length-1][0]) return stops[stops.length-1][1];
  const f=(t-a[0])/(b[0]-a[0]||1);
  return a[1].map((c,k)=> Math.round(c + (b[1][k]-c)*f));
}
const cssRGB = a => `rgb(${a[0]},${a[1]},${a[2]})`;

// ---------- 2. STATE ----------
let currentT = 180, playing=false, playTimer=null, selected='welding';
let heatmapOn=true, spritesOn=true;
const timeLabel = t => { const m=t*5, h=Math.floor(m/60), mm=m%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; };

// ---------- 3. THREE.JS SCENE ----------
let scene,camera,renderer,controls,raycaster,mouse,zoneMeshes=[],sensorMeshes={},tags={};
const el = document.getElementById('twin');
const tagLayer = document.getElementById('sensor-tags');

function init(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, el.clientWidth/el.clientHeight, 0.1, 2000);
  camera.position.set(0,60,68);
  renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xbcd4ff,0x0a0f18,0.95));
  const key=new THREE.DirectionalLight(0xffffff,0.9); key.position.set(40,70,40); scene.add(key);

  // floor
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,58),
    new THREE.MeshStandardMaterial({color:0x0f1622,roughness:1,metalness:0}));
  floor.rotation.x=-Math.PI/2; floor.position.y=-0.05; scene.add(floor);
  const grid=new THREE.GridHelper(80,20,0x2a3646,0x1a2330); scene.add(grid);

  // zones
  const W=16, D=16, GX=19, GZ=20;
  ZONES.forEach(z=>{
    const x=(z.col-1)*GX, zz=(z.row-0.5)*GZ;
    const geo=new THREE.BoxGeometry(W,6,D);
    const mat=new THREE.MeshStandardMaterial({color:0x33414f,transparent:true,opacity:0.55,roughness:0.8});
    const m=new THREE.Mesh(geo,mat); m.position.set(x,3,zz);
    m.userData.zoneId=z.id; scene.add(m); zoneMeshes.push(m);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({color:0x4a5a6e})); edges.position.copy(m.position); scene.add(edges);
    // machine flavor
    const mach=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,3,20),
      new THREE.MeshStandardMaterial({color:0x8794a3,metalness:0.7,roughness:0.5}));
    mach.position.set(x,1.5,zz); scene.add(mach);
    // sensor marker
    const s=new THREE.Mesh(new THREE.SphereGeometry(0.9,20,20),
      new THREE.MeshStandardMaterial({color:0x3fb950,emissive:0x3fb950,emissiveIntensity:0.8}));
    s.position.set(x,8.4,zz); scene.add(s); sensorMeshes[z.id]=s;
    z._pos=new THREE.Vector3(x,8.4,zz);
    // HTML tag
    const tag=document.createElement('div'); tag.className='tag'; tag.dataset.zone=z.id;
    tag.innerHTML=`<span class="dot"></span><b>${z.name}</b><small>—</small>`;
    tag.style.pointerEvents='auto'; tag.style.cursor='pointer';
    tag.onclick=()=>select(z.id);
    tagLayer.appendChild(tag); tags[z.id]=tag;
  });

  controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.08;
  controls.maxPolarAngle=Math.PI*0.48; controls.minDistance=40; controls.maxDistance=160;
  controls.target.set(0,2,0);

  raycaster=new THREE.Raycaster(); mouse=new THREE.Vector2();
  renderer.domElement.addEventListener('click',onClick);
  window.addEventListener('resize',onResize);
  animate();
}

function onClick(e){
  const r=renderer.domElement.getBoundingClientRect();
  mouse.x=((e.clientX-r.left)/r.width)*2-1; mouse.y=-((e.clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  const hit=raycaster.intersectObjects(zoneMeshes)[0];
  if(hit) select(hit.object.userData.zoneId);
}
function onResize(){ if(!el.clientWidth)return; camera.aspect=el.clientWidth/el.clientHeight;
  camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth,el.clientHeight); }

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  // project sensor tags to screen
  ZONES.forEach(z=>{
    const v=z._pos.clone().project(camera);
    const tag=tags[z.id];
    if(v.z<1){ tag.style.display='';
      tag.style.left=((v.x*0.5+0.5)*el.clientWidth)+'px';
      tag.style.top =((-v.y*0.5+0.5)*el.clientHeight)+'px';
    } else tag.style.display='none';
    tag.style.opacity=spritesOn?'1':'0';
    sensorMeshes[z.id].visible=spritesOn;
  });
  renderer.render(scene,camera);
}

// ---------- 4. CHART ----------
let chart;
function initChart(){
  Chart.defaults.color='#9fb0c3'; Chart.defaults.font.family="'Segoe UI',sans-serif";
  chart=new Chart(document.getElementById('chart'),{
    type:'line',
    data:{ labels:Array.from({length:STEPS},(_,t)=>timeLabel(t)),
      datasets:[{ data:[], borderColor:'#ff9900', backgroundColor:'rgba(255,153,0,.12)',
        fill:true, tension:.3, borderWidth:2, pointRadius:[], pointBackgroundColor:[] }]},
    options:{ animation:false, plugins:{legend:{display:false},
        tooltip:{callbacks:{title:i=>i[0].label+' h'}}},
      scales:{ x:{ grid:{display:false}, ticks:{maxTicksLimit:6} },
        y:{ grid:{color:'rgba(255,255,255,.06)'}, suggestedMin:15 } } }
  });
}

// ---------- 5. SELECT + UPDATE ----------
function select(id){ selected=id; refresh(); }

function refresh(){
  document.getElementById('time-label').textContent=timeLabel(currentT)+' h';
  document.getElementById('time-slider').value=currentT;

  let sumT=0, peak={t:-1,name:''}, alarms=[];
  ZONES.forEach(z=>{
    const t=z.series.temp[currentT], st=statusOf(t);
    sumT+=t; if(t>peak.t){peak={t,name:z.name};}
    if(st==='alarm') alarms.push({name:z.name, t});
    // heatmap color on zone box
    const col=tempColor(t);
    const zm=zoneMeshes.find(m=>m.userData.zoneId===z.id);
    zm.material.color.setRGB(...(heatmapOn?col.map(c=>c/255):[0.2,0.255,0.31]));
    zm.material.opacity=heatmapOn?0.62:0.5;
    // sensor marker + tag
    const sc=STATUS_COLOR[st];
    sensorMeshes[z.id].material.color.set(sc);
    sensorMeshes[z.id].material.emissive.set(sc);
    const tag=tags[z.id];
    tag.classList.toggle('sel', z.id===selected);
    tag.querySelector('.dot').style.background=sc;
    tag.querySelector('small').textContent=`${t.toFixed(1)}°C`;
  });

  // KPIs
  document.getElementById('kpi-alarms').textContent=alarms.length;
  document.getElementById('kpi-alarms').style.color=alarms.length?'#f0503a':'#ff9900';
  document.getElementById('kpi-avg').textContent=(sumT/ZONES.length).toFixed(1)+'°';
  document.getElementById('kpi-peak').textContent=peak.name;

  // selected readouts
  const z=ZONES.find(x=>x.id===selected);
  const t=z.series.temp[currentT], st=statusOf(t);
  document.getElementById('sel-name').textContent=z.name;
  const pill=document.getElementById('sel-status');
  pill.textContent=STATUS_LABEL[st]; pill.className='pill '+st;
  document.getElementById('ro-temp').textContent=t.toFixed(1);
  document.getElementById('ro-hum').textContent=z.series.hum[currentT];
  document.getElementById('ro-vib').textContent=z.series.vib[currentT];

  // chart
  const pr=new Array(STEPS).fill(0), pc=new Array(STEPS).fill('#ff9900'); pr[currentT]=6; pc[currentT]=STATUS_COLOR[st];
  chart.data.datasets[0].data=z.series.temp;
  chart.data.datasets[0].pointRadius=pr;
  chart.data.datasets[0].pointBackgroundColor=pc;
  chart.update('none');

  // alarm list
  const ul=document.getElementById('alarm-list');
  ul.innerHTML = alarms.length
    ? alarms.map(a=>`<li><span><b>${a.name}</b> <span class="zt">high temp</span></span><b>${a.t.toFixed(1)}°C</b></li>`).join('')
    : '<li class="none">No active alarms at this time</li>';
}

// ---------- 6. CONTROLS ----------
document.getElementById('time-slider').addEventListener('input',e=>{ currentT=+e.target.value; refresh(); });
document.getElementById('btn-play').addEventListener('click',e=>{
  playing=!playing; e.target.textContent=playing?'⏸':'▶';
  if(playing){ playTimer=setInterval(()=>{ currentT=(currentT+1)%STEPS; refresh(); },120); }
  else clearInterval(playTimer);
});
document.getElementById('btn-heatmap').addEventListener('click',e=>{ heatmapOn=!heatmapOn; e.target.classList.toggle('active',heatmapOn); refresh(); });
document.getElementById('btn-sprites').addEventListener('click',e=>{ spritesOn=!spritesOn; e.target.classList.toggle('active',spritesOn); });
document.getElementById('btn-reset').addEventListener('click',()=>{ camera.position.set(0,60,68); controls.target.set(0,2,0); });

// ---------- 7. BOOT ----------
window.addEventListener('load',()=>{ init(); initChart(); refresh(); });
