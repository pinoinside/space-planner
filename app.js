const $ = s => document.querySelector(s);
const stage = $("#stage"), viewport = $("#viewport"), roomEl = $("#room"), gridEl = $("#grid"), objectsEl = $("#objects"), labelsLayer = $("#labelsLayer"), canvasWrap = $("#canvasWrap");

let project = {
  version: 1,
  space: { name: "Padiglione A", width: 20, height: 12 },
  fixedElements: [
    { id: "column-1", type: "column", name: "Colonna C1", x: 2.5, y: 2.5, width: 0.8, height: 0.8 },
    { id: "furniture-1", type: "furniture", name: "Bancone Info", x: 13.5, y: 1.5, width: 3.0, height: 1.0 }
  ],
  exhibitors: [
    {
      id: "exhibitor-1", name: "Area Tech", color: "#dbeae7", x: 4, y: 3, width: 7, height: 5,
      tables: [
        { id: "table-1", merchant: "Rossi S.r.l.", x: 0.6, y: 0.8, width: 2.2, height: 1.4 },
        { id: "table-2", merchant: "Bianchi S.p.A.", x: 3.8, y: 2.4, width: 2.2, height: 1.4 }
      ]
    }
  ],
  openings: [
    { id: "door-1", type: "door", name: "Ingresso Principale", wall: "bottom", offset: 8.5, width: 1.6, direction: "out" },
    { id: "window-1", type: "window", name: "Finestra Est", wall: "right", offset: 3.0, width: 2.0 }
  ]
};

let selected = null;
let hovered = null;
let labelMode = "hover"; // "hover", "merchants", "all"
let scale = 1, fitScale = 1, offset = { x: 0, y: 0 }, gridOn = true, history = [], future = [];
let moveMode = false;
let drag = null;
let isPanning = false;
let panStart = { x: 0, y: 0 };

const STORAGE_KEY = "spazio_planimetria_data";

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (err) {
    console.warn("Impossibile salvare in localStorage", err);
  }
}

function loadFromLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      validateAndApplyProject(parsed);
      return true;
    }
  } catch (err) {
    console.warn("Errore durante il caricamento da localStorage", err);
  }
  return false;
}

function validateAndApplyProject(data) {
  if (!data || typeof data !== "object") throw new Error("Formato JSON non valido");
  
  project = {
    version: data.version || 1,
    space: {
      name: data.space?.name || "Padiglione A",
      width: Number(data.space?.width) || 20,
      height: Number(data.space?.height) || 12
    },
    fixedElements: Array.isArray(data.fixedElements) ? data.fixedElements : [],
    exhibitors: Array.isArray(data.exhibitors) ? data.exhibitors.map(e => ({
      ...e,
      tables: Array.isArray(e.tables) ? e.tables : []
    })) : [],
    openings: Array.isArray(data.openings) ? data.openings : []
  };

  clampOpenings();
  syncRoomInputs();
  render();
  fitView();
  showProps();
}

function uid(prefix) { return prefix + "-" + Math.random().toString(36).slice(2, 8); }
function snapshot() { 
  history.push(JSON.stringify(project)); 
  if (history.length > 30) history.shift(); 
  future = []; 
  markDirty(); 
}
function restore(s) { 
  project = JSON.parse(s); 
  if (!project.openings) project.openings = [];
  selected = null; 
  hovered = null; 
  syncRoomInputs(); 
  render(); 
  showProps(); 
  saveToLocalStorage();
}
function markDirty() { 
  $("#saveStatus").textContent = "Modifiche non salvate"; 
  saveToLocalStorage();
}
function markSaved() { 
  $("#saveStatus").textContent = "Salvato"; 
  saveToLocalStorage();
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
function esc(s) { return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])); }

function getObj(kind, id) {
  if (kind === "fixed") return project.fixedElements.find(x => x.id === id);
  if (kind === "exhibitor") return project.exhibitors.find(x => x.id === id);
  if (kind === "opening") return project.openings.find(x => x.id === id);
  if (kind === "table") {
    for (const e of project.exhibitors) {
      const t = e.tables.find(x => x.id === id);
      if (t) return t;
    }
  }
}
function getParentExhibitor(tableId) {
  return project.exhibitors.find(e => e.tables.some(t => t.id === tableId));
}

function getOpeningCoords(o) {
  const rw = project.space.width;
  const rh = project.space.height;
  const w = o.width || 1.2;
  const wallThick = 0.16;

  if (o.wall === "top") {
    return { x: o.offset, y: -wallThick / 2, width: w, height: wallThick, rot: 0 };
  } else if (o.wall === "bottom") {
    return { x: o.offset, y: rh - wallThick / 2, width: w, height: wallThick, rot: 0 };
  } else if (o.wall === "left") {
    return { x: -wallThick / 2, y: o.offset, width: wallThick, height: w, rot: 90 };
  } else if (o.wall === "right") {
    return { x: rw - wallThick / 2, y: o.offset, width: wallThick, height: w, rot: 90 };
  }
  return { x: o.offset, y: 0, width: w, height: wallThick, rot: 0 };
}

function fitView() {
  const cw = canvasWrap.clientWidth, ch = canvasWrap.clientHeight;
  const pad = 60, rw = project.space.width, rh = project.space.height;
  fitScale = Math.min((cw - pad * 2) / rw, (ch - pad * 2) / rh);
  scale = fitScale;
  offset = { x: (cw - rw * scale) / 2, y: (ch - rh * scale) / 2 };
  updateTransform();
}

function updateTransform() {
  viewport.setAttribute("transform", `translate(${offset.x},${offset.y}) scale(${scale})`);
  const zoomPct = fitScale > 0 ? Math.round((scale / fitScale) * 100) : 100;
  $("#zoomLabel").textContent = zoomPct + "%";
}

function zoomAt(factor, cx, cy) {
  const oldScale = scale;
  const minS = Math.max(2, fitScale * 0.3);
  const maxS = Math.min(300, fitScale * 12);
  const newScale = Math.max(minS, Math.min(maxS, scale * factor));
  
  if (Math.abs(newScale - oldScale) < 0.0001) return;

  const ratio = newScale / oldScale;
  offset.x = cx - (cx - offset.x) * ratio;
  offset.y = cy - (cy - offset.y) * ratio;
  scale = newScale;
  updateTransform();
}

function roomPoint(evt) {
  const r = stage.getBoundingClientRect();
  return { x: (evt.clientX - r.left - offset.x) / scale, y: (evt.clientY - r.top - offset.y) / scale };
}

