// ==========================================
// INISIALISASI & STATE
// ==========================================
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const draftCanvas = document.getElementById('draftCanvas');
const draftCtx = draftCanvas.getContext('2d');

// Fill background white initially
ctx.fillStyle = "#FFFFFF";
ctx.fillRect(0, 0, canvas.width, canvas.height);

const PALETTE = [
    '#000000', '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
    '#FFFFFF', '#EC4899', '#8B5CF6', '#14B8A6', '#6366F1'
];

let state = {
    tool: 'brush',
    color: '#000000',
    size: 4,
    drawing: false,
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    
    // Selection state
    selectionRect: null,
    selectedImageData: null,
    selectedCanvas: null,
    isMovingSelection: false,
    offsetX: 0, offsetY: 0,
    transformAngle: 0,
    transformScale: 1
};

// ==========================================
// UI BINDING
// ==========================================
// Tool Buttons
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        applySelection();
        state.tool = e.target.dataset.tool;
        document.getElementById('transformHints').style.display = (state.tool === 'select') ? 'block' : 'none';
    });
});

// Brush Size
const sizeInput = document.getElementById('brushSize');
const sizeLabel = document.getElementById('brushSizeLabel');
sizeInput.addEventListener('input', (e) => {
    state.size = parseInt(e.target.value);
    sizeLabel.textContent = state.size + 'px';
});

// Palette Generation
const paletteBox = document.getElementById('paletteBox');
PALETTE.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (i === 0 ? ' active' : '');
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        state.color = color;
    });
    paletteBox.appendChild(swatch);
});

// Action Buttons
document.getElementById('btnClear').addEventListener('click', () => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
});
document.getElementById('btnApply').addEventListener('click', applySelection);
document.getElementById('btnExport').addEventListener('click', () => {
    applySelection();
    const link = document.createElement('a');
    link.download = 'export_paintpro.png';
    link.href = canvas.toDataURL();
    link.click();
});
document.getElementById('btnGray').addEventListener('click', () => {
    applySelection();
    applyGrayscale();
});

// ==========================================
// ALGORITMA GRAFIKA KOMPUTER
// ==========================================
function putPixel(context, x, y, color, size) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, size/2, 0, Math.PI * 2);
    context.fill();
}

function drawLineBresenham(context, x1, y1, x2, y2, color, size) {
    let dx = Math.abs(x2 - x1);
    let dy = Math.abs(y2 - y1);
    let sx = (x1 < x2) ? 1 : -1;
    let sy = (y1 < y2) ? 1 : -1;
    let err = dx - dy;

    while(true) {
        putPixel(context, x1, y1, color, size);
        if ((x1 === x2) && (y1 === y2)) break;
        let e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x1 += sx; }
        if (e2 < dx) { err += dx; y1 += sy; }
    }
}

function drawCircleMidpoint(context, xc, yc, r, color, size) {
    let x = 0;
    let y = r;
    let d = 1 - r;

    function drawSymmetric(cx, cy, px, py) {
        putPixel(context, cx+px, cy+py, color, size); putPixel(context, cx-px, cy+py, color, size);
        putPixel(context, cx+px, cy-py, color, size); putPixel(context, cx-px, cy-py, color, size);
        putPixel(context, cx+py, cy+px, color, size); putPixel(context, cx-py, cy+px, color, size);
        putPixel(context, cx+py, cy-px, color, size); putPixel(context, cx-py, cy-px, color, size);
    }

    drawSymmetric(xc, yc, x, y);
    while (x < y) {
        if (d < 0) { d += 2 * x + 3; } 
        else { d += 2 * (x - y) + 5; y--; }
        x++;
        drawSymmetric(xc, yc, x, y);
    }
}

