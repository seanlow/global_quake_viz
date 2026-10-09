const FEEDS = {
  all_day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day",
  significant_day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day",
  "4.5_day": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day",
  all_week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week",
  "2.5_week": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week",
  "4.5_week": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week",
  significant_week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week",
  all_month: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month"
};

const canvas = document.createElement("canvas");
canvas.setAttribute("aria-label", "Interactive earthquake globe");
document.querySelector("#globe").appendChild(canvas);
const ctx = canvas.getContext("2d");

const globeEl = document.querySelector("#globe");
const statusEl = document.querySelector("#status");
const fileWarning = document.querySelector("#fileWarning");
const feedSelect = document.querySelector("#feedSelect");
const minMag = document.querySelector("#minMag");
const minMagValue = document.querySelector("#minMagValue");
const rotateToggle = document.querySelector("#rotateToggle");
const refreshBtn = document.querySelector("#refreshBtn");
const resetBtn = document.querySelector("#resetBtn");
const panelToggle = document.querySelector("#panelToggle");
const sidebar = document.querySelector("#sidebar");
const layout = document.querySelector(".layout");
const panels = sidebar.querySelectorAll("details");
const eventCount = document.querySelector("#eventCount");
const largestMag = document.querySelector("#largestMag");
const avgMag = document.querySelector("#avgMag");
const updatedAt = document.querySelector("#updatedAt");
const selectedEvent = document.querySelector("#selectedEvent");
const distribution = document.querySelector("#distribution");

let events = [];
let visibleEvents = [];
let renderSet = [];
let selectedEventIndex = -1;
let rotation = 0.45;
let tilt = 0.08;
let zoom = 1;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 20.0;
let dragging = false;
let lastX = 0, lastY = 0;
let dpr = 1;
let width = 800, height = 600;
let requestSerial = 0;

const sampleEvents = [
  { id:"sample-1", title:"Sample M 5.2 — Pacific Ocean", magnitude:5.2, time:Date.now()-3600000, place:"Pacific Ocean", url:"https://earthquake.usgs.gov/earthquakes/map/", longitude:-150, latitude:20, depth:18 },
  { id:"sample-2", title:"Sample M 4.6 — Alaska", magnitude:4.6, time:Date.now()-7200000, place:"Alaska", url:"https://earthquake.usgs.gov/earthquakes/map/", longitude:-150, latitude:58, depth:12 },
  { id:"sample-3", title:"Sample M 3.4 — California", magnitude:3.4, time:Date.now()-10800000, place:"California", url:"https://earthquake.usgs.gov/earthquakes/map/", longitude:-118, latitude:36, depth:8 }
];

function init() {
  if (location.protocol === "file:") {
    fileWarning.classList.remove("hidden");
    setStatus("Serve this folder over HTTP/HTTPS to load live USGS data.");
  }

  resize();
  window.addEventListener("resize", resize);
  new ResizeObserver(resize).observe(globeEl);

  canvas.addEventListener("pointerdown", e => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (!dragging) return;
    rotation += (e.clientX - lastX) * 0.006;
    tilt = clamp(tilt + (e.clientY - lastY) * 0.004, -0.9, 0.9);
    lastX = e.clientX;
    lastY = e.clientY;
    draw();
  });
  canvas.addEventListener("pointerup", () => dragging = false);
  canvas.addEventListener("pointercancel", () => dragging = false);
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    zoom = clamp(zoom * Math.exp(-e.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM);
    draw();
  }, { passive:false });
  canvas.addEventListener("click", pickEvent);

  feedSelect.addEventListener("change", loadFeed);
  minMag.addEventListener("input", () => {
    minMagValue.textContent = Number(minMag.value).toFixed(1);
    applyFilter();
  });
  rotateToggle.addEventListener("change", () => {});
  refreshBtn.addEventListener("click", loadFeed);
  resetBtn.addEventListener("click", resetView);
  panelToggle.addEventListener("click", () => {
    setSidebarVisible(sidebar.hidden);
  });
  panels.forEach(panel => panel.addEventListener("toggle", () => {
    if ([...panels].every(item => !item.open)) setSidebarVisible(false);
  }));

  draw();
  loadFeed();
  requestAnimationFrame(animate);
}