function snap(v) { return gridOn ? Math.round(v * 2) / 2 : v; }

function syncRoomInputs() {
  $("#roomNameInput").value = project.space.name || "";
  $("#roomWidthInput").value = project.space.width;
  $("#roomHeightInput").value = project.space.height;
}

function initRoomControls() {
  $("#roomNameInput").oninput = (e) => {
    project.space.name = e.target.value;
    $("#spaceTitle").textContent = project.space.name || "Senza Nome";
    markDirty();
  };
  $("#roomWidthInput").onchange = (e) => {
    const val = Math.max(2, parseFloat(e.target.value) || 10);
    snapshot();
    project.space.width = val;
    clampOpenings();
    render();
    fitView();
  };
  $("#roomHeightInput").onchange = (e) => {
    const val = Math.max(2, parseFloat(e.target.value) || 10);
    snapshot();
    project.space.height = val;
    clampOpenings();
    render();
    fitView();
  };
}

function clampOpenings() {
  if (!project.openings) project.openings = [];
  project.openings.forEach(o => {
    const maxLen = (o.wall === "top" || o.wall === "bottom") ? project.space.width : project.space.height;
    o.offset = Math.max(0, Math.min(maxLen - o.width, o.offset));
  });
}

function updateStats() {
  let merchantCount = 0;
  let merchantMeters = 0;
  let totalAvailableMeters = 0;

  project.exhibitors.forEach(e => {
    const spaceMeters = Math.max(e.width || 0, e.height || 0);
    totalAvailableMeters += spaceMeters;

    if (Array.isArray(e.tables)) {
      merchantCount += e.tables.length;
      e.tables.forEach(t => {
        merchantMeters += Math.max(t.width || 0, t.height || 0);
      });
    }
  });

  const roomArea = (project.space.width || 0) * (project.space.height || 0);
  const fixedArea = project.fixedElements.reduce((sum, f) => sum + ((f.width || 0) * (f.height || 0)), 0);
  const netExhibitorArea = Math.max(0, roomArea - fixedArea);

  const occupancyRatio = totalAvailableMeters > 0 ? Math.round((merchantMeters / totalAvailableMeters) * 100) : 0;

  const statMerchantsEl = $("#statMerchants");
  const statMetersEl = $("#statExhibitorsMeters");
  const statLengthEl = $("#statExhibitorsLength");
  const statOccupancyEl = $("#statOccupancy");

  if (statMerchantsEl) statMerchantsEl.textContent = merchantCount;
  if (statMetersEl) statMetersEl.textContent = `${netExhibitorArea.toFixed(1)} m²`;
  if (statLengthEl) statLengthEl.textContent = `${merchantMeters.toFixed(1)} m`;
  if (statOccupancyEl) statOccupancyEl.textContent = `${occupancyRatio}%`;
}

