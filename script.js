// ──────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const draft = document.getElementById('draftCanvas');
const draftCtx = draft.getContext('2d');

ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);

const PALETTE = [
  '#000000','#434343','#666666','#999999','#b7b7b7',
  '#ffffff','#ff0000','#ff9900','#ffff00','#00ff00',
  '#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff',
  '#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9',
  '#9fc5e8','#b4a7d6','#d5a6bd','#cc4125','#e06666',
];

// ──────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────
const state = {
  tool: 'brush',
  color: '#000000',
  size: 4,
  opacity: 1,
  drawing: false,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,

  // undo/redo
  history: [],
  historyIndex: -1,
  MAX_HISTORY: 50,

  // selection
  selectionRect: null,
  selectedCanvas: null,
  isMovingSelection: false,
  selOffX: 0, selOffY: 0,
  transformAngle: 0,
  transformScale: 1,

  // zoom
  zoom: 1,

  // text tool
  pendingTextPos: null,
};

// ──────────────────────────────────────────────────
// HISTORY (UNDO/REDO)
// ──────────────────────────────────────────────────
function saveHistory() {
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  state.history.push(canvas.toDataURL());
  if (state.history.length > state.MAX_HISTORY) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  updateHistoryUI();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreHistory();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreHistory();
}

function restoreHistory() {
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = state.history[state.historyIndex];
  updateHistoryUI();
}

function updateHistoryUI() {
  const undoBtn = document.getElementById('btnUndo');
  const redoBtn = document.getElementById('btnRedo');
  undoBtn.disabled = state.historyIndex <= 0;
  redoBtn.disabled = state.historyIndex >= state.history.length - 1;
  document.getElementById('statusUndo').textContent = state.historyIndex;
}

saveHistory(); // initial state

// ──────────────────────────────────────────────────
// PALETTE
// ──────────────────────────────────────────────────
const paletteBox = document.getElementById('paletteBox');
PALETTE.forEach((c, i) => {
  const sw = document.createElement('div');
  sw.className = 'swatch' + (i === 0 ? ' active' : '');
  sw.style.background = c;
  sw.title = c;
  sw.addEventListener('click', () => setColor(c, sw));
  paletteBox.appendChild(sw);
});

function setColor(hex, swEl) {
  state.color = hex;
  document.getElementById('fgBlock').style.background = hex;
  document.getElementById('hexInput').value = hex;
  document.getElementById('fgPicker').value = hex;
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  if (swEl) swEl.classList.add('active');
}

document.getElementById('fgPicker').addEventListener('input', e => setColor(e.target.value, null));
document.getElementById('hexInput').addEventListener('change', e => {
  const v = e.target.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v, null);
});
document.getElementById('fgBlock').addEventListener('click', () => document.getElementById('fgPicker').click());

// ──────────────────────────────────────────────────
// TOOLS
// ──────────────────────────────────────────────────
const TOOL_NAMES = {
  brush:'Brush', pencil:'Pencil', eraser:'Eraser', fill:'Fill',
  line:'Line', rect:'Rectangle', rectfill:'Filled Rect',
  circle:'Circle', circlefill:'Filled Circle', ellipse:'Ellipse',
  triangle:'Triangle', text:'Text', eyedrop:'Eyedropper',
  select:'Select', move:'Move'
};

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    applySelection();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    document.getElementById('statusTool').textContent = TOOL_NAMES[state.tool] || state.tool;
    draft.style.cursor = state.tool === 'eyedrop' ? 'crosshair' : 'crosshair';
    const hint = document.getElementById('transformHint');
    hint.classList.toggle('show', state.tool === 'select');
  });
});

// ──────────────────────────────────────────────────
// BRUSH SIZE & OPACITY
// ──────────────────────────────────────────────────
document.getElementById('brushSize').addEventListener('input', e => {
  state.size = +e.target.value;
  document.getElementById('sizeVal').textContent = state.size + 'px';
});
document.getElementById('opacitySlider').addEventListener('input', e => {
  state.opacity = e.target.value / 100;
  document.getElementById('opacityVal').textContent = e.target.value + '%';
});