async function loadFeed() {
  if (location.protocol === "file:") return;
  const serial = ++requestSerial;
  refreshBtn.disabled = true;
  setStatus("Loading USGS data…");

  try {
    const response = await fetch(FEEDS[feedSelect.value] + ".geojson", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`USGS returned HTTP ${response.status}`);
    const data = await response.json();
    if (serial !== requestSerial) return;
    if (!Array.isArray(data.features)) throw new Error("USGS returned an unexpected response.");
    events = normalize(data.features);
    applyFilter();
    setStatus(`${events.length.toLocaleString()} live USGS events loadedz`);
    refreshBtn.disabled = false;
  } catch (error) {
    loadJsonpFallback(serial, error);
  }
}

function loadJsonpFallback(serial, originalError) {
  const callbackName = "__usgs_cb_" + Date.now();
  let finished = false;

  window[callbackName] = data => {
    if (finished || serial !== requestSerial) return;
    finished = true;
    cleanup();
    if (!data || !Array.isArray(data.features)) {
      fail(new Error("USGS returned an unexpected response."));
      return;
    }
    events = normalize(data.features);
    applyFilter();
    setStatus(`${events.length.toLocaleString()} live USGS events loadedz`);
    refreshBtn.disabled = false;
  };

  const script = document.createElement("script");
  script.src = FEEDS[feedSelect.value] + ".geojsonp?callback=" + callbackName + "&_=" + Date.now();
  script.async = true;
  script.onerror = () => {
    if (finished) return;
    finished = true;
    cleanup();
    fail(originalError);
  };

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();
    fail(new Error("USGS did not respond within 10 seconds."));
  }, 10000);

  document.head.appendChild(script);

  function cleanup() {
    clearTimeout(timer);
    delete window[callbackName];
    script.remove();
  }

  function fail(error) {
    console.error(error);
    refreshBtn.disabled = false;
    events = sampleEvents.slice();
    applyFilter();
    setStatus("USGS unavailable — showing demo data");
    selectedEvent.classList.remove("empty");
    selectedEvent.innerHTML =
      `<strong>Live USGS data could not be loaded.</strong><br>${escapeHtml(error.message)}<br><br>` +
      `The globe is showing clearly labeled sample data so the visualization still works.`;
  }
}

function normalize(features) {
  return features
    .filter(f => Array.isArray(f.geometry?.coordinates))
    .map(f => ({
      id: f.id,
      title: f.properties?.title || "Earthquake",
      magnitude: Number(f.properties?.mag),
      time: Number(f.properties?.time),
      place: f.properties?.place || "Unknown location",
      url: f.properties?.url,
      longitude: Number(f.geometry.coordinates[0]),
      latitude: Number(f.geometry.coordinates[1]),
      depth: Number(f.geometry.coordinates[2])
    }))
    .filter(e =>
      Number.isFinite(e.magnitude) &&
      Number.isFinite(e.longitude) &&
      Number.isFinite(e.latitude)
    );
}

function applyFilter() {
  const threshold = Number(minMag.value);
  visibleEvents = events.filter(e => e.magnitude >= threshold);
  renderSet = visibleEvents.length > 1200
    ? [...visibleEvents].sort((a,b) => b.magnitude - a.magnitude).slice(0, 1200)
    : visibleEvents;
  updateStats(visibleEvents);
  renderDistribution(visibleEvents);
  if (selectedEventIndex >= visibleEvents.length) selectedEventIndex = -1;
  draw();
}