function render() {
  if (!project.openings) project.openings = [];

  roomEl.setAttribute("width", project.space.width);
  roomEl.setAttribute("height", project.space.height);
  roomEl.setAttribute("rx", "0");
  roomEl.setAttribute("ry", "0");

  gridEl.setAttribute("width", project.space.width);
  gridEl.setAttribute("height", project.space.height);
  gridEl.style.display = gridOn ? "block" : "none";

  objectsEl.innerHTML = "";
  labelsLayer.innerHTML = "";

  const draw = (o, kind, parent) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add("obj");
    
    const isSelected = selected && selected.kind === kind && selected.id === o.id;
    if (isSelected) {
      g.classList.add("selected");
    }
    g.dataset.kind = kind;
    g.dataset.id = o.id;

    let fill = "#ddd9d1", stroke = "#a7a199", rx = 0.1, label = "";

    if (kind === "exhibitor") {
      fill = o.color || "#dbeae7";
      stroke = "#54847d";
      rx = 0.15;
      label = o.name;
    } else if (kind === "table") {
      fill = o.color || "#ffffff";
      stroke = "#9ab5b0";
      rx = 0.1;
      label = o.merchant || "Tavolo";
      g.setAttribute("transform", `translate(${parent.x},${parent.y})`);
    } else if (kind === "fixed") {
      const defaultColor = o.type === "column" ? "#77736c" : (o.type === "stairs" ? "#8a857b" : (o.type === "wall" ? "#3a3731" : "#9b968e"));
      fill = o.color || defaultColor;
      stroke = "none";
      rx = o.type === "column" ? o.width * 50 : (o.type === "wall" ? 0.04 : 0.08);
      label = o.name;
    }

    if (kind === "opening") {
      const coords = getOpeningCoords(o);
      label = o.name || (o.type === "door" ? "Porta" : "Finestra");

      const bgCut = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgCut.setAttribute("x", coords.x);
      bgCut.setAttribute("y", coords.y);
      bgCut.setAttribute("width", coords.width);
      bgCut.setAttribute("height", coords.height);
      bgCut.setAttribute("fill", "#f2f0ec");
      g.appendChild(bgCut);

      if (o.type === "door") {
        const dGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const dw = o.width;
        const dh = 0.14;
        const dir = o.direction || "out";
        const jThickness = 0.08;
        const jColor = "#5c3619";

        if (o.wall === "top" || o.wall === "bottom") {
          const j1 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          j1.setAttribute("x", coords.x);
          j1.setAttribute("y", coords.y);
          j1.setAttribute("width", jThickness);
          j1.setAttribute("height", coords.height);
          j1.setAttribute("fill", jColor);

          const j2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          j2.setAttribute("x", coords.x + dw - jThickness);
          j2.setAttribute("y", coords.y);
          j2.setAttribute("width", jThickness);
          j2.setAttribute("height", coords.height);
          j2.setAttribute("fill", jColor);

          dGroup.appendChild(j1);
          dGroup.appendChild(j2);

          if (dir === "line") {
            const lineThick = coords.height * 2;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            line.setAttribute("x", coords.x + jThickness);
            line.setAttribute("y", coords.y + (coords.height - lineThick) / 2);
            line.setAttribute("width", Math.max(0, dw - (jThickness * 2)));
            line.setAttribute("height", lineThick);
            line.setAttribute("fill", "#8b5f38");
            line.setAttribute("rx", "0.04");
            dGroup.appendChild(line);
          } else {
            const isOut = dir === "out";
            const isTop = o.wall === "top";
            const pointsDown = isTop ? !isOut : isOut;
            const signY = pointsDown ? 1 : -1;

            const leafX = coords.x + jThickness;
            const leafY = coords.y + (coords.height - dh) / 2;

            const leaf = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            leaf.setAttribute("x", leafX);
            leaf.setAttribute("y", signY > 0 ? leafY : leafY - dw + dh);
            leaf.setAttribute("width", dh);
            leaf.setAttribute("height", dw);
            leaf.setAttribute("fill", "#8b5f38");
            leaf.setAttribute("rx", "0.03");

            const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const startY = leafY + (signY > 0 ? 0 : dh);
            const endY = startY + signY * dw;
            const sweep = signY > 0 ? 1 : 0;
            arc.setAttribute("d", `M ${coords.x + dw - jThickness} ${startY} A ${dw} ${dw} 0 0 ${sweep} ${leafX + dh} ${endY}`);
            arc.setAttribute("fill", "none");
            arc.setAttribute("stroke", "#a37851");
            arc.setAttribute("stroke-width", "0.04");
            arc.setAttribute("stroke-dasharray", "0.12 0.08");

            dGroup.appendChild(arc);
            dGroup.appendChild(leaf);
          }
        } else {
          const j1 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          j1.setAttribute("x", coords.x);
          j1.setAttribute("y", coords.y);
          j1.setAttribute("width", coords.width);
          j1.setAttribute("height", jThickness);
          j1.setAttribute("fill", jColor);

          const j2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          j2.setAttribute("x", coords.x);
          j2.setAttribute("y", coords.y + dw - jThickness);
          j2.setAttribute("width", coords.width);
          j2.setAttribute("height", jThickness);
          j2.setAttribute("fill", jColor);

          dGroup.appendChild(j1);
          dGroup.appendChild(j2);

          if (dir === "line") {
            const lineThick = coords.width * 2;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            line.setAttribute("x", coords.x + (coords.width - lineThick) / 2);
            line.setAttribute("y", coords.y + jThickness);
            line.setAttribute("width", lineThick);
            line.setAttribute("height", Math.max(0, dw - (jThickness * 2)));
            line.setAttribute("fill", "#8b5f38");
            line.setAttribute("rx", "0.04");
            dGroup.appendChild(line);
          } else {
            const isOut = dir === "out";
            const isLeft = o.wall === "left";
            const pointsRight = isLeft ? isOut : !isOut;
            const signX = pointsRight ? 1 : -1;

            const leafX = coords.x + (coords.width - dh) / 2;
            const leafY = coords.y + jThickness;

            const leaf = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            leaf.setAttribute("x", signX > 0 ? leafX : leafX - dw + dh);
            leaf.setAttribute("y", leafY);
            leaf.setAttribute("width", dw);
            leaf.setAttribute("height", dh);
            leaf.setAttribute("fill", "#8b5f38");
            leaf.setAttribute("rx", "0.03");

            const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const startX = leafX + (signX > 0 ? 0 : dh);
            const endX = startX + signX * dw;
            const sweep = signX > 0 ? 1 : 0;
            arc.setAttribute("d", `M ${startX} ${coords.y + dw - jThickness} A ${dw} ${dw} 0 0 ${sweep} ${endX} ${leafY + dh}`);
            arc.setAttribute("fill", "none");
            arc.setAttribute("stroke", "#a37851");
            arc.setAttribute("stroke-width", "0.04");
            arc.setAttribute("stroke-dasharray", "0.12 0.08");

            dGroup.appendChild(arc);
            dGroup.appendChild(leaf);
          }
        }
        g.appendChild(dGroup);
      } else {
        const wGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const winRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        winRect.setAttribute("x", coords.x);
        winRect.setAttribute("y", coords.y);
        winRect.setAttribute("width", coords.width);
        winRect.setAttribute("height", coords.height);
        winRect.setAttribute("fill", "#d4ebff");
        winRect.setAttribute("stroke", "#3a84c8");
        winRect.setAttribute("stroke-width", "0.04");
        wGroup.appendChild(winRect);

        const innerLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        if (o.wall === "top" || o.wall === "bottom") {
          innerLine.setAttribute("x1", coords.x);
          innerLine.setAttribute("y1", coords.y + coords.height / 2);
          innerLine.setAttribute("x2", coords.x + coords.width);
          innerLine.setAttribute("y2", coords.y + coords.height / 2);
        } else {
          innerLine.setAttribute("x1", coords.x + coords.width / 2);
          innerLine.setAttribute("y1", coords.y);
          innerLine.setAttribute("x2", coords.x + coords.width / 2);
          innerLine.setAttribute("y2", coords.y + coords.height);
        }
        innerLine.setAttribute("stroke", "#1f62a1");
        innerLine.setAttribute("stroke-width", "0.04");
        wGroup.appendChild(innerLine);

        g.appendChild(wGroup);
      }

      if (isSelected) {
        const selPad = 0.05;
        const sel = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        sel.setAttribute("class", "selection");
        sel.setAttribute("x", coords.x - selPad);
        sel.setAttribute("y", coords.y - selPad);
        sel.setAttribute("width", coords.width + selPad * 2);
        sel.setAttribute("height", coords.height + selPad * 2);
        sel.setAttribute("rx", "0.02");
        g.appendChild(sel);
      }
    } else {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", o.x);
      rect.setAttribute("y", o.y);
      rect.setAttribute("width", o.width);
      rect.setAttribute("height", o.height);
      rect.setAttribute("rx", rx);
      rect.setAttribute("fill", fill);
      rect.setAttribute("stroke", stroke);
      rect.setAttribute("stroke-width", kind === "fixed" ? 0 : 0.04);
      if (kind === "exhibitor") rect.setAttribute("filter", "url(#shadow)");
      g.appendChild(rect);

      if (kind === "fixed" && o.type === "stairs") {
        const orient = o.orientation || (o.height >= o.width ? "up" : "right");
        const isVert = orient === "up" || orient === "down";
        const numSteps = Math.max(3, Math.floor((isVert ? o.height : o.width) / 0.35));
        
        for (let i = 1; i < numSteps; i++) {
          const stepLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          if (isVert) {
            const stepH = o.height / numSteps;
            stepLine.setAttribute("x1", o.x);
            stepLine.setAttribute("y1", o.y + i * stepH);
            stepLine.setAttribute("x2", o.x + o.width);
            stepLine.setAttribute("y2", o.y + i * stepH);
          } else {
            const stepW = o.width / numSteps;
            stepLine.setAttribute("x1", o.x + i * stepW);
            stepLine.setAttribute("y1", o.y);
            stepLine.setAttribute("x2", o.x + i * stepW);
            stepLine.setAttribute("y2", o.y + o.height);
          }
          stepLine.setAttribute("stroke", "rgba(0,0,0,0.22)");
          stepLine.setAttribute("stroke-width", "0.03");
          g.appendChild(stepLine);
        }

        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const midX = o.x + o.width / 2;
        const midY = o.y + o.height / 2;
        let pathStr = "";

        if (orient === "up") {
          pathStr = `M ${midX} ${o.y + o.height * 0.82} L ${midX} ${o.y + o.height * 0.18} M ${midX - 0.18} ${o.y + o.height * 0.32} L ${midX} ${o.y + o.height * 0.18} L ${midX + 0.18} ${o.y + o.height * 0.32}`;
        } else if (orient === "down") {
          pathStr = `M ${midX} ${o.y + o.height * 0.18} L ${midX} ${o.y + o.height * 0.82} M ${midX - 0.18} ${o.y + o.height * 0.68} L ${midX} ${o.y + o.height * 0.82} L ${midX + 0.18} ${o.y + o.height * 0.68}`;
        } else if (orient === "right") {
          pathStr = `M ${o.x + o.width * 0.18} ${midY} L ${o.x + o.width * 0.82} ${midY} M ${o.x + o.width * 0.68} ${midY - 0.18} L ${o.x + o.width * 0.82} ${midY} L ${o.x + o.width * 0.68} ${midY + 0.18}`;
        } else if (orient === "left") {
          pathStr = `M ${o.x + o.width * 0.82} ${midY} L ${o.x + o.width * 0.18} ${midY} M ${o.x + o.width * 0.32} ${midY - 0.18} L ${o.x + o.width * 0.18} ${midY} L ${o.x + o.width * 0.32} ${midY + 0.18}`;
        }

        arrow.setAttribute("d", pathStr);
        arrow.setAttribute("stroke", "rgba(0,0,0,0.38)");
        arrow.setAttribute("stroke-width", "0.04");
        arrow.setAttribute("fill", "none");
        arrow.setAttribute("stroke-linecap", "round");
        arrow.setAttribute("stroke-linejoin", "round");
        g.appendChild(arrow);
      }

      if (isSelected) {
        const selPad = 0.03;
        const sel = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        sel.setAttribute("class", "selection");
        sel.setAttribute("x", o.x - selPad);
        sel.setAttribute("y", o.y - selPad);
        sel.setAttribute("width", o.width + (selPad * 2));
        sel.setAttribute("height", o.height + (selPad * 2));
        sel.setAttribute("rx", Math.max(0, rx + 0.01));
        g.appendChild(sel);

        const hSize = 0.16;
        const h = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        h.setAttribute("class", "handle");
        h.setAttribute("x", o.x + o.width - hSize / 2);
        h.setAttribute("y", o.y + o.height - hSize / 2);
        h.setAttribute("width", hSize);
        h.setAttribute("height", hSize);
        h.setAttribute("rx", 0.03);
        h.dataset.resize = "1";
        g.appendChild(h);
      }
    }

    g.addEventListener("pointerenter", () => {
      hovered = { kind, id: o.id };
      updateLabelsVisibility();
    });
    g.addEventListener("pointerleave", () => {
      hovered = null;
      updateLabelsVisibility();
    });

    g.addEventListener("pointerdown", e => onPointerDown(e, kind, o.id, parent));
    objectsEl.appendChild(g);

    if (label) {
      let cx, cy;
      if (kind === "opening") {
        const c = getOpeningCoords(o);
        cx = c.x + c.width / 2;
        cy = c.y + c.height / 2;
      } else {
        let absX = o.x;
        let absY = o.y;
        if (kind === "table" && parent) {
          absX += parent.x;
          absY += parent.y;
        }
        cx = absX + o.width / 2;
        cy = absY + o.height / 2;
      }

      const textGroup = createLabelOverlay(o, kind, cx, cy, label);
      if (textGroup) labelsLayer.appendChild(textGroup);
    }
  };

  project.fixedElements.forEach(o => draw(o, "fixed"));
  project.exhibitors.forEach(e => {
    draw(e, "exhibitor");
    e.tables.forEach(t => draw(t, "table", e));
  });
  project.openings.forEach(op => draw(op, "opening"));

  updateLabelsVisibility();

  $("#spaceTitle").textContent = project.space.name || "Senza Nome";
  $("#spaceSize").textContent = `${project.space.width} × ${project.space.height} m`;
  const totalCount = project.fixedElements.length + project.exhibitors.length + project.openings.length + project.exhibitors.reduce((n, e) => n + e.tables.length, 0);
  $("#objectCount").textContent = `${totalCount} elementi`;

  updateStats();
  updateMoveButton();
}