// ──────────────────────────────────────────────────
// DRAWING ALGORITHMS
// ──────────────────────────────────────────────────
function putPixel(c, x, y, color, size) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, size / 2, 0, Math.PI * 2);
  c.fill();
}

function bresenham(c, x1, y1, x2, y2, color, size) {
  let dx = Math.abs(x2-x1), dy = Math.abs(y2-y1);
  let sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    putPixel(c, x1, y1, color, size);
    if (x1 === x2 && y1 === y2) break;
    let e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x1 += sx; }
    if (e2 < dx) { err += dx; y1 += sy; }
  }
}

function midpointCircle(c, xc, yc, r, color, size) {
  if (r <= 0) return;
  let x = 0, y = r, d = 1 - r;
  const sym = (px, py) => {
    putPixel(c, xc+px, yc+py, color, size); putPixel(c, xc-px, yc+py, color, size);
    putPixel(c, xc+px, yc-py, color, size); putPixel(c, xc-px, yc-py, color, size);
    putPixel(c, xc+py, yc+px, color, size); putPixel(c, xc-py, yc+px, color, size);
    putPixel(c, xc+py, yc-px, color, size); putPixel(c, xc-py, yc-px, color, size);
  };
  sym(x, y);
  while (x < y) {
    if (d < 0) d += 2*x+3; else { d += 2*(x-y)+5; y--; }
    x++; sym(x, y);
  }
}

function midpointCircleFill(c, xc, yc, r, color) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(xc, yc, r, 0, Math.PI * 2);
  c.fill();
}

function midpointEllipse(c, xc, yc, rx, ry, color, size) {
  if (!rx || !ry) return;
  let x = 0, y = ry;
  let d1 = ry*ry - rx*rx*ry + 0.25*rx*rx;
  let dx = 2*ry*ry*x, dy = 2*rx*rx*y;
  const sym = (px, py) => {
    putPixel(c, xc+px, yc+py, color, size); putPixel(c, xc-px, yc+py, color, size);
    putPixel(c, xc+px, yc-py, color, size); putPixel(c, xc-px, yc-py, color, size);
  };
  while (dx < dy) {
    sym(x, y);
    if (d1 < 0) { x++; dx += 2*ry*ry; d1 += dx + ry*ry; }
    else { x++; y--; dx += 2*ry*ry; dy -= 2*rx*rx; d1 += dx - dy + ry*ry; }
  }
  let d2 = ry*ry*(x+.5)*(x+.5) + rx*rx*(y-1)*(y-1) - rx*rx*ry*ry;
  while (y >= 0) {
    sym(x, y);
    if (d2 > 0) { y--; dy -= 2*rx*rx; d2 += rx*rx - dy; }
    else { y--; x++; dx += 2*ry*ry; dy -= 2*rx*rx; d2 += dx - dy + rx*rx; }
  }
}

function drawRect(c, color, size, x, y, w, h) {
  bresenham(c, x, y, x+w, y, color, size);
  bresenham(c, x+w, y, x+w, y+h, color, size);
  bresenham(c, x+w, y+h, x, y+h, color, size);
  bresenham(c, x, y+h, x, y, color, size);
}

