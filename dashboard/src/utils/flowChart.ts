// Flow-rate sparkline rendering, extracted from LinkTapWidget's canvas useEffect.
//
// Pure drawing: given a canvas and the recent flow samples, render the line chart (or an
// "awaiting data" placeholder when there aren't enough points). Imperial mode converts L/min to
// gal/min for display. No component state or refs involved, so it lives here and is unit-tested
// against a stub 2D context. Behavior is unchanged from the original inline version.

export interface FlowData {
  ts: number; // epoch ms (UTC)
  speed: number;
}

export function drawFlowChart(
  canvas: HTMLCanvasElement,
  flowHistory: FlowData[],
  unitSystem: 'metric' | 'imperial',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Responsive Canvas dimensions
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width;
  canvas.height = height;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  if (flowHistory.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Outfit';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting flow rate data logs...', width / 2, height / 2);
    return;
  }

  // Find min and max
  const displayHistory = flowHistory.map(d => ({ ...d, speed: unitSystem === 'imperial' ? d.speed * 0.264172 : d.speed }));
  const maxVal = Math.max(10, ...displayHistory.map((d) => d.speed * 1.2));

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();

    // y-axis values
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(((maxVal / 4) * (4 - i)).toFixed(1), 10, y + 3);
  }

  // Render path
  const paddingLeft = 40;
  const paddingRight = 20;
  const graphWidth = width - paddingLeft - paddingRight;

  ctx.beginPath();
  displayHistory.forEach((pt, idx) => {
    const x = paddingLeft + (idx / (flowHistory.length - 1)) * graphWidth;
    const y = height - (pt.speed / maxVal) * (height - 20) - 10;

    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  // Stroke style
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#00f2fe');
  gradient.addColorStop(1, '#0052d4');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Fill underneath the graph line
  ctx.lineTo(paddingLeft + graphWidth, height - 10);
  ctx.lineTo(paddingLeft, height - 10);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 242, 254, 0.06)';
  ctx.fill();

  // Label last data point
  const lastPoint = displayHistory[displayHistory.length - 1];
  const lastX = paddingLeft + graphWidth;
  const lastY = height - (lastPoint.speed / maxVal) * (height - 20) - 10;

  ctx.fillStyle = '#00f2fe';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fill();
}