function createLabelOverlay(o, kind, cx, cy, label) {
  const textGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  textGroup.setAttribute("class", "obj-text-group");
  textGroup.dataset.kind = kind;
  textGroup.dataset.id = o.id;

  const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
  
  textEl.setAttribute("x", cx);
  textEl.setAttribute("y", cy);
  textEl.setAttribute("text-anchor", "middle");
  textEl.setAttribute("dominant-baseline", "central");

  let fontSizeClass = "fixed-label";
  let charWidth = 0.20;
  let bgHeight = 0.48;

  if (kind === "exhibitor") {
    fontSizeClass = "exhibitor-label";
    charWidth = 0.24;
    bgHeight = 0.58;
  } else if (kind === "table") {
    fontSizeClass = "table-label";
    charWidth = 0.21;
    bgHeight = 0.50;
  } else if (kind === "opening") {
    fontSizeClass = "fixed-label";
    charWidth = 0.20;
    bgHeight = 0.44;
  }

  textEl.setAttribute("class", fontSizeClass);
  textEl.textContent = label;

  const padX = 0.35;
  const baseWidth = (kind === "opening") ? 1.0 : (o.width || 1);
  const approxWidth = Math.max(baseWidth * 0.7, label.length * charWidth + padX);

  labelBg.setAttribute("class", "label-bg");
  labelBg.setAttribute("x", cx - approxWidth / 2);
  labelBg.setAttribute("y", cy - bgHeight / 2);
  labelBg.setAttribute("width", approxWidth);
  labelBg.setAttribute("height", bgHeight);
  labelBg.setAttribute("rx", 0.12);

  textGroup.appendChild(labelBg);
  textGroup.appendChild(textEl);
  return textGroup;
}