function drawRectFill(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function drawTriangle(c, color, size, x1, y1, x2, y2) {
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const dx = x2-x1, dy = y2-y1;
  const h = Math.sqrt(dx*dx+dy*dy) * 0.866; 
  const nx = -dy/Math.sqrt(dx*dx+dy*dy), ny = dx/Math.sqrt(dx*dx+dy*dy);
  const ax = mx + nx*h, ay = my + ny*h;
  bresenham(c, x1, y1, Math.round(x2), Math.round(y2), color, size);
  bresenham(c, Math.round(x2), Math.round(y2), Math.round(ax), Math.round(ay), color, size);
  bresenham(c, Math.round(ax), Math.round(ay), x1, y1, color, size);
}

// ──────────────────────────────────────────────────
// FLOOD FILL
// ──────────────────────────────────────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

function floodFill(sx, sy, fillHex) {
  if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) return;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data, w = canvas.width, h = canvas.height;
  const idx = (sy * w + sx) * 4;
  const tR = d[idx], tG = d[idx+1], tB = d[idx+2], tA = d[idx+3];
  const [fR, fG, fB] = hexToRgb(fillHex);

  if (tR === fR && tG === fG && tB === fB && tA === 255) return;

  const match = pos => d[pos]===tR && d[pos+1]===tG && d[pos+2]===tB && d[pos+3]===tA;
  const paint = pos => { d[pos]=fR; d[pos+1]=fG; d[pos+2]=fB; d[pos+3]=255; };

  const stack = [[sx, sy]];
  while (stack.length) {
    let [x, y] = stack.pop();
    let pos = (y * w + x) * 4;
    while (y-- >= 0 && match(pos)) pos -= w*4;
    pos += w*4; y++;
    let reachL = false, reachR = false;
    while (y++ < h-1 && match(pos)) {
      paint(pos);
      if (x > 0) {
        if (match(pos-4)) { if (!reachL) { stack.push([x-1, y]); reachL = true; } }
        else reachL = false;
      }
      if (x < w-1) {
        if (match(pos+4)) { if (!reachR) { stack.push([x+1, y]); reachR = true; } }
        else reachR = false;
      }
      pos += w*4;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ──────────────────────────────────────────────────
// GRAYSCALE / INVERT / FLIP
// ──────────────────────────────────────────────────
function applyGrayscale() {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = 0.299*img.data[i] + 0.587*img.data[i+1] + 0.114*img.data[i+2];
    img.data[i] = img.data[i+1] = img.data[i+2] = g;
  }
  ctx.putImageData(img, 0, 0);
  saveHistory();
}

function applyInvert() {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255-img.data[i];
    img.data[i+1] = 255-img.data[i+1];
    img.data[i+2] = 255-img.data[i+2];
  }
  ctx.putImageData(img, 0, 0);
  saveHistory();
}

function applyFlipH() {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  const tc = tmp.getContext('2d');
  tc.translate(canvas.width, 0); tc.scale(-1, 1);
  tc.drawImage(canvas, 0, 0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(tmp, 0, 0);
  saveHistory();
}

function applyFlipV() {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  const tc = tmp.getContext('2d');
  tc.translate(0, canvas.height); tc.scale(1, -1);
  tc.drawImage(canvas, 0, 0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(tmp, 0, 0);
  saveHistory();
}

// ──────────────────────────────────────────────────
// SELECTION
// ──────────────────────────────────────────────────
function normalizeRect(x1,y1,x2,y2) {
  return {
    x: Math.max(0,Math.min(x1,x2)),
    y: Math.max(0,Math.min(y1,y2)),
    w: Math.abs(x2-x1),
    h: Math.abs(y2-y1)
  };
}

function applySelection() {
  if (!state.selectedCanvas || !state.selectionRect) return;
  const r = state.selectionRect;
  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(r.x + r.w/2, r.y + r.h/2);
  ctx.rotate(state.transformAngle * Math.PI/180);
  ctx.scale(state.transformScale, state.transformScale);
  ctx.drawImage(state.selectedCanvas, -r.w/2, -r.h/2);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  state.selectedCanvas = null;
  state.selectionRect = null;
  state.transformAngle = 0;
  state.transformScale = 1;
  renderDraft();
  saveHistory();
}

function selectAll() {
  applySelection();
  state.selectionRect = { x:0, y:0, w:canvas.width, h:canvas.height };
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= 240 && d[i+1] >= 240 && d[i+2] >= 240) d[i+3] = 0;
  }
  tmp.getContext('2d').putImageData(imgData, 0, 0);
  state.selectedCanvas = tmp;
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const sd = srcData.data;
  for (let i = 0; i < sd.length; i += 4) {
    if (!(sd[i] >= 240 && sd[i+1] >= 240 && sd[i+2] >= 240)) {
      sd[i] = 255; sd[i+1] = 255; sd[i+2] = 255; sd[i+3] = 255;
    }
  }
  ctx.putImageData(srcData, 0, 0);
  renderDraft();
}

function deleteSelection() {
  if (!state.selectionRect) return;
  state.selectedCanvas = null;
  state.selectionRect = null;
  state.transformAngle = 0;
  state.transformScale = 1;
  renderDraft();
  saveHistory();
}

function renderDraft() {
  draftCtx.clearRect(0,0,draft.width,draft.height);
  if (state.tool === 'select' && state.selectionRect) {
    const r = state.selectionRect;
    if (state.selectedCanvas) {
      draftCtx.save();
      draftCtx.translate(r.x+r.w/2, r.y+r.h/2);
      draftCtx.rotate(state.transformAngle*Math.PI/180);
      draftCtx.scale(state.transformScale, state.transformScale);
      draftCtx.drawImage(state.selectedCanvas, -r.w/2, -r.h/2);
      draftCtx.restore();

      draftCtx.strokeStyle = '#e94560';
      draftCtx.lineWidth = 1.5;
      draftCtx.setLineDash([6,3]);
      const sw = r.w * state.transformScale;
      const sh = r.h * state.transformScale;
      draftCtx.strokeRect(r.x+r.w/2-sw/2, r.y+r.h/2-sh/2, sw, sh);
      draftCtx.setLineDash([]);
    } else {
      draftCtx.strokeStyle = '#e94560';
      draftCtx.lineWidth = 1.5;
      draftCtx.setLineDash([6,3]);
      draftCtx.strokeRect(r.x, r.y, r.w, r.h);
      draftCtx.setLineDash([]);
    }
  }
}

// ──────────────────────────────────────────────────
// MOUSE EVENTS
// ──────────────────────────────────────────────────
function getPos(e) {
  const rect = draft.getBoundingClientRect();
  const scaleX = draft.width / rect.width;
  const scaleY = draft.height / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * scaleX),
    y: Math.floor((e.clientY - rect.top) * scaleY)
  };
}

