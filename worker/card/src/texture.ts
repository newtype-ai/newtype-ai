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
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  provider?: {
    organization: string;
    url?: string;
  };
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
    ctx.fillText(value, x, y + index * lineHeight);
  });
}

function baseTexture(background: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 645;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createCardFrontTexture(agentData: AgentData): THREE.CanvasTexture {
  const { canvas, ctx } = baseTexture('#0c0c0c');
  const left = 70;
  const right = canvas.width - 70;
  const width = right - left;

  ctx.fillStyle = '#444444';
  ctx.font = '600 30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('NEWTYPE', left, 98);

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, 136);
  ctx.lineTo(right, 136);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 68px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawWrappedText(ctx, agentData.name, left, 245, width, 78, 2);

  const description =
    agentData.description.length > 150
      ? `${agentData.description.slice(0, 147)}...`
      : agentData.description;
  ctx.fillStyle = '#999999';
  ctx.font = '400 30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawWrappedText(ctx, description, left, 390, width, 44, 3);

  ctx.fillStyle = '#444444';
  ctx.font = '400 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`A2A v${agentData.protocolVersion}`, left, 570);
  const version = `v${agentData.version}`;
  ctx.fillText(version, right - ctx.measureText(version).width, 570);

  return toTexture(canvas);
}

export function createCardBackTexture(agentData: AgentData): THREE.CanvasTexture {
  const { canvas, ctx } = baseTexture('#0a0a0a');
  const left = 70;
  const right = canvas.width - 70;
  const width = right - left;

  ctx.fillStyle = '#555555';
  ctx.font = '600 26px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('SKILLS', left, 105);

  const tags = Array.from(new Set(agentData.skills.flatMap((skill) => skill.tags))).slice(0, 8);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '400 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  tags.forEach((tag, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    ctx.fillText(tag, left + column * (width / 2), 170 + row * 52);
  });

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, 365);
  ctx.lineTo(right, 365);
  ctx.stroke();

  const caps: string[] = [];
  if (agentData.capabilities?.streaming) caps.push('Streaming');
  if (agentData.capabilities?.pushNotifications) caps.push('Push');
  if (agentData.capabilities?.stateTransitionHistory) caps.push('History');

  ctx.fillStyle = '#666666';
  ctx.font = '400 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  if (caps.length > 0) ctx.fillText(caps.join('  /  '), left, 430);

  if (agentData.provider?.organization) {
    ctx.fillStyle = '#777777';
    ctx.font = '400 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(agentData.provider.organization, left, 505);
  }

  ctx.fillStyle = '#333333';
  ctx.font = '400 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const brand = 'newtype-ai.org';
  ctx.fillText(brand, right - ctx.measureText(brand).width, 570);

  return toTexture(canvas);
}