function drawEllipseMidpoint(context, xc, yc, rx, ry, color, size) {
    if (rx === 0 || ry === 0) return;
    let x = 0; let y = ry;
    let d1 = (ry*ry) - (rx*rx*ry) + (0.25*rx*rx);
    let dx = 2 * ry*ry * x; let dy = 2 * rx*rx * y;

    function drawSymmetric(cx, cy, px, py) {
        putPixel(context, cx+px, cy+py, color, size); putPixel(context, cx-px, cy+py, color, size);
        putPixel(context, cx+px, cy-py, color, size); putPixel(context, cx-px, cy-py, color, size);
    }

    while (dx < dy) {
        drawSymmetric(xc, yc, x, y);
        if (d1 < 0) { x++; dx += 2*ry*ry; d1 += dx + ry*ry; } 
        else { x++; y--; dx += 2*ry*ry; dy -= 2*rx*rx; d1 += dx - dy + ry*ry; }
    }
    
    let d2 = ((ry*ry) * ((x + 0.5) * (x + 0.5))) + ((rx*rx) * ((y - 1) * (y - 1))) - (rx*rx * ry*ry);
    while (y >= 0) {
        drawSymmetric(xc, yc, x, y);
        if (d2 > 0) { y--; dy -= 2*rx*rx; d2 += rx*rx - dy; } 
        else { y--; x++; dx += 2*ry*ry; dy -= 2*rx*rx; d2 += dx - dy + rx*rx; }
    }
}