draft.addEventListener('mousedown', e => {
  const pos = getPos(e);

  if (state.tool === 'eyedrop') {
    const p = ctx.getImageData(pos.x, pos.y, 1, 1).data;
    const hex = '#' + [p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
    setColor(hex, null);
    return;
  }

  if (state.tool === 'fill') {
    saveHistory();
    floodFill(pos.x, pos.y, state.color);
    saveHistory();
    return;
  }

  if (state.tool === 'text') {
    state.pendingTextPos = pos;
    document.getElementById('textContent').value = '';
    document.getElementById('textModal').classList.add('show');
    setTimeout(() => document.getElementById('textContent').focus(), 50);
    return;
  }

  if (state.tool === 'select') {
    if (state.selectedCanvas && state.selectionRect) {
      const r = state.selectionRect;
      const sw = r.w * state.transformScale, sh = r.h * state.transformScale;
      const bx = r.x+r.w/2-sw/2, by = r.y+r.h/2-sh/2;
      if (pos.x >= bx && pos.x <= bx+sw && pos.y >= by && pos.y <= by+sh) {
        state.isMovingSelection = true;
        state.selOffX = pos.x - r.x;
        state.selOffY = pos.y - r.y;
        return;
      } else { applySelection(); }
    }
  } else { applySelection(); }

  state.drawing = true;
  state.startX = pos.x; state.startY = pos.y;
  state.lastX = pos.x; state.lastY = pos.y;
});

draft.addEventListener('mousemove', e => {
  const pos = getPos(e);
  document.getElementById('statusPos').textContent = `${pos.x}, ${pos.y}`;
  document.getElementById('mouseCoord').textContent = `${pos.x}, ${pos.y}`;

  if (state.tool === 'select' && state.isMovingSelection) {
    state.selectionRect.x = pos.x - state.selOffX;
    state.selectionRect.y = pos.y - state.selOffY;
    renderDraft(); return;
  }

  if (!state.drawing) return;

  const col = state.tool === 'eraser' ? '#FFFFFF' : state.color;

  if (state.tool === 'brush') {
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = col;
    ctx.lineWidth = state.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    state.lastX = pos.x; state.lastY = pos.y;

  } else if (state.tool === 'pencil') {
    ctx.save();
    ctx.globalAlpha = state.opacity;
    bresenham(ctx, state.lastX, state.lastY, pos.x, pos.y, col, Math.max(1, state.size * 0.5));
    ctx.restore();
    state.lastX = pos.x; state.lastY = pos.y;

  } else if (state.tool === 'eraser') {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = state.size;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
    state.lastX = pos.x; state.lastY = pos.y;

  } else {
    draftCtx.clearRect(0,0,draft.width,draft.height);
    draftCtx.save();
    draftCtx.globalAlpha = state.opacity;

    if (state.tool === 'line') {
      bresenham(draftCtx, state.startX, state.startY, pos.x, pos.y, col, state.size);
    } else if (state.tool === 'rect') {
      const r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
      drawRect(draftCtx, col, state.size, r.x, r.y, r.w, r.h);
    } else if (state.tool === 'rectfill') {
      const r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
      drawRectFill(draftCtx, col, r.x, r.y, r.w, r.h);
    } else if (state.tool === 'circle') {
      const rad = Math.floor(Math.hypot(pos.x-state.startX, pos.y-state.startY));
      midpointCircle(draftCtx, state.startX, state.startY, rad, col, state.size);
    } else if (state.tool === 'circlefill') {
      const rad = Math.floor(Math.hypot(pos.x-state.startX, pos.y-state.startY));
      midpointCircleFill(draftCtx, col, state.startX, state.startY, rad);
    } else if (state.tool === 'ellipse') {
      midpointEllipse(draftCtx, state.startX, state.startY, Math.abs(pos.x-state.startX), Math.abs(pos.y-state.startY), col, state.size);
    } else if (state.tool === 'triangle') {
      drawTriangle(draftCtx, col, state.size, state.startX, state.startY, pos.x, pos.y);
    } else if (state.tool === 'select') {
      state.selectionRect = normalizeRect(state.startX, state.startY, pos.x, pos.y);
      renderDraft();
    }
    draftCtx.restore();
  }
});

window.addEventListener('mouseup', e => {
  if (!state.drawing && !state.isMovingSelection) return;

  const pos = getPos(e);

  if (state.tool === 'select') {
    if (state.isMovingSelection) { state.isMovingSelection = false; return; }
    if (state.drawing && state.selectionRect && state.selectionRect.w > 5 && state.selectionRect.h > 5) {
      const r = state.selectionRect;
      const tmp = document.createElement('canvas');
      tmp.width = r.w; tmp.height = r.h;
      const imgData = ctx.getImageData(r.x, r.y, r.w, r.h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] >= 240 && d[i+1] >= 240 && d[i+2] >= 240) {
          d[i+3] = 0; 
        }
      }
      tmp.getContext('2d').putImageData(imgData, 0, 0);
      state.selectedCanvas = tmp;
      const srcData = ctx.getImageData(r.x, r.y, r.w, r.h);
      const sd = srcData.data;
      for (let i = 0; i < sd.length; i += 4) {
        if (!(sd[i] >= 240 && sd[i+1] >= 240 && sd[i+2] >= 240)) {
          sd[i] = 255; sd[i+1] = 255; sd[i+2] = 255; sd[i+3] = 255;
        }
      }
      ctx.putImageData(srcData, r.x, r.y);
      renderDraft();
    }
  } else if (state.drawing && ['line','rect','rectfill','circle','circlefill','ellipse','triangle'].includes(state.tool)) {
    ctx.save();
    ctx.globalAlpha = state.opacity;
    const col = state.color;
    if (state.tool === 'line') {
      bresenham(ctx, state.startX, state.startY, pos.x, pos.y, col, state.size);
    } else if (state.tool === 'rect') {
      const r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
      drawRect(ctx, col, state.size, r.x, r.y, r.w, r.h);
    } else if (state.tool === 'rectfill') {
      const r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
      drawRectFill(ctx, col, r.x, r.y, r.w, r.h);
    } else if (state.tool === 'circle') {
      const rad = Math.floor(Math.hypot(pos.x-state.startX, pos.y-state.startY));
      midpointCircle(ctx, state.startX, state.startY, rad, col, state.size);
    } else if (state.tool === 'circlefill') {
      const rad = Math.floor(Math.hypot(pos.x-state.startX, pos.y-state.startY));
      midpointCircleFill(ctx, col, state.startX, state.startY, rad);
    } else if (state.tool === 'ellipse') {
      midpointEllipse(ctx, state.startX, state.startY, Math.abs(pos.x-state.startX), Math.abs(pos.y-state.startY), col, state.size);
    } else if (state.tool === 'triangle') {
      drawTriangle(ctx, col, state.size, state.startX, state.startY, pos.x, pos.y);
    }
    ctx.restore();
    draftCtx.clearRect(0,0,draft.width,draft.height);
    saveHistory();
  } else if (state.drawing && (state.tool === 'brush' || state.tool === 'pencil' || state.tool === 'eraser')) {
    saveHistory();
  }

  state.drawing = false;
});