function updateLabelsVisibility() {
  const groups = labelsLayer.querySelectorAll(".obj-text-group");
  groups.forEach(g => {
    const k = g.dataset.kind;
    const id = g.dataset.id;
    const isSel = selected && selected.kind === k && selected.id === id;
    const isHov = hovered && hovered.kind === k && hovered.id === id;

    let isFixedVisible = false;
    if (labelMode === "all") {
      isFixedVisible = true;
    } else if (labelMode === "merchants" && k === "table") {
      isFixedVisible = true;
    }

    if (isFixedVisible || isSel || isHov) {
      g.classList.add("visible");
    } else {
      g.classList.remove("visible");
    }
  });
}

function onPointerDown(e, kind, id, parent) {
  e.stopPropagation();
  const isResize = e.target.dataset.resize === "1";
  const o = getObj(kind, id);
  const wasSelected = !!selected && selected.kind === kind && selected.id === id;
  if (!wasSelected) moveMode = false;   // cambio selezione => modalità sposta spenta
  selected = { kind, id };
  showProps();
  render();

  // Un click seleziona soltanto. Il trascinamento parte solo se l'elemento era già
  // selezionato e il pulsante "Sposta" è attivo. La maniglia di ridimensionamento
  // (visibile solo da selezionato) continua a funzionare.
  if (!isResize && !(wasSelected && moveMode)) return;

  const p = roomPoint(e);
  if (kind === "opening") {
    drag = { kind, id, mode: "move", start: p, baseOffset: o.offset };
  } else {
    const baseX = o.x, baseY = o.y, baseW = o.width, baseH = o.height;
    drag = { kind, id, parent, mode: isResize ? "resize" : "move", start: p, baseX, baseY, baseW, baseH };
  }
  
  try {
    if (e.pointerId !== undefined && stage.setPointerCapture) {
      stage.setPointerCapture(e.pointerId);
    }
  } catch (err) {
    // Ignore pointer capture errors
  }
}

stage.addEventListener("pointermove", e => {
  if (isPanning) {
    offset.x = e.clientX - panStart.x;
    offset.y = e.clientY - panStart.y;
    updateTransform();
    return;
  }

  if (!drag) return;
  const o = getObj(drag.kind, drag.id), p = roomPoint(e);
  let dx = p.x - drag.start.x, dy = p.y - drag.start.y;

  if (drag.kind === "opening") {
    const maxLen = (o.wall === "top" || o.wall === "bottom") ? project.space.width : project.space.height;
    const delta = (o.wall === "top" || o.wall === "bottom") ? dx : dy;
    o.offset = Math.max(0, Math.min(maxLen - o.width, snap(drag.baseOffset + delta)));
  } else if (drag.mode === "move") {
    if (drag.kind === "table") {
      const parent = drag.parent;
      o.x = snap(Math.max(0, Math.min(parent.width - o.width, drag.baseX + dx)));
      o.y = snap(Math.max(0, Math.min(parent.height - o.height, drag.baseY + dy)));
    } else {
      o.x = snap(Math.max(0, Math.min(project.space.width - o.width, drag.baseX + dx)));
      o.y = snap(Math.max(0, Math.min(project.space.height - o.height, drag.baseY + dy)));
    }
  } else {
    o.width = Math.max(0.4, snap(drag.baseW + dx));
    o.height = Math.max(0.4, snap(drag.baseH + dy));
    if (drag.kind === "exhibitor") {
      o.width = Math.min(o.width, project.space.width - o.x);
      o.height = Math.min(o.height, project.space.height - o.y);
    }
    if (drag.kind === "table") {
      const parent = drag.parent;
      o.width = Math.min(o.width, parent.width - o.x);
      o.height = Math.min(o.height, parent.height - o.y);
    }
  }
  render();
  updatePropsValues();
});

stage.addEventListener("pointerup", e => {
  if (isPanning) {
    isPanning = false;
    canvasWrap.classList.remove("panning");
    try { if (e.pointerId !== undefined) stage.releasePointerCapture(e.pointerId); } catch (err) {}
    return;
  }

  if (drag) {
    drag = null;
    snapshot();
  }
  try {
    if (e.pointerId !== undefined && stage.hasPointerCapture && stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId);
    }
  } catch (err) {
    // Ignore release errors
  }
});

stage.addEventListener("pointerdown", e => {
  if (e.target === stage || e.target === roomEl || e.target === gridEl) {
    selected = null;
    showProps();
    render();

    isPanning = true;
    panStart = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    canvasWrap.classList.add("panning");
    try {
      if (e.pointerId !== undefined && stage.setPointerCapture) {
        stage.setPointerCapture(e.pointerId);
      }
    } catch (err) {}
  }
});

canvasWrap.addEventListener("wheel", e => {
  e.preventDefault();
  const r = canvasWrap.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  zoomAt(factor, cx, cy);
}, { passive: false });

function addElement(tool) {
  snapshot();
  if (!project.openings) project.openings = [];

  if (tool === "column") project.fixedElements.push({ id: uid("column"), type: "column", name: "Colonna", x: 2, y: 2, width: 0.6, height: 0.6, color: "#77736c" });
  if (tool === "wall") project.fixedElements.push({ id: uid("wall"), type: "wall", name: "Parete", x: 5, y: 5, width: 4.0, height: 0.2, color: "#3a3731" });
  if (tool === "furniture") project.fixedElements.push({ id: uid("furniture"), type: "furniture", name: "Mobile", x: 6, y: 1.5, width: 2.5, height: 0.8, color: "#9b968e" });
  if (tool === "stairs") project.fixedElements.push({ id: uid("stairs"), type: "stairs", name: "Scala", x: 8, y: 1.5, width: 2.0, height: 3.0, color: "#8a857b", orientation: "up" });
  if (tool === "exhibitor") project.exhibitors.push({ id: uid("exhibitor"), name: "Nuovo Espositore", color: "#dbeae7", x: 3, y: 3, width: 5, height: 4, tables: [] });
  if (tool === "door") project.openings.push({ id: uid("door"), type: "door", name: "Porta", wall: "bottom", offset: 2.0, width: 1.2, direction: "out" });
  if (tool === "window") project.openings.push({ id: uid("window"), type: "window", name: "Finestra", wall: "top", offset: 4.0, width: 1.5 });

  let kind = "fixed";
  let lastId = "";
  if (tool === "exhibitor") { kind = "exhibitor"; lastId = project.exhibitors.at(-1).id; }
  else if (tool === "door" || tool === "window") { kind = "opening"; lastId = project.openings.at(-1).id; }
  else { lastId = project.fixedElements.at(-1).id; }

  selected = { kind, id: lastId };
  render();
  showProps();
}
document.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => addElement(b.dataset.tool));