function hexToRgb(hex) {
    let bigint = parseInt(hex.slice(1), 16);
    return [ (bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255 ];
}

function floodFill(startX, startY, fillColorHex) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;
    
    const startIdx = (startY * w + startX) * 4;
    const targetR = data[startIdx], targetG = data[startIdx+1], targetB = data[startIdx+2];
    const fillRgb = hexToRgb(fillColorHex);
    
    if (targetR === fillRgb[0] && targetG === fillRgb[1] && targetB === fillRgb[2]) return;

    const pixelStack = [[startX, startY]];
    
    while(pixelStack.length) {
        let newPos = pixelStack.pop();
        let x = newPos[0]; let y = newPos[1];
        let pixelPos = (y * w + x) * 4;

        while(y-- >= 0 && matchStartColor(pixelPos)) { pixelPos -= w * 4; }
        pixelPos += w * 4; ++y;
        
        let reachLeft = false; let reachRight = false;
        
        while(y++ < h - 1 && matchStartColor(pixelPos)) {
            colorPixel(pixelPos);
            
            if (x > 0) {
                if (matchStartColor(pixelPos - 4)) {
                    if (!reachLeft) { pixelStack.push([x - 1, y]); reachLeft = true; }
                } else if (reachLeft) { reachLeft = false; }
            }
            if (x < w - 1) {
                if (matchStartColor(pixelPos + 4)) {
                    if (!reachRight) { pixelStack.push([x + 1, y]); reachRight = true; }
                } else if (reachRight) { reachRight = false; }
            }
            pixelPos += w * 4;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    function matchStartColor(pos) { return (data[pos] === targetR && data[pos+1] === targetG && data[pos+2] === targetB); }
    function colorPixel(pos) { data[pos] = fillRgb[0]; data[pos+1] = fillRgb[1]; data[pos+2] = fillRgb[2]; data[pos+3] = 255; }
}

function applyGrayscale() {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        let gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        data[i] = data[i+1] = data[i+2] = gray;
    }
    ctx.putImageData(imgData, 0, 0);
}

// ==========================================
// MANIPULASI SELEKSI & TRANSFORMASI
// ==========================================
function normalizeRect(x1, y1, x2, y2) {
    return {
        x: Math.max(0, Math.min(x1, x2)), y: Math.max(0, Math.min(y1, y2)),
        w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
    };
}

function applySelection() {
    if (state.selectedCanvas && state.selectionRect) {
        ctx.save();
        ctx.translate(state.selectionRect.x + state.selectionRect.w/2, state.selectionRect.y + state.selectionRect.h/2);
        ctx.rotate(state.transformAngle * Math.PI / 180);
        ctx.scale(state.transformScale, state.transformScale);
        ctx.drawImage(state.selectedCanvas, -state.selectionRect.w/2, -state.selectionRect.h/2);
        ctx.restore();
        
        state.selectedCanvas = null;
        state.selectionRect = null;
        state.transformAngle = 0;
        state.transformScale = 1;
        renderDraft();
    }
}

// ==========================================
// EVENT LISTENER MOUSE & KEYBOARD
// ==========================================
function getMousePos(evt) {
    const rect = draftCanvas.getBoundingClientRect();
    return { x: Math.floor(evt.clientX - rect.left), y: Math.floor(evt.clientY - rect.top) };
}

function renderDraft() {
    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
    
    if (state.tool === 'select' && state.selectionRect) {
        const r = state.selectionRect;
        
        if (state.selectedCanvas) {
            draftCtx.save();
            draftCtx.translate(r.x + r.w/2, r.y + r.h/2);
            draftCtx.rotate(state.transformAngle * Math.PI / 180);
            draftCtx.scale(state.transformScale, state.transformScale);
            draftCtx.drawImage(state.selectedCanvas, -r.w/2, -r.h/2);
            draftCtx.restore();
            
            draftCtx.strokeStyle = 'var(--blue-brand)';
            draftCtx.lineWidth = 2;
            draftCtx.setLineDash([5, 5]);
            
            let scaledW = r.w * state.transformScale;
            let scaledH = r.h * state.transformScale;
            draftCtx.strokeRect(r.x + r.w/2 - scaledW/2, r.y + r.h/2 - scaledH/2, scaledW, scaledH);
            draftCtx.setLineDash([]);
        } else {
            draftCtx.strokeStyle = 'var(--blue-brand)';
            draftCtx.lineWidth = 2;
            draftCtx.setLineDash([5, 5]);
            draftCtx.strokeRect(r.x, r.y, r.w, r.h);
            draftCtx.setLineDash([]);
        }
    }
}

draftCanvas.addEventListener('mousedown', (e) => {
    const pos = getMousePos(e);
    
    if (state.tool === 'fill') {
        floodFill(pos.x, pos.y, state.color);
        return;
    }

    if (state.tool === 'select') {
        if (state.selectedCanvas && state.selectionRect) {
            let r = state.selectionRect;
            let scaledW = r.w * state.transformScale; let scaledH = r.h * state.transformScale;
            let bounds = { x: r.x + r.w/2 - scaledW/2, y: r.y + r.h/2 - scaledH/2, w: scaledW, h: scaledH };
            
            if (pos.x >= bounds.x && pos.x <= bounds.x + bounds.w && pos.y >= bounds.y && pos.y <= bounds.y + bounds.h) {
                state.isMovingSelection = true;
                state.offsetX = pos.x - r.x;
                state.offsetY = pos.y - r.y;
                return;
            } else { applySelection(); }
        }
    } else { applySelection(); }

    state.drawing = true;
    state.startX = pos.x; state.startY = pos.y;
    state.lastX = pos.x; state.lastY = pos.y;
});

draftCanvas.addEventListener('mousemove', (e) => {
    const pos = getMousePos(e);
    
    if (state.tool === 'select' && state.isMovingSelection) {
        state.selectionRect.x = pos.x - state.offsetX;
        state.selectionRect.y = pos.y - state.offsetY;
        renderDraft();
        return;
    }

    if (!state.drawing) return;

    if (state.tool === 'brush' || state.tool === 'eraser') {
        let col = state.tool === 'eraser' ? '#FFFFFF' : state.color;
        ctx.beginPath();
        ctx.moveTo(state.lastX, state.lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = col;
        ctx.lineWidth = state.size;
        ctx.lineCap = 'round';
        ctx.stroke();
        state.lastX = pos.x; state.lastY = pos.y;
    } else {
        renderDraft();
        draftCtx.fillStyle = state.color;
        
        if (state.tool === 'line') {
            drawLineBresenham(draftCtx, state.startX, state.startY, pos.x, pos.y, state.color, state.size);
        } else if (state.tool === 'circle') {
            let r = Math.floor(Math.hypot(pos.x - state.startX, pos.y - state.startY));
            drawCircleMidpoint(draftCtx, state.startX, state.startY, r, state.color, state.size);
        } else if (state.tool === 'ellipse') {
            let rx = Math.abs(pos.x - state.startX);
            let ry = Math.abs(pos.y - state.startY);
            drawEllipseMidpoint(draftCtx, state.startX, state.startY, rx, ry, state.color, state.size);
        } else if (state.tool === 'rect') {
            let r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
            draftCtx.fillRect(r.x, r.y, r.w, Math.max(1, state.size)); 
            draftCtx.fillRect(r.x, r.y + r.h, r.w + state.size, Math.max(1, state.size)); 
            draftCtx.fillRect(r.x, r.y, Math.max(1, state.size), r.h); 
            draftCtx.fillRect(r.x + r.w, r.y, Math.max(1, state.size), r.h); 
        } else if (state.tool === 'select') {
            state.selectionRect = normalizeRect(state.startX, state.startY, pos.x, pos.y);
            renderDraft();
        }
    }
});

draftCanvas.addEventListener('mouseup', (e) => {
    const pos = getMousePos(e);
    
    if (state.tool === 'select') {
        if (state.isMovingSelection) {
            state.isMovingSelection = false;
        } else if (state.drawing && state.selectionRect && state.selectionRect.w > 0 && state.selectionRect.h > 0) {
            let r = state.selectionRect;
            let tempCanvas = document.createElement('canvas');
            tempCanvas.width = r.w; tempCanvas.height = r.h;
            tempCanvas.getContext('2d').putImageData(ctx.getImageData(r.x, r.y, r.w, r.h), 0, 0);
            
            state.selectedCanvas = tempCanvas;
            
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(r.x, r.y, r.w, r.h);
            
            renderDraft();
        }
    } else if (state.drawing && ['line', 'rect', 'circle', 'ellipse'].includes(state.tool)) {
        if (state.tool === 'line') {
            drawLineBresenham(ctx, state.startX, state.startY, pos.x, pos.y, state.color, state.size);
        } else if (state.tool === 'circle') {
            let r = Math.floor(Math.hypot(pos.x - state.startX, pos.y - state.startY));
            drawCircleMidpoint(ctx, state.startX, state.startY, r, state.color, state.size);
        } else if (state.tool === 'ellipse') {
            let rx = Math.abs(pos.x - state.startX);
            let ry = Math.abs(pos.y - state.startY);
            drawEllipseMidpoint(ctx, state.startX, state.startY, rx, ry, state.color, state.size);
        } else if (state.tool === 'rect') {
            let r = normalizeRect(state.startX, state.startY, pos.x, pos.y);
            ctx.fillStyle = state.color;
            ctx.fillRect(r.x, r.y, r.w, Math.max(1, state.size));
            ctx.fillRect(r.x, r.y + r.h, r.w + state.size, Math.max(1, state.size));
            ctx.fillRect(r.x, r.y, Math.max(1, state.size), r.h);
            ctx.fillRect(r.x + r.w, r.y, Math.max(1, state.size), r.h);
        }
        draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
    }
    state.drawing = false;
});

// Keyboard Transformation Controls
document.addEventListener('keydown', (e) => {
    if (state.tool === 'select' && state.selectedCanvas) {
        if (e.key === 'ArrowLeft') state.transformAngle -= 15;
        if (e.key === 'ArrowRight') state.transformAngle += 15;
        if (e.key === 'ArrowUp') state.transformScale *= 1.1;
        if (e.key === 'ArrowDown') state.transformScale *= 0.9;
        
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            renderDraft();
        }
    }
});