// ──────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ──────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT') return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (ctrl && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); redo(); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); menuAction('savePNG'); return; }
  if (ctrl && e.key === 'n') { e.preventDefault(); menuAction('new'); return; }
  if (ctrl && e.key === 'o') { e.preventDefault(); menuAction('openImg'); return; }
  if (ctrl && e.key === 'a') { e.preventDefault(); selectAll(); return; }
  if (ctrl && e.key === '+' || (ctrl && e.key === '=')) { e.preventDefault(); setZoom(state.zoom * 1.25); return; }
  if (ctrl && e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.25); return; }
  if (ctrl && e.key === '0') { e.preventDefault(); setZoom(1); return; }

  if (e.key === 'Escape') { applySelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.tool === 'select') { deleteSelection(); return; }
  }
  if (e.key === 'Enter' && state.tool === 'select') { applySelection(); return; }

  const toolMap = { b:'brush', p:'pencil', e:'eraser', f:'fill', l:'line',
    r:'rect', c:'circle', t:'triangle', x:'text', i:'eyedrop', s:'select', m:'move' };
  if (!ctrl && toolMap[e.key.toLowerCase()]) {
    const tname = toolMap[e.key.toLowerCase()];
    document.querySelector(`[data-tool="${tname}"]`)?.click();
  }

  if (state.tool === 'select' && state.selectedCanvas) {
    if (e.key === 'ArrowLeft') { state.transformAngle -= 15; e.preventDefault(); renderDraft(); }
    if (e.key === 'ArrowRight') { state.transformAngle += 15; e.preventDefault(); renderDraft(); }
    if (e.key === 'ArrowUp') { state.transformScale *= 1.1; e.preventDefault(); renderDraft(); }
    if (e.key === 'ArrowDown') { state.transformScale *= 0.9; e.preventDefault(); renderDraft(); }
  }
});

