export function getPhoneCameraOverlayHtml(): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>ZZ Record 手机摄像头</title>
<style>
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
body { display: grid; place-items: center; padding: 30px; }
#camera-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: #111827;
  border-radius: 38px;
  filter: drop-shadow(0 10px 28px rgba(0, 0, 0, .46));
}
#drag-handle, #resize-handle { position: absolute; z-index: 2; touch-action: none; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
#camera-frame.is-controls-visible #drag-handle, #camera-frame.is-controls-visible #resize-handle { opacity: 1; pointer-events: auto; }
#drag-handle { top: 8px; left: 50%; width: 40px; height: 18px; transform: translateX(-50%); cursor: grab; }
#drag-handle:active { cursor: grabbing; }
#drag-handle::before { content: ''; position: absolute; top: 7px; left: 8px; width: 24px; height: 3px; border-radius: 999px; background: rgba(255,255,255,.82); box-shadow: 0 1px 6px rgba(0,0,0,.34); }
#resize-handle { right: 9px; bottom: 9px; width: 24px; height: 24px; border-radius: 50%; background: rgba(15,23,42,.72); border: 1px solid rgba(255,255,255,.38); box-shadow: 0 2px 7px rgba(0,0,0,.28); cursor: nwse-resize; }
#resize-handle::before { content: ''; position: absolute; right: 6px; bottom: 6px; width: 9px; height: 9px; border-right: 2px solid rgba(255,255,255,.92); border-bottom: 2px solid rgba(255,255,255,.92); }
#scale-controls { position: absolute; z-index: 3; right: 41px; bottom: 9px; display: flex; gap: 5px; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
#camera-frame.is-controls-visible #scale-controls { opacity: 1; pointer-events: auto; }
.scale-button { width: 24px; height: 24px; padding: 0; border: 1px solid rgba(255,255,255,.38); border-radius: 50%; background: rgba(15,23,42,.72); color: #fff; box-shadow: 0 2px 7px rgba(0,0,0,.28); font: 600 17px/1 system-ui, sans-serif; cursor: pointer; }
.scale-button.reset { font-size: 15px; }
.scale-button:hover { background: rgba(255,255,255,.2); }
#recovery-button { position: absolute; z-index: 4; top: 9px; right: 9px; width: 22px; height: 22px; padding: 0; border: 1px solid rgba(255,255,255,.34); border-radius: 50%; background: rgba(15,23,42,.5); color: rgba(255,255,255,.88); box-shadow: 0 1px 5px rgba(0,0,0,.2); font: 600 14px/1 system-ui, sans-serif; cursor: pointer; opacity: .46; transition: opacity .16s ease, background .16s ease; }
#recovery-button:hover { opacity: 1; background: rgba(15,23,42,.82); }
#connection-indicator { position: absolute; top: 11px; left: 12px; display: none; width: 8px; height: 8px; border: 1px solid rgba(255,255,255,.82); border-radius: 50%; background: #33c481; box-shadow: 0 1px 7px rgba(0,0,0,.34); }
#camera-frame.is-connected #connection-indicator { display: block; }
#preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: none;
  transform: scaleX(-1);
}
#status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 28px;
  color: rgba(255,255,255,.86);
  font: 500 13px/1.45 system-ui, sans-serif;
  text-align: center;
}
</style>
</head>
<body>
<div id="camera-frame">
  <div id="drag-handle" title="拖动预览"></div>
  <img id="preview" alt="手机摄像头预览" />
  <div id="status">正在等待手机画面...</div>
  <div id="connection-indicator" aria-label="手机已连接"></div>
  <button id="recovery-button" type="button" title="恢复默认大小" aria-label="恢复默认大小">↺</button>
  <div id="scale-controls" aria-label="预览缩放">
    <button id="shrink-button" class="scale-button" type="button" title="缩小预览" aria-label="缩小预览">-</button>
    <button id="reset-size-button" class="scale-button reset" type="button" title="恢复默认大小" aria-label="恢复默认大小">↺</button>
    <button id="grow-button" class="scale-button" type="button" title="放大预览" aria-label="放大预览">+</button>
  </div>
  <div id="resize-handle" title="缩放预览"></div>
</div>
<script>
const frame = document.getElementById('camera-frame');
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const dragHandle = document.getElementById('drag-handle');
const resizeHandle = document.getElementById('resize-handle');
const recoveryButton = document.getElementById('recovery-button');
const shrinkButton = document.getElementById('shrink-button');
const resetSizeButton = document.getElementById('reset-size-button');
const growButton = document.getElementById('grow-button');
let controlsTimeout = null;

function revealControls() {
  frame.classList.add('is-controls-visible');
  if (controlsTimeout) clearTimeout(controlsTimeout);
  controlsTimeout = null;
}

function scheduleControlsHide() {
  if (controlsTimeout) clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => frame.classList.remove('is-controls-visible'), 2000);
}

function keepControlClick(event) {
  event.stopPropagation();
  revealControls();
}

function resetPreviewSize(event) {
  if (event) keepControlClick(event);
  revealControls();
  window.electronAPI.phoneCameraOverlayResetSize();
}

function getSquirclePath(width, height, radius) {
  const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
  if (safeRadius <= .5) return 'M 0 0 L ' + width + ' 0 L ' + width + ' ' + height + ' L 0 ' + height + ' Z';

  const exponent = 2 / 4.5;
  const points = [{ x: safeRadius, y: 0 }];
  const corners = [
    { cx: width - safeRadius, cy: safeRadius, start: -Math.PI / 2, end: 0 },
    { cx: width - safeRadius, cy: height - safeRadius, start: 0, end: Math.PI / 2 },
    { cx: safeRadius, cy: height - safeRadius, start: Math.PI / 2, end: Math.PI },
    { cx: safeRadius, cy: safeRadius, start: Math.PI, end: Math.PI * 1.5 },
  ];

  for (const corner of corners) {
    for (let index = 1; index <= 10; index += 1) {
      const angle = corner.start + ((corner.end - corner.start) * index) / 10;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push({
        x: corner.cx + Math.sign(cos) * safeRadius * Math.pow(Math.abs(cos), exponent),
        y: corner.cy + Math.sign(sin) * safeRadius * Math.pow(Math.abs(sin), exponent),
      });
    }
  }
  const [first, ...rest] = points;
  return 'M ' + first.x + ' ' + first.y + ' ' + rest.map((point) => 'L ' + point.x + ' ' + point.y).join(' ') + ' Z';
}

function applyEditorStyle() {
  const size = Math.min(frame.clientWidth, frame.clientHeight);
  const path = getSquirclePath(size, size, 90);
  frame.style.clipPath = "path('" + path + "')";
  frame.style.webkitClipPath = "path('" + path + "')";
}

applyEditorStyle();
window.addEventListener('resize', applyEditorStyle);
frame.addEventListener('pointerenter', revealControls);
frame.addEventListener('pointermove', revealControls);
frame.addEventListener('pointerdown', revealControls);
frame.addEventListener('pointerleave', scheduleControlsHide);

function bindWindowInteraction(handle, kind) {
  let pointerId = null;
  const finish = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    window.electronAPI.phoneCameraOverlayInteract(kind, 'end', event.screenX, event.screenY);
    handle.releasePointerCapture?.(pointerId);
    pointerId = null;
    event.stopPropagation();
  };
  handle.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    handle.setPointerCapture?.(pointerId);
    window.electronAPI.phoneCameraOverlayInteract(kind, 'start', event.screenX, event.screenY);
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener('pointermove', (event) => {
    if (pointerId === event.pointerId) {
      window.electronAPI.phoneCameraOverlayInteract(kind, 'move', event.screenX, event.screenY);
      event.stopPropagation();
    }
  });
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

bindWindowInteraction(dragHandle, 'move');
bindWindowInteraction(resizeHandle, 'resize');
recoveryButton.addEventListener('pointerdown', keepControlClick);
shrinkButton.addEventListener('pointerdown', keepControlClick);
resetSizeButton.addEventListener('pointerdown', keepControlClick);
growButton.addEventListener('pointerdown', keepControlClick);

shrinkButton.addEventListener('click', (event) => {
  keepControlClick(event);
  revealControls();
  window.electronAPI.phoneCameraOverlayResizeBy(-80);
});
recoveryButton.addEventListener('click', resetPreviewSize);
resetSizeButton.addEventListener('click', resetPreviewSize);
growButton.addEventListener('click', (event) => {
  keepControlClick(event);
  revealControls();
  window.electronAPI.phoneCameraOverlayResizeBy(80);
});

window.electronAPI.onPhoneCameraFrame((phoneFrame) => {
  if (!phoneFrame || typeof phoneFrame.frameDataUrl !== 'string') return;
  preview.src = phoneFrame.frameDataUrl;
  preview.style.display = 'block';
  status.style.display = 'none';
	frame.classList.add('is-connected');
});
</script>
</body>
</html>`;
}