function field(label, value, key, type = "text") {
  return `<div class="field"><div class="field-label">${label}</div><input data-key="${key}" type="${type}" value="${esc(value)}" step="0.1"></div>`;
}

function updatePropsValues() {
  if (!selected) return;
  const o = getObj(selected.kind, selected.id);
  if (!o) return;
  const p = $("#properties");
  p.querySelectorAll("[data-key]").forEach(inp => {
    if (document.activeElement === inp) return;
    const key = inp.dataset.key;
    if (key in o && inp.value != o[key]) {
      inp.value = o[key];
    }
  });
}

function showProps() {
  const empty = $("#emptyProperties"), p = $("#properties");
  if (!selected) {
    empty.classList.remove("hidden");
    p.classList.add("hidden");
    return;
  }
  const o = getObj(selected.kind, selected.id);
  if (!o) return;

  empty.classList.add("hidden");
  p.classList.remove("hidden");

  let typeLabel = { fixed: o.type === "column" ? "Colonna" : (o.type === "stairs" ? "Scala" : (o.type === "wall" ? "Parete" : "Mobile")), exhibitor: "Espositore", table: "Tavolo" }[selected.kind];
  if (selected.kind === "opening") typeLabel = o.type === "door" ? "Porta" : "Finestra";

  let html = `<div class="prop-heading"><strong>${esc(o.name || o.merchant || "Elemento")}</strong><span class="tag">${typeLabel}</span></div>`;

  if (selected.kind === "table") {
    html += field("Commerciante", o.merchant, "merchant");
  } else {
    html += field("Nome", o.name, "name");
  }

  if (selected.kind === "opening") {
    html += `<div class="field"><div class="field-label">Parete Bordo</div>
      <select data-key="wall">
        <option value="top" ${o.wall === 'top' ? 'selected' : ''}>Superiore (Nord)</option>
        <option value="bottom" ${o.wall === 'bottom' ? 'selected' : ''}>Inferiore (Sud)</option>
        <option value="left" ${o.wall === 'left' ? 'selected' : ''}>Sinistra (Ovest)</option>
        <option value="right" ${o.wall === 'right' ? 'selected' : ''}>Destra (Est)</option>
      </select></div>`;
    if (o.type === "door") {
      html += `<div class="field"><div class="field-label">Apertura Porta</div>
        <select data-key="direction">
          <option value="out" ${(!o.direction || o.direction === 'out') ? 'selected' : ''}>Esterna (Verso l'esterno)</option>
          <option value="in" ${o.direction === 'in' ? 'selected' : ''}>Interna (Verso l'interno)</option>
          <option value="line" ${o.direction === 'line' ? 'selected' : ''}>Linea spessa (Sulla parete)</option>
        </select></div>`;
    }
    html += `<div class="field-row">${field("Posizione (m)", o.offset, "offset", "number")}${field("Larghezza (m)", o.width, "width", "number")}</div>`;
  } else {
    if (o.type === "stairs") {
      const currentOrient = o.orientation || (o.height >= o.width ? "up" : "right");
      html += `<div class="field"><div class="field-label">Orientamento & Direzione</div>
        <select data-key="orientation">
          <option value="up" ${currentOrient === 'up' ? 'selected' : ''}>Verticale ↑ (Basso -> Alto)</option>
          <option value="down" ${currentOrient === 'down' ? 'selected' : ''}>Verticale ↓ (Alto -> Basso)</option>
          <option value="right" ${currentOrient === 'right' ? 'selected' : ''}>Orizzontale → (Sinistra -> Destra)</option>
          <option value="left" ${currentOrient === 'left' ? 'selected' : ''}>Orizzontale ← (Destra -> Sinistra)</option>
        </select></div>`;
    }

    html += `<div class="field-row">${field("X (m)", o.x, "x", "number")}${field("Y (m)", o.y, "y", "number")}</div>`;
    html += `<div class="field-row">${field("Larghezza (m)", o.width, "width", "number")}${field("Altezza (m)", o.height, "height", "number")}</div>`;
    
    html += `<button class="btn ghost" id="swapDimsBtn" style="width:100%;margin-bottom:10px;">⇄ Inverti L × A (Ruota 90°)</button>`;

    let defaultColor = "#dbeae7";
    if (selected.kind === "table") defaultColor = "#ffffff";
    if (selected.kind === "fixed") defaultColor = o.type === "column" ? "#77736c" : (o.type === "stairs" ? "#8a857b" : (o.type === "wall" ? "#3a3731" : "#9b968e"));
    const currentColor = o.color || defaultColor;

    html += `<div class="field"><div class="field-label">Colore Elemento</div><div class="color-row"><input data-key="color" type="color" value="${currentColor}"><span style="font-size:10px;color:#888">${currentColor}</span></div></div>`;

    if (selected.kind === "exhibitor") {
      html += `<div class="field"><div class="field-label">Tavoli</div><div style="font-size:11px;color:#666">${o.tables.length} tavoli · ${o.tables.reduce((s,t)=>s+t.width*t.height,0).toFixed(2)} m²</div></div>`;
      html += `<button class="btn primary" id="addTableBtn" style="width:100%;margin-top:4px;">+ Aggiungi tavolo</button>`;
    }
  }

  html += `<button class="danger" id="deleteBtn">Elimina elemento</button>`;
  p.innerHTML = html;

  p.querySelectorAll("[data-key]").forEach(inp => {
    inp.oninput = () => {
      const key = inp.dataset.key;
      let v = inp.type === "number" ? (parseFloat(inp.value) || 0) : inp.value;
      
      if (key === "orientation" && o.type === "stairs") {
        const isOldVert = o.orientation === "up" || o.orientation === "down";
        const isNewVert = v === "up" || v === "down";
        if (isOldVert !== isNewVert) {
          const temp = o.width;
          o.width = o.height;
          o.height = temp;
          const wInp = p.querySelector('[data-key="width"]');
          const hInp = p.querySelector('[data-key="height"]');
          if (wInp) wInp.value = o.width;
          if (hInp) hInp.value = o.height;
        }
      }
      
      o[key] = v;
      if (selected.kind === "opening") clampOpenings();
      render();

      const heading = p.querySelector(".prop-heading strong");
      if (heading && (key === "name" || key === "merchant")) {
        heading.textContent = v || "Elemento";
      }
      markDirty();
    };
  });

  const swapDimsBtn = $("#swapDimsBtn");
  if (swapDimsBtn) {
    swapDimsBtn.onclick = () => {
      snapshot();
      const temp = o.width;
      o.width = o.height;
      o.height = temp;
      if (o.type === "stairs" && o.orientation) {
        if (o.orientation === "up") o.orientation = "right";
        else if (o.orientation === "down") o.orientation = "left";
        else if (o.orientation === "right") o.orientation = "up";
        else if (o.orientation === "left") o.orientation = "down";
      }
      render();
      showProps();
    };
  }

  const deleteBtn = $("#deleteBtn");
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      snapshot();
      deleteSelected();
    };
  }

  const addTableBtn = $("#addTableBtn");
  if (addTableBtn) {
    addTableBtn.onclick = () => {
      snapshot();
      const e = getObj("exhibitor", selected.id);
      if (e) {
        const newT = { id: uid("table"), merchant: "Nuovo commerciante", x: 0.4, y: 0.4, width: 1.8, height: 1.2 };
        e.tables.push(newT);
        selected = { kind: "table", id: newT.id };
        render();
        showProps();
      }
    };
  }
}