// ──────────────────────────────────────────────────
// ZOOM
// ──────────────────────────────────────────────────
function setZoom(z) {
  state.zoom = Math.min(8, Math.max(0.1, z));
  const wrap = document.getElementById('canvasWrap');
  wrap.style.transform = `scale(${state.zoom})`;
  wrap.style.transformOrigin = 'center center';
  const label = Math.round(state.zoom * 100) + '%';
  document.getElementById('zoomBadge').textContent = label;
  document.getElementById('statusZoom').textContent = label;
}

document.getElementById('canvasArea').addEventListener('wheel', e => {
  if (e.ctrlKey) {
    e.preventDefault();
    setZoom(e.deltaY < 0 ? state.zoom * 1.1 : state.zoom / 1.1);
  }
}, { passive: false });

// ──────────────────────────────────────────────────
// MENU & ACTIONS
// ──────────────────────────────────────────────────
function toggleMenu(groupId) {
  document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
  const group = document.getElementById(groupId);
  const drop = group.querySelector('.dropdown');
  const btn = group.querySelector('.menu-btn');
  if (!drop.classList.contains('show')) {
    drop.classList.add('show');
    btn.classList.add('open');
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-group')) {
    document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
  }
});

function menuAction(action) {
  document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));

  switch (action) {
    case 'new':
      if (confirm('Buat kanvas baru? Pekerjaan yang belum disimpan akan hilang.')) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        state.history = [];
        state.historyIndex = -1;
        saveHistory();
        updateHistoryUI();
      }
      break;
    case 'openImg':
      document.getElementById('fileInput').click();
      break;
    case 'savePNG':
      applySelection();
      const a = document.createElement('a');
      a.download = 'paintpro.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      break;
    case 'saveJPG':
      applySelection();
      const aj = document.createElement('a');
      aj.download = 'paintpro.jpg';
      aj.href = canvas.toDataURL('image/jpeg', 0.95);
      aj.click();
      break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'selectAll': selectAll(); break;
    case 'deselect': applySelection(); break;
    case 'grayscale': applyGrayscale(); break;
    case 'invert': applyInvert(); break;
    case 'flipH': applyFlipH(); break;
    case 'flipV': applyFlipV(); break;
    case 'resize':
      document.getElementById('resizeW').value = canvas.width;
      document.getElementById('resizeH').value = canvas.height;
      document.getElementById('resizeModal').classList.add('show');
      break;
    case 'clear':
      if (confirm('Bersihkan kanvas?')) {
        saveHistory();
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        saveHistory();
      }
      break;
    case 'zoomIn': setZoom(state.zoom * 1.25); break;
    case 'zoomOut': setZoom(state.zoom / 1.25); break;
    case 'zoom100': setZoom(1); break;
  }
}

