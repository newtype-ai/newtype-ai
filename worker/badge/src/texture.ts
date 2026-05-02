import * as THREE from 'three';

interface AgentData {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  lines.slice(0, maxLines).forEach((value, index) => {
    const suffix = index === maxLines - 1 && words.length > value.split(/\s+/).length ? '...' : '';
    ctx.fillText(`${value}${suffix}`, x, y + index * lineHeight);
  });
}

export function createBadgeTexture(agentData: AgentData): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1440;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = '#0c0c0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const left = 132;
  const right = canvas.width - 132;
  const width = right - left;

  ctx.fillStyle = '#444444';
  ctx.font = '600 42px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.letterSpacing = '8px';
  ctx.fillText('NEWTYPE', left, 170);
  ctx.letterSpacing = '0px';

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, 230);
  ctx.lineTo(right, 230);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 84px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawWrappedText(ctx, agentData.name, left, 400, width, 100, 2);

  const description =
    agentData.description.length > 140
      ? `${agentData.description.slice(0, 137)}...`
      : agentData.description;
  ctx.fillStyle = '#999999';
  ctx.font = '400 36px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawWrappedText(ctx, description, left, 640, width, 54, 4);

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, 850);
  ctx.lineTo(right, 850);
  ctx.stroke();

  ctx.fillStyle = '#555555';
  ctx.font = '600 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('SKILLS', left, 940);

  const tags = Array.from(new Set(agentData.skills.flatMap((skill) => skill.tags))).slice(0, 6);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 32px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  tags.forEach((tag, index) => {
    ctx.fillText(tag, left, 1010 + index * 58);
  });

  ctx.fillStyle = '#444444';
  ctx.font = '400 26px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`A2A v${agentData.protocolVersion}  /  v${agentData.version}`, left, 1320);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