function deleteSelected() {
  if (!selected) return;
  if (selected.kind === "fixed") project.fixedElements = project.fixedElements.filter(x => x.id !== selected.id);
  if (selected.kind === "exhibitor") project.exhibitors = project.exhibitors.filter(x => x.id !== selected.id);
  if (selected.kind === "opening") project.openings = project.openings.filter(x => x.id !== selected.id);
  if (selected.kind === "table") {
    const p = getParentExhibitor(selected.id);
    if (p) p.tables = p.tables.filter(x => x.id !== selected.id);
  }
  selected = null;
  render();
  showProps();
  toast("Elemento eliminato");
}

$("#gridBtn").onclick = () => {
  gridOn = !gridOn;
  $("#gridState").textContent = gridOn ? "ON" : "OFF";
  render();
};

$("#labelToggleBtn").onclick = () => {
  if (labelMode === "hover") {
    labelMode = "merchants";
    $("#labelState").textContent = "SOLO COMM.";
  } else if (labelMode === "merchants") {
    labelMode = "all";
    $("#labelState").textContent = "TUTTI";
  } else {
    labelMode = "hover";
    $("#labelState").textContent = "HOVER";
  }
  updateLabelsVisibility();
};

$("#fitBtn").onclick = fitView;
$("#zoomInBtn").onclick = () => {
  const cw = canvasWrap.clientWidth, ch = canvasWrap.clientHeight;
  zoomAt(1.25, cw / 2, ch / 2);
};
$("#zoomOutBtn").onclick = () => {
  const cw = canvasWrap.clientWidth, ch = canvasWrap.clientHeight;
  zoomAt(1 / 1.25, cw / 2, ch / 2);
};

$("#undoBtn").onclick = () => {
  if (!history.length) return;
  future.push(JSON.stringify(project));
  restore(history.pop());
};

$("#redoBtn").onclick = () => {
  if (!future.length) return;
  history.push(JSON.stringify(project));
  restore(future.pop());
};

function downloadJSON() {
  try {
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const a = document.createElement("a");
    const filename = (project.space.name || "planimetria")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "") + ".json";

    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    markSaved();
    toast("JSON scaricato con successo");
  } catch (err) {
    toast("Errore nel salvataggio JSON");
    console.error(err);
  }
}

$("#saveBtn").onclick = downloadJSON;

$("#openBtn").onclick = () => {
  const fileInput = $("#fileInput");
  fileInput.value = "";
  fileInput.click();
};

$("#fileInput").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;

  const r = new FileReader();
  r.onload = () => {
    try {
      const parsed = JSON.parse(r.result);
      snapshot();
      validateAndApplyProject(parsed);
      history = [];
      future = [];
      selected = null;
      markSaved();
      toast("Progetto caricato da JSON");
    } catch (err) {
      toast("File JSON non valido o corrotto");
      console.error(err);
    }
  };
  r.onerror = () => toast("Errore di lettura file");
  r.readAsText(f);
};

const canvasWrapEl = $("#canvasWrap");
if (canvasWrapEl) {
  canvasWrapEl.addEventListener("dragover", e => {
    e.preventDefault();
    e.stopPropagation();
  });

  canvasWrapEl.addEventListener("drop", e => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/json" || file.name.endsWith(".json")) {
        const reader = new FileReader();
        reader.onload = event => {
          try {
            const parsed = JSON.parse(event.target.result);
            snapshot();
            validateAndApplyProject(parsed);
            history = [];
            future = [];
            selected = null;
            markSaved();
            toast("Planimetria caricata via Drag & Drop!");
          } catch (err) {
            toast("Errore: JSON non valido");
          }
        };
        reader.readAsText(file);
      } else {
        toast("Trascina un file con estensione .json");
      }
    }
  });
}

$("#newBtn").onclick = () => {
  project = { version: 1, space: { name: "Nuovo padiglione", width: 20, height: 12 }, fixedElements: [], exhibitors: [], openings: [] };
  history = [];
  future = [];
  selected = null;
  syncRoomInputs();
  render();
  fitView();
  showProps();
  markSaved();
  toast("Nuova planimetria creata");
};

window.addEventListener("resize", fitView);
window.addEventListener("keydown", e => {
  if ((e.key === "Delete" || e.key === "Backspace") && selected && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    snapshot();
    deleteSelected();
  }
  if (e.key === "Escape") {
    selected = null;
    render();
    showProps();
  }
  if ((e.key === "m" || e.key === "M") && selected && !e.ctrlKey && !e.metaKey &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    $("#moveBtn").click();
  }
});

/* ================= Pulsante SPOSTA ================= */
function updateMoveButton() {
  const btn = $("#moveBtn");
  if (!btn) return;
  if (!selected) moveMode = false;
  btn.classList.toggle("hidden", !selected);
  btn.classList.toggle("active", moveMode);
  btn.textContent = moveMode ? "✥ Sposta: attivo" : "✥ Sposta";
  stage.classList.toggle("move-mode", moveMode);
}
$("#moveBtn").onclick = () => {
  if (!selected) return;
  moveMode = !moveMode;
  updateMoveButton();
  toast(moveMode ? "Trascina l'elemento per spostarlo" : "Spostamento disattivato");
};

