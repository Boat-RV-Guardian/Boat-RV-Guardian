import { describe, it, expect, vi } from 'vitest';
import { drawFlowChart, type FlowData } from './flowChart';

// jsdom has no real 2D canvas, so we stand in a stub context that records which drawing calls were
// made. That's enough to assert the branch behavior (placeholder vs. full chart) without pixels.
function makeCanvas(ctx: any, width = 300, height = 180) {
  return {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function stubCtx() {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    // assignable style props
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 0, lineJoin: '', lineCap: '',
  };
}

describe('drawFlowChart', () => {
  it('does nothing and does not throw when there is no 2D context', () => {
    const canvas = makeCanvas(null);
    expect(() => drawFlowChart(canvas, [], 'metric')).not.toThrow();
  });

  it('renders the placeholder (and no line) when there are fewer than 2 points', () => {
    const ctx = stubCtx();
    drawFlowChart(makeCanvas(ctx), [{ ts: 1, speed: 5 }], 'metric');

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('Awaiting flow rate data logs...', 150, 90);
    expect(ctx.stroke).not.toHaveBeenCalled(); // early return before drawing the line
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('draws the line, gradient, and last-point dot with >= 2 points', () => {
    const ctx = stubCtx();
    const history: FlowData[] = [
      { ts: 1, speed: 2 },
      { ts: 2, speed: 8 },
      { ts: 3, speed: 4 },
    ];
    drawFlowChart(makeCanvas(ctx), history, 'metric');

    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();        // grid + path strokes
    expect(ctx.arc).toHaveBeenCalledTimes(1);     // single dot on the last point
    expect(ctx.closePath).toHaveBeenCalled();     // filled area under the line
  });

  it('converts to gal/min in imperial mode (no throw, draws chart)', () => {
    const ctx = stubCtx();
    drawFlowChart(makeCanvas(ctx), [{ ts: 1, speed: 10 }, { ts: 2, speed: 20 }], 'imperial');
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(1);
  });
});
