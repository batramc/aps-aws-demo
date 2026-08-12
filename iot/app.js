/* ============================================================
   APS Digital Twin on AWS — Shop Floor Assistant (AU 2026)
   Credential-free stand-in that mirrors the APS DataViz (IoT)
   Extension: sensor sprites, heatmap, 24h charts, time slider,
   layered tabs, camera fly-to, live incident ramp, and a
   6-step guided booth tour.
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

const WELDING_ALARM_T = 190;             // timeline index where the Welding Bay spike peaks (~15:50)
const CALM_T = 48;                       // calm early-morning index (~04:00) used to "resolve"

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

// ---------- 1b. STATIC ASSET METADATA + SOP KNOWLEDGE BASE ----------
const EQUIPMENT = {
  assembly:  { model:'ABB IRB 6700 Robotic Cell',    spec:'6-axis · 235 kg payload',       installed:'2021-03-14', lastService:'2026-06-02', mtbf:'4,200 h', firmware:'RobotWare 6.14' },
  welding:   { model:'Fronius TPS 500i Weld Station', spec:'MIG/MAG · 500 A · water-cooled', installed:'2020-08-09', lastService:'2026-02-18', mtbf:'2,600 h', firmware:'v3.8.1' },
  paint:     { model:'Dürr EcoRP E043 Paint Robot',   spec:'electrostatic · booth-integrated', installed:'2022-01-27', lastService:'2026-05-11', mtbf:'3,800 h', firmware:'v2.4.0' },
  packaging: { model:'KUKA KR 10 Palletizer',         spec:'10 kg · 1101 mm reach',         installed:'2023-05-30', lastService:'2026-07-01', mtbf:'5,100 h', firmware:'KSS 8.7' },
  qc:        { model:'Zeiss CONTURA CMM',             spec:'scanning probe · climate-ctrl', installed:'2021-11-02', lastService:'2026-04-22', mtbf:'6,400 h', firmware:'Calypso 2025' },
  utilities: { model:'Atlas Copco GA 55 Compressor',  spec:'55 kW · oil-injected',          installed:'2019-06-15', lastService:'2026-03-09', mtbf:'3,000 h', firmware:'Elektronikon Mk5' },
};

// SOP content keyed by fault type; faultOf() maps a zone's live state to one of these.
const SOPS = {
  overheat: {
    id:'SOP-114', kb:'KB-THERM-07', title:'Overheat Response',
    cause:'Coolant flow to the station has dropped — the heat-exchanger valve is likely fouled or the pump is cavitating, so process heat is not being carried away.',
    steps:[
      'Reduce duty cycle to 60% and confirm temperature stops climbing.',
      'Verify coolant pump pressure ≥ 2.4 bar; inspect the heat-exchanger valve for scaling.',
      'If pressure is low, switch to the backup coolant loop and flag the valve for maintenance.',
      'Once temperature is below 70°C for 10 min, restore full duty cycle and clear the alarm.',
    ],
  },
  humidity: {
    id:'SOP-052', kb:'KB-ENV-03', title:'High-Humidity Response',
    cause:'Ambient humidity in the zone is above the process window, risking condensation on parts and finish defects.',
    steps:[
      'Confirm the zone HVAC damper is open and the dehumidifier is running.',
      'Check for a failed extraction fan or a propped door upstream.',
      'Hold moisture-sensitive parts until relative humidity is back under 55%.',
    ],
  },
  vibration: {
    id:'SOP-078', kb:'KB-MECH-05', title:'Excess-Vibration Response',
    cause:'Vibration amplitude is above baseline — typically bearing wear, imbalance, or a loosening mount.',
    steps:[
      'Compare the vibration spectrum against the bearing-defect baseline.',
      'Inspect mounts and fasteners; re-torque to spec.',
      'If amplitude persists, schedule a bearing replacement in the next maintenance window.',
    ],
  },
  nominal: {
    id:'—', kb:'—', title:'No action required',
    cause:'All monitored parameters for this zone are within normal operating thresholds.',
    steps:['Continue normal operation.', 'Next preventive-maintenance check per the schedule.'],
  },
};
function faultOf(z){
  const t = tempAt(z), hum = z.series.hum[currentT], vib = z.series.vib[currentT];
  if (statusOf(t) !== 'ok') return 'overheat';
  if (hum >= 80) return 'humidity';
  if (vib >= 3.0) return 'vibration';
  return 'nominal';
}

// ---------- 2. STATE ----------
let currentT = 180, playing=false, playTimer=null, selected='welding';
let heatmapOn=true, spritesOn=true;
let liveOverride = {};                   // zoneId -> extra °C added by a live-triggered incident
let incidentTimer = null;
const timeLabel = t => { const m=t*5, h=Math.floor(m/60), mm=m%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; };

// effective temperature = base series + any live incident override
const tempAt = z => +(z.series.temp[currentT] + (liveOverride[z.id]||0)).toFixed(1);

// ---------- 3. THREE.JS SCENE ----------
let scene,camera,renderer,controls,raycaster,mouse,zoneMeshes=[],sensorMeshes={},tags={};
let camTween=null;                       // {from,to,start,dur}
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
  renderer.domElement.addEventListener('pointerdown',()=>{ camTween=null; }); // user drag cancels the tween
  window.addEventListener('resize',onResize);
  animate();
}

function onClick(e){
  const r=renderer.domElement.getBoundingClientRect();
  mouse.x=((e.clientX-r.left)/r.width)*2-1; mouse.y=-((e.clientY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  const hit=raycaster.intersectObjects(zoneMeshes)[0];
  if(hit){ const id=hit.object.userData.zoneId; select(id); flyToZone(id); }
}
function onResize(){ if(!el.clientWidth)return; camera.aspect=el.clientWidth/el.clientHeight;
  camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth,el.clientHeight); }

// ---------- 3b. CAMERA FLY-TO (tween target + position over ~1s) ----------
const smooth = p => p*p*(3-2*p);
function flyToZone(id){
  const z=ZONES.find(x=>x.id===id); if(!z||!camera) return;
  const tx=z._pos.x, tz=z._pos.z;
  camTween={
    from:{ px:camera.position.x, py:camera.position.y, pz:camera.position.z,
           tx:controls.target.x, ty:controls.target.y, tz:controls.target.z },
    to:{   px:tx*0.55, py:34, pz:tz+38, tx:tx, ty:4, tz:tz },
    start:performance.now(), dur:1000,
  };
}
function resetView(){ camTween=null; camera.position.set(0,60,68); controls.target.set(0,2,0); }

function animate(){
  requestAnimationFrame(animate);
  // camera tween
  if(camTween){
    const p=Math.min(1,(performance.now()-camTween.start)/camTween.dur), e=smooth(p);
    const f=camTween.from, t=camTween.to;
    camera.position.set(f.px+(t.px-f.px)*e, f.py+(t.py-f.py)*e, f.pz+(t.pz-f.pz)*e);
    controls.target.set(f.tx+(t.tx-f.tx)*e, f.ty+(t.ty-f.ty)*e, f.tz+(t.tz-f.tz)*e);
    if(p>=1) camTween=null;
  }
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
    const t=tempAt(z), st=statusOf(t);
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
    tag.classList.toggle('alarm', st==='alarm');
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
  const t=tempAt(z), st=statusOf(t);
  document.getElementById('sel-name').textContent=z.name;
  const pill=document.getElementById('sel-status');
  pill.textContent=STATUS_LABEL[st]; pill.className='pill '+st;
  document.getElementById('ro-temp').textContent=t.toFixed(1);
  document.getElementById('ro-hum').textContent=z.series.hum[currentT];
  document.getElementById('ro-vib').textContent=z.series.vib[currentT];

  // chart
  const cz=document.getElementById('chart-zone'); if(cz) cz.textContent=z.name;
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

  renderEquipment(); renderSOP();
}

// ---------- 5b. EQUIPMENT + SOP PANES ----------
function renderEquipment(){
  const host=document.getElementById('equip-card'); if(!host) return;
  const z=ZONES.find(x=>x.id===selected), e=EQUIPMENT[z.id]||{};
  const t=tempAt(z), st=statusOf(t);
  host.innerHTML=`
    <div class="equip-title"><b>${z.name}</b><span class="pill ${st}">${STATUS_LABEL[st]}</span></div>
    <div class="equip-model">${e.model||'—'}</div>
    <div class="equip-spec">${e.spec||''}</div>
    <div class="meta-grid">
      <div class="meta"><small>Installed</small><span>${e.installed||'—'}</span></div>
      <div class="meta"><small>Last service</small><span>${e.lastService||'—'}</span></div>
      <div class="meta"><small>MTBF</small><span>${e.mtbf||'—'}</span></div>
      <div class="meta"><small>Firmware</small><span>${e.firmware||'—'}</span></div>
    </div>`;
}
function renderSOP(){
  const host=document.getElementById('sop-card'); if(!host) return;
  const z=ZONES.find(x=>x.id===selected);
  const f=faultOf(z), s=SOPS[f];
  host.innerHTML=`
    <div class="sop-title"><span class="sop-id">${s.id}</span> ${s.title}
      <span class="sop-kb">${s.kb}</span></div>
    <div class="sop-cause"><b>Likely cause:</b> ${s.cause}</div>
    <ol class="sop-steps">${s.steps.map(x=>`<li>${x}</li>`).join('')}</ol>`;
}

// ---------- 6. TABS ----------
function showTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active', p.id==='pane-'+name));
}
document.getElementById('tabbar').addEventListener('click',e=>{
  const b=e.target.closest('.tab'); if(b) showTab(b.dataset.tab);
});

// ---------- 7. PIPELINE STRIP ANIMATION ----------
const pipeNodes = () => Array.from(document.querySelectorAll('#pipeline-strip .ps-node'));
let pipeStage=0;
setInterval(()=>{
  const nodes=pipeNodes(); if(!nodes.length) return;
  nodes.forEach(n=>n.classList.remove('flow'));
  nodes[pipeStage % nodes.length].classList.add('flow');
  pipeStage++;
}, 650);
function pulsePipeline(strong){
  const strip=document.getElementById('pipeline-strip');
  strip.classList.add('tour-active');
  if(!strong){ setTimeout(()=>strip.classList.remove('tour-active'), 4000); }
}

// ---------- 8. LIVE INCIDENT RAMP ----------
function triggerIncident(id){
  id = id || selected;
  const z=ZONES.find(x=>x.id===id); if(!z) return;
  if(statusOf(tempAt(z))==='alarm'){ id='assembly'; }   // ramp a currently-calm zone instead
  select(id); flyToZone(id); showTab('overview');
  const target=ZONES.find(x=>x.id===id);
  const startBase=target.series.temp[currentT];
  const targetAdd=Math.max(12, (ALARM+6)-startBase);    // guarantee it crosses into ALARM
  const start=performance.now(), dur=15000;
  clearInterval(incidentTimer);
  incidentTimer=setInterval(()=>{
    const p=Math.min(1,(performance.now()-start)/dur);
    liveOverride[id]=targetAdd*p;
    refresh();
    if(p>=1){ clearInterval(incidentTimer); }
  }, 200);
}
function clearIncidents(){ clearInterval(incidentTimer); liveOverride={}; refresh(); }

// ---------- 9. CONTROLS ----------
document.getElementById('time-slider').addEventListener('input',e=>{ currentT=+e.target.value; refresh(); });
document.getElementById('btn-play').addEventListener('click',e=>{
  playing=!playing; e.target.textContent=playing?'⏸':'▶';
  if(playing){ playTimer=setInterval(()=>{ currentT=(currentT+1)%STEPS; refresh(); },120); }
  else clearInterval(playTimer);
});
document.getElementById('btn-heatmap').addEventListener('click',e=>{ heatmapOn=!heatmapOn; e.target.classList.toggle('active',heatmapOn); refresh(); });
document.getElementById('btn-sprites').addEventListener('click',e=>{ spritesOn=!spritesOn; e.target.classList.toggle('active',spritesOn); });
document.getElementById('btn-reset').addEventListener('click',resetView);
document.getElementById('btn-incident').addEventListener('click',()=>triggerIncident(selected));

// ---------- 10. GUIDED TOUR ----------
const TOUR = [
  { title:'Sensors on the floor',
    text:'Every zone of the plant carries IoT sensors — temperature, humidity, vibration. The tags floating over the 3D model are those live sensors, overlaid exactly where the equipment sits.',
    hl:['.twin-pane'],
    action:()=>{ exitReset(); spritesOn=true; document.getElementById('btn-sprites').classList.add('active'); resetView(); refresh(); } },
  { title:'The data pipeline on AWS',
    text:'Readings flow edge → AWS IoT Core → Amazon Timestream for InfluxDB → API Gateway → a Bedrock AgentCore agent → back to the APS Viewer. Watch the strip light up as data moves through it.',
    hl:['#pipeline-strip'],
    action:()=>{ pulsePipeline(true); } },
  { title:'An incident emerges',
    text:'At 15:50 the Welding Bay overheats past 80 °C. The timeline jumps to the event, the heatmap turns red, and the camera flies straight to the zone in alarm.',
    hl:['.twin-pane','#kpi-alarms'],
    action:()=>{ document.getElementById('pipeline-strip').classList.remove('tour-active');
                 currentT=WELDING_ALARM_T; select('welding'); flyToZone('welding'); showTab('overview'); refresh(); } },
  { title:'Ask the twin',
    text:'Instead of digging through dashboards, the operator just asks. The question is sent with a live telemetry snapshot to the Bedrock AgentCore agent, which answers grounded in the real numbers.',
    hl:['#pane-diagnosis'],
    action:()=>{ showTab('diagnosis'); if(window.askTwin) window.askTwin('Why is Welding Bay in alarm?'); } },
  { title:'Root cause + equipment',
    text:'The Equipment tab shows what this zone actually is — a Fronius TPS 500i weld station, its firmware, install date, last service and MTBF. Spatial context the operator never had before.',
    hl:['#pane-equipment'],
    action:()=>{ select('welding'); showTab('equipment'); refresh(); } },
  { title:'Recommended action',
    text:'The SOPs tab pulls the matching fix procedure from the knowledge base — likely cause and step-by-step remediation. Apply it and the alarm clears.',
    hl:['#pane-sops'],
    action:()=>{ select('welding'); showTab('sops'); refresh();
                 setTimeout(()=>{ clearIncidents(); currentT=CALM_T; refresh(); }, 1600); } },
];
let tourIdx=-1;
const $ = id => document.getElementById(id);

function clearHighlights(){ document.querySelectorAll('.tour-hl').forEach(n=>n.classList.remove('tour-hl')); }
function applyHighlights(sels){ clearHighlights(); (sels||[]).forEach(s=>{ const n=document.querySelector(s); if(n) n.classList.add('tour-hl'); }); }

function exitReset(){ clearIncidents(); }

function renderTour(){
  const step=TOUR[tourIdx];
  $('tour-n').textContent=tourIdx+1;
  $('tour-total').textContent=TOUR.length;
  $('tour-title').textContent=step.title;
  $('tour-text').textContent=step.text;
  $('tour-back').disabled = tourIdx===0;
  $('tour-next').textContent = tourIdx===TOUR.length-1 ? 'Finish' : 'Next ›';
  applyHighlights(step.hl);
  try{ step.action && step.action(); }catch(e){ console.warn('[tour]',e); }
}
function startTour(){ tourIdx=0; $('tour-overlay').hidden=false; renderTour(); }
function endTour(){ $('tour-overlay').hidden=true; clearHighlights(); }
function tourNext(){ if(tourIdx<TOUR.length-1){ tourIdx++; renderTour(); } else endTour(); }
function tourBack(){ if(tourIdx>0){ tourIdx--; renderTour(); } }

$('btn-tour').addEventListener('click',startTour);
$('tour-next').addEventListener('click',tourNext);
$('tour-back').addEventListener('click',tourBack);
$('tour-exit').addEventListener('click',endTour);

// ---------- 11. SNAPSHOT (shared with chat.js; reflects live overrides) ----------
window.twinSnapshot = function(){
  const zones = ZONES.map(z => ({
    name: z.name, temp: tempAt(z), hum: z.series.hum[currentT], vib: z.series.vib[currentT],
    status: statusOf(tempAt(z)),
  }));
  const avg = +(zones.reduce((s,z)=>s+z.temp,0)/zones.length).toFixed(1);
  const peak = [...zones].sort((a,b)=>b.temp-a.temp)[0].name;
  return { time: timeLabel(currentT)+' h', zones, avg, peak };
};

// ---------- 12. BOOT ----------
window.addEventListener('load',()=>{ init(); initChart(); refresh(); });