/* ================= Esporta PDF (A4) ================= */
const fmtM = n => Number(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const metersOf = o => Math.max(o.width || 0, o.height || 0);

function svgText(text, x, y, size, weight, baseline) {
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="${baseline}"
    font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}"
    fill="#1d1b18" stroke="#fff" stroke-width="${size * 0.2}" paint-order="stroke"
    stroke-linejoin="round">${esc(text)}</text>`;
}

// Nome con sfondo "pillola" centrato in (cx, cy)
function svgPill(text, cx, cy, size) {
  const label = String(text);
  const w = label.length * size * 0.58 + size * 1.1;   // larghezza stimata + padding
  const h = size * 1.7;
  return `<g>
    <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h * 0.28}"
      fill="#ffffff" fill-opacity="0.94" stroke="#1f5d55" stroke-width="${size * 0.05}"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="600"
      fill="#25231f">${esc(label)}</text>
  </g>`;
}

function buildPlanSvg(boxW, boxH) {
  const W = project.space.width, H = project.space.height;

  // Scala stimata (mm per metro) per avere testi di dimensione costante sulla carta
  const s0 = Math.min(boxW / W, boxH / H);
  const fsExh = 3.6 / s0;      // ≈ 10 pt: nome spazio espositivo
  const fsMer = 2.8 / s0;      // ≈ 8 pt: nome commerciante
  const pad = 0.3, padTop = fsExh * 1.5 + 0.2;

  const clone = objectsEl.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll(".selection, .handle").forEach(n => n.remove());
  clone.querySelectorAll("[filter]").forEach(n => n.removeAttribute("filter"));
  clone.querySelectorAll(".selected").forEach(n => n.classList.remove("selected"));

  let labels = "";
  project.exhibitors.forEach(e => {
    // Nome dello spazio: subito sopra il bordo superiore
    labels += svgText(e.name || "Spazio", e.x + e.width / 2, e.y - fsExh * 0.3, fsExh, 700, "auto");
    // Nomi dei commercianti: centrati sul tavolo, possono uscire dal riquadro
    (e.tables || []).forEach(t => {
      labels += svgPill(t.merchant || "Tavolo", e.x + t.x + t.width / 2, e.y + t.y + t.height / 2, fsMer);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="${-pad} ${-padTop} ${W + 2 * pad} ${H + padTop + pad}"
      preserveAspectRatio="xMidYMid meet" style="width:${boxW}mm;height:${boxH}mm;overflow:visible">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#292722" stroke-width="0.12"/>
    ${clone.outerHTML}
    ${labels}
  </svg>`;
}

function buildListHtml() {
  let rows = "", total = 0, count = 0;
  project.exhibitors.forEach(e => {
    const tabs = e.tables || [];
    const sub = tabs.reduce((s, t) => s + metersOf(t), 0);
    total += sub; count += tabs.length;
    rows += `<tr class="grp"><td>${esc(e.name || "Spazio")}</td><td>${fmtM(e.width)} × ${fmtM(e.height)} m</td><td></td></tr>`;
    if (!tabs.length) rows += `<tr class="empty"><td colspan="3">Nessun commerciante assegnato</td></tr>`;
    tabs.forEach(t => {
      rows += `<tr><td class="ind">${esc(t.merchant || "Tavolo")}</td><td>${fmtM(t.width)} × ${fmtM(t.height)} m</td><td class="num">${fmtM(metersOf(t))} m</td></tr>`;
    });
    if (tabs.length) rows += `<tr class="sub"><td colspan="2">Subtotale ${esc(e.name || "")} (spazio ${fmtM(metersOf(e))} m)</td><td class="num">${fmtM(sub)} m</td></tr>`;
  });
  rows += `<tr class="total"><td colspan="2">Totale metri espositivi (${count} ${count === 1 ? "commerciante" : "commercianti"})</td><td class="num">${fmtM(total)} m</td></tr>`;

  // Tabella contenitore: thead/tfoot vuoti si ripetono su ogni pagina e creano i margini
  return `<table class="pgwrap">
    <thead><tr><td><div style="height:12mm"></div></td></tr></thead>
    <tfoot><tr><td><div style="height:16mm"></div></td></tr></tfoot>
    <tbody><tr><td><div class="print-list">
      <h2>Elenco espositori — ${esc(project.space.name || "Planimetria")}</h2>
      <table class="data"><thead><tr><th>Espositore</th><th>Dimensioni</th><th class="num">Metri</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div></td></tr></tbody>
  </table>`;
}

function exportPDF() {
  const W = project.space.width, H = project.space.height;
  const M = 10, HEAD = 12, FOOT = 8;                         // mm
  const dims = { land: { pw: 297, ph: 210 }, port: { pw: 210, ph: 297 } };
  const scaleOf = d => Math.min((d.pw - 2 * M) / W, (d.ph - 2 * M - HEAD - FOOT) / H);
  const landscape = scaleOf(dims.land) >= scaleOf(dims.port);
  const { pw, ph } = landscape ? dims.land : dims.port;
  const boxW = pw - 2 * M, boxH = ph - 2 * M - HEAD - FOOT;

  let st = $("#printPageStyle");
  if (!st) { st = document.createElement("style"); st.id = "printPageStyle"; document.head.appendChild(st); }
  st.textContent = `@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 0; }`;

  $("#printRoot").innerHTML = `
    <div class="print-page plan print-plan" style="width:${pw}mm;height:${ph - 0.6}mm;padding:${M}mm">
      <div class="print-head"><h1>${esc(project.space.name || "Planimetria")}</h1>
        <span>${fmtM(W)} × ${fmtM(H)} m</span></div>
      ${buildPlanSvg(boxW, boxH)}
    </div>
    ${buildListHtml()}
    <div class="print-foot">© 2026 Pino Inside</div>`;

  setTimeout(() => window.print(), 60);   // nel dialogo scegli "Salva come PDF"
}
window.addEventListener("afterprint", () => { $("#printRoot").innerHTML = ""; });
$("#pdfBtn").onclick = exportPDF;

initRoomControls();
if (!loadFromLocalStorage()) {
  syncRoomInputs();
  render();
  fitView();
  showProps();
}