function updateStats(list) {
  eventCount.textContent = list.length.toLocaleString();
  if (!list.length) {
    largestMag.textContent = "—";
    avgMag.textContent = "—";
  } else {
    largestMag.textContent = Math.max(...list.map(e => e.magnitude)).toFixed(1);
    avgMag.textContent = (list.reduce((s,e) => s + e.magnitude,0) / list.length).toFixed(2);
  }
  updatedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

function renderDistribution(list) {
  const buckets = [
    ["< 2", e => e.magnitude < 2],
    ["2–3", e => e.magnitude >= 2 && e.magnitude < 3],
    ["3–4", e => e.magnitude >= 3 && e.magnitude < 4],
    ["4–5", e => e.magnitude >= 4 && e.magnitude < 5],
    ["5+", e => e.magnitude >= 5]
  ];
  const counts = buckets.map(([,fn]) => list.filter(fn).length);
  const max = Math.max(...counts, 1);
  distribution.innerHTML = buckets.map(([label],i) => `
    <div class="bar-row"><span>${label}</span><div class="bar"><i style="width:${counts[i]/max*100}%"></i></div><strong>${counts[i]}</strong></div>
  `).join("");
}

function draw() {
  const w = width, h = height;
  ctx.clearRect(0,0,w,h);

  const cx = w/2, cy = h/2;
  const radius = Math.min(w,h) * 0.39 * zoom;

  const glow = ctx.createRadialGradient(cx-radius*.35, cy-radius*.4, radius*.15, cx, cy, radius*1.15);
  glow.addColorStop(0, "#234a73");
  glow.addColorStop(.7, "#102943");
  glow.addColorStop(1, "#07111f");

  ctx.beginPath();
  ctx.arc(cx,cy,radius,0,Math.PI*2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx,cy,radius,0,Math.PI*2);
  ctx.clip();

  drawLand(cx,cy,radius);
  drawGraticule(cx,cy,radius);
  drawEvents(cx,cy,radius);

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx,cy,radius,0,Math.PI*2);
  ctx.strokeStyle = "rgba(125,183,255,.38)";
  ctx.lineWidth = 1.5*dpr;
  ctx.stroke();

  // Small interaction hint
  ctx.fillStyle = "rgba(170,190,215,.65)";
  ctx.font = `${11*dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText("Drag to rotate · Scroll to zoom · Click an event", cx, h-18*dpr);
}

function drawLand(cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = "rgba(155, 190, 145, 0.78)";
  ctx.lineWidth = Math.max(1, dpr * 0.9);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const polygon of LAND_POLYGONS) {
    if (!Array.isArray(polygon) || polygon.length < 2) continue;

    let segment = [];

    const flush = () => {
      if (segment.length < 2) {
        segment = [];
        return;
      }

      ctx.beginPath();
      segment.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      segment = [];
    };

    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const previous = i ? polygon[i - 1] : current;
      const seamJump = i > 0 && Math.abs(current[0] - previous[0]) > 180;

      if (seamJump) flush();

      const p = project(current[1], current[0], cx, cy, r);

      if (!p.visible || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        flush();
        continue;
      }

      segment.push(p);
    }

    flush();
  }

  ctx.restore();
}

function drawGraticule(cx,cy,r) {
  ctx.strokeStyle = "rgba(130,170,210,.16)";
  ctx.lineWidth = Math.max(1, dpr*.7);

  for (let lat=-60; lat<=60; lat+=30) drawLatitude(cx,cy,r,lat);
  for (let lon=-150; lon<=180; lon+=30) drawLongitude(cx,cy,r,lon);
}

function drawLatitude(cx,cy,r,lat) {
  const pts=[];
  for(let lon=-180;lon<=180;lon+=3) {
    pts.push(project(lat,lon,cx,cy,r));
  }
  strokeVisiblePath(pts);
}

function drawLongitude(cx,cy,r,lon) {
  const pts=[];
  for(let lat=-90;lat<=90;lat+=3) {
    pts.push(project(lat,lon,cx,cy,r));
  }
  strokeVisiblePath(pts);
}

function strokeVisiblePath(pts) {
  let segment=[];
  for(const p of pts) {
    if(p.visible) {
      segment.push(p);
    } else {
      strokePath(segment);
      segment=[];
    }
  }
  strokePath(segment);
}

function strokePath(pts) {
  if(!pts.length) return;
  ctx.beginPath();
  pts.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
  ctx.stroke();
}

function drawEvents(cx,cy,r) {
  const projected = [];
  for (let i=0; i<renderSet.length; i++) {
    const e=renderSet[i];
    const p=project(e.latitude,e.longitude,cx,cy,r*1.015);
    if(p.visible) projected.push({...p,e,index:i});
  }
  projected.sort((a,b)=>a.z-b.z);

  for(const q of projected) {
    const size = (2.2 + Math.max(0,q.e.magnitude)*1.35) * dpr;
    ctx.beginPath();
    ctx.arc(q.x,q.y,size,0,Math.PI*2);
    ctx.fillStyle=magnitudeColor(q.e.magnitude);
    ctx.globalAlpha=.45+.55*q.z;
    ctx.fill();
    if(q.e.id === visibleEvents[selectedEventIndex]?.id) {
      ctx.globalAlpha=1;
      ctx.beginPath();
      ctx.arc(q.x,q.y,size+5*dpr,0,Math.PI*2);
      ctx.strokeStyle="#fff";
      ctx.lineWidth=1.5*dpr;
      ctx.stroke();
    }
  }
  ctx.globalAlpha=1;
}

function project(lat,lon,cx,cy,r) {
  const phi=lat*Math.PI/180;
  const lambda=(lon*Math.PI/180)+rotation;
  const x3=Math.cos(phi)*Math.sin(lambda);
  const y3=Math.sin(phi)*Math.cos(tilt)-Math.cos(phi)*Math.cos(lambda)*Math.sin(tilt);
  const z3=Math.sin(phi)*Math.sin(tilt)+Math.cos(phi)*Math.cos(lambda)*Math.cos(tilt);
  return {x:cx+x3*r,y:cy-y3*r,z:(z3+1)/2,visible:z3>-0.03};
}

function pickEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;

  let best = null;
  let bestScore = Infinity;
  const hitRadius = Math.max(12 * dpr, Math.min(30 * dpr, 18 * dpr * Math.sqrt(zoom)));

  for (const event of renderSet) {
    const p = project(event.latitude, event.longitude, width / 2, height / 2,
      Math.min(width, height) * 0.39 * zoom * 1.015);

    if (!p.visible) continue;

    const dx = px - p.x;
    const dy = py - p.y;
    const d2 = dx * dx + dy * dy;

    if (d2 > hitRadius * hitRadius) continue;

    // Prefer the closest marker. For nearly identical positions,
    // prefer the larger earthquake.
    const mag = Number(event.magnitude) || 0;
    const score = d2 - Math.min(9, mag) * dpr;
    if (score < bestScore) {
      bestScore = score;
      best = event;
    }
  }

  if (!best) return;

  const index = visibleEvents.findIndex(event => event.id === best.id);
  if (index >= 0) selectEvent(index);
}

function selectEvent(i) {
  selectedEventIndex=i;
  const e=visibleEvents[i];
  selectedEvent.classList.remove("empty");
  selectedEvent.innerHTML=`
    <strong>${escapeHtml(e.title)}</strong>
    <dl>
      <dt>Magnitude</dt><dd>${e.magnitude.toFixed(1)}</dd>
      <dt>Depth</dt><dd>${Number.isFinite(e.depth)?e.depth.toFixed(1):"—"} km</dd>
      <dt>Coordinates</dt><dd>${e.latitude.toFixed(2)}, ${e.longitude.toFixed(2)}</dd>
      <dt>Time</dt><dd>${e.time?new Date(e.time).toLocaleString():"—"}</dd>
    </dl>
    ${e.url?`<a href="${e.url}" target="_blank" rel="noopener">View on USGS ↗</a>`:""}
  `;
  draw();
}

function resetView() {
  rotation=.45; tilt=.08; zoom=1; selectedEventIndex=-1;
  selectedEvent.classList.add("empty");
  selectedEvent.textContent="Click an earthquake on the globe.";
  draw();
}

function setSidebarVisible(visible) {
  sidebar.hidden = !visible;
  layout.classList.toggle("panels-hidden", !visible);
  panelToggle.textContent = visible ? "Hide panels" : "Show panels";
  panelToggle.setAttribute("aria-expanded", String(visible));
}

function resize() {
  const rect=globeEl.getBoundingClientRect();
  dpr=Math.min(window.devicePixelRatio||1,2);
  width=Math.max(320,rect.width*dpr);
  height=Math.max(320,rect.height*dpr);
  canvas.width=width;
  canvas.height=height;
  canvas.style.width=rect.width+"px";
  canvas.style.height=rect.height+"px";
  draw();
}

function animate() {
  if (rotateToggle.checked && !dragging) {
    rotation += 0.0010;
    draw();
  }
  requestAnimationFrame(animate);
}

// update color with opacity
function magnitudeColor(m) {
  if(m>=6)return 'rgba(255, 77, 103, 0.75)';
  if(m>=5)return 'rgba(255, 77, 103, 0.50)';
  if(m>=4)return 'rgba(255, 210, 77, 0.33)';
  if(m>=3)return 'rgba(117, 214, 154, 0.25)';
  return 'rgba(101, 183, 255, 0.25)';
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function setStatus(s){statusEl.textContent=s;}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

init();