// ──────────────────────────────────────────────────
// ACTION BUTTONS
// ──────────────────────────────────────────────────
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnClear').addEventListener('click', () => menuAction('clear'));
document.getElementById('btnExport').addEventListener('click', () => menuAction('savePNG'));
document.getElementById('btnGray').addEventListener('click', applyGrayscale);
document.getElementById('btnInvert').addEventListener('click', applyInvert);
document.getElementById('btnFlipH').addEventListener('click', applyFlipH);
document.getElementById('btnFlipV').addEventListener('click', applyFlipV);

// ──────────────────────────────────────────────────
// OPEN IMAGE
// ──────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    saveHistory();
    canvas.width = img.width; canvas.height = img.height;
    draft.width = img.width; draft.height = img.height;
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    document.getElementById('canvasSizeInfo').textContent = `${canvas.width} × ${canvas.height} px`;
    saveHistory();
  };
  img.src = url;
  e.target.value = '';
});

// ──────────────────────────────────────────────────
// TEXT TOOL
// ──────────────────────────────────────────────────
function doAddText() {
  const txt = document.getElementById('textContent').value.trim();
  const sz = parseInt(document.getElementById('textSize').value) || 24;
  if (txt && state.pendingTextPos) {
    saveHistory();
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.fillStyle = state.color;
    ctx.font = `${sz}px 'DM Sans', sans-serif`;
    ctx.fillText(txt, state.pendingTextPos.x, state.pendingTextPos.y);
    ctx.restore();
    saveHistory();
  }
  closeModal('textModal');
}
document.getElementById('textContent').addEventListener('keydown', e => {
  if (e.key === 'Enter') doAddText();
  if (e.key === 'Escape') closeModal('textModal');
});

// ──────────────────────────────────────────────────
// RESIZE
// ──────────────────────────────────────────────────
function doResize() {
  const nw = parseInt(document.getElementById('resizeW').value);
  const nh = parseInt(document.getElementById('resizeH').value);
  if (!nw || !nh) return;
  saveHistory();
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  canvas.width = nw; canvas.height = nh;
  draft.width = nw; draft.height = nh;
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,nw,nh);
  ctx.drawImage(tmp, 0, 0);
  document.getElementById('canvasSizeInfo').textContent = `${nw} × ${nh} px`;
  closeModal('resizeModal');
  saveHistory();
}

// ──────────────────────────────────────────────────
// MODAL HELPERS
// ──────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
});

// ──────────────────────────────────────────────────
// INIT UI
// ──────────────────────────────────────────────────
document.getElementById('canvasSizeInfo').textContent = `${canvas.width} × ${canvas.height} px`;
updateHistoryUI();
document.getElementById('transformHint').classList.remove('show');