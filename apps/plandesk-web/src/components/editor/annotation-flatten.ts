export type AnnotationShape = {
  id: string;
  type: 'arrow' | 'rect' | 'text' | 'blur';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color: string;
};

export const ANNOTATION_COLORS = [
  'var(--primary)',
  'var(--destructive)',
  'var(--s-done-dot)',
  'var(--muted-foreground)',
] as const;

export function parseAnnotations(raw: string): AnnotationShape[] {
  if (raw === '' || raw === '[]') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isAnnotationShape);
  } catch {
    return [];
  }
}

function isAnnotationShape(value: unknown): value is AnnotationShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const shape = value as Record<string, unknown>;
  return (
    typeof shape.id === 'string' &&
    (shape.type === 'arrow' ||
      shape.type === 'rect' ||
      shape.type === 'text' ||
      shape.type === 'blur') &&
    typeof shape.x === 'number' &&
    typeof shape.y === 'number' &&
    typeof shape.w === 'number' &&
    typeof shape.h === 'number' &&
    typeof shape.color === 'string' &&
    (shape.text === undefined || typeof shape.text === 'string')
  );
}

export function serializeAnnotations(shapes: AnnotationShape[]): string {
  return JSON.stringify(shapes);
}

export function normalizeRectBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function arrowEndpoints(shape: AnnotationShape): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: shape.x, y1: shape.y, x2: shape.x + shape.w, y2: shape.y + shape.h };
}

export function shapeBounds(shape: AnnotationShape): { x: number; y: number; w: number; h: number } {
  if (shape.type === 'arrow') {
    const { x1, y1, x2, y2 } = arrowEndpoints(shape);
    return normalizeRectBounds(x1, y1, x2, y2);
  }
  if (shape.type === 'text') {
    const fontSize = Math.max(14, shape.h || 18);
    const textWidth = Math.max((shape.text?.length ?? 1) * fontSize * 0.55, shape.w || 40);
    return { x: shape.x, y: shape.y, w: textWidth, h: fontSize * 1.4 };
  }
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

function resolveCssColor(color: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  if (!color.startsWith('var(')) {
    return color;
  }
  const probe = document.createElement('span');
  probe.style.color = color;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    img.src = src;
  });
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
) {
  const headLength = Math.min(18, Math.hypot(x2 - x1, y2 - y1) * 0.25);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawBlurRedact(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (w < 1 || h < 1) {
    return;
  }
  const block = 12;
  const imageData = ctx.getImageData(x, y, w, h);
  const { data, width, height } = imageData;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let py = by; py < Math.min(by + block, height); py++) {
        for (let px = bx; px < Math.min(bx + block, width); px++) {
          const i = (py * width + px) * 4;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      for (let py = by; py < Math.min(by + block, height); py++) {
        for (let px = bx; px < Math.min(bx + block, width); px++) {
          const i = (py * width + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imageData, x, y);
}

function paintShape(ctx: CanvasRenderingContext2D, shape: AnnotationShape) {
  const color = resolveCssColor(shape.color);
  if (shape.type === 'arrow') {
    const { x1, y1, x2, y2 } = arrowEndpoints(shape);
    drawArrow(ctx, x1, y1, x2, y2, color);
    return;
  }
  if (shape.type === 'rect') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
    return;
  }
  if (shape.type === 'text') {
    const fontSize = Math.max(14, shape.h || 18);
    ctx.font = `600 ${String(fontSize)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(shape.text ?? '', shape.x, shape.y + fontSize);
    return;
  }
  drawBlurRedact(ctx, Math.round(shape.x), Math.round(shape.y), Math.round(shape.w), Math.round(shape.h));
}

export async function flattenAnnotations(
  originalSrc: string,
  annotations: AnnotationShape[],
  naturalW: number,
  naturalH: number,
): Promise<string> {
  if (annotations.length === 0) {
    return originalSrc;
  }
  if (typeof document === 'undefined') {
    return originalSrc;
  }
  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d');
  if (ctx === null || typeof canvas.toDataURL !== 'function') {
    return originalSrc;
  }
  try {
    const img = await loadImage(originalSrc);
    ctx.drawImage(img, 0, 0, naturalW, naturalH);
    for (const shape of annotations) {
      paintShape(ctx, shape);
    }
    return canvas.toDataURL('image/png');
  } catch {
    return originalSrc;
  }
}