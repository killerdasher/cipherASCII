// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Slider, sliderFillPercent } from '../../src/components/Slider';

describe('sliderFillPercent', () => {
  it('normalises the value inside the range', () => {
    expect(sliderFillPercent(0, 0, 100)).toBe(0);
    expect(sliderFillPercent(50, 0, 100)).toBe(50);
    expect(sliderFillPercent(100, 0, 100)).toBe(100);
    expect(sliderFillPercent(0.5, 0, 1)).toBe(50);
  });

  it('clamps values outside the range', () => {
    expect(sliderFillPercent(-10, 0, 100)).toBe(0);
    expect(sliderFillPercent(130, 0, 100)).toBe(100);
    expect(sliderFillPercent(-10, -10, 10)).toBe(0);
  });

  it('degenerates to 0 for empty or non-finite ranges', () => {
    expect(sliderFillPercent(5, 10, 10)).toBe(0);
    expect(sliderFillPercent(5, 10, 0)).toBe(0);
    expect(sliderFillPercent(Number.NaN, 0, 100)).toBe(0);
  });
});

describe('<Slider />', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(element);
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('links the visible label to the native input and shows the display text', async () => {
    await render(
      <Slider label="Columns" value={240} min={1} max={500} step={1} onChange={() => {}} />,
    );
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    const label = container.querySelector('label.slider-label') as HTMLLabelElement;
    expect(input).toBeTruthy();
    expect(label).toBeTruthy();
    expect(label.htmlFor).toBe(input.id);
    expect(input.value).toBe('240');
    expect(container.querySelector('.slider-value')?.textContent).toBe('240');
    expect(label.textContent).toBe('Columns');
  });

  it('paints the normalised fill through the --pct custom property', async () => {
    await render(<Slider label="Density" value={0.25} min={0.25} max={4} onChange={() => {}} />);
    const wrapper = container.querySelector('.slider') as HTMLElement;
    expect(wrapper.style.getPropertyValue('--pct')).toBe('0%');
    await render(<Slider label="Density" value={4} min={0.25} max={4} onChange={() => {}} />);
    expect(wrapper.style.getPropertyValue('--pct')).toBe('100%');
  });

  it('emits numbers on change, not strings', async () => {
    const seen: number[] = [];
    await render(
      <Slider label="Gamma" value={1} min={0.2} max={3} step={0.05} onChange={(v) => seen.push(v)} />,
    );
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    // Bypass React's instance value tracker so the dispatched event counts as a change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '2.5');
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(2.5);
  });

  it('hides the label in compact variant but keeps it as the aria-label', async () => {
    await render(
      <Slider variant="compact" label="blur intensity" value={0.5} min={0} max={1} display="50%" onChange={() => {}} />,
    );
    expect(container.querySelector('label')).toBeNull();
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('blur intensity');
    expect(container.querySelector('.slider-value')?.textContent).toBe('50%');
    expect(container.querySelector('.slider')?.classList.contains('slider--compact')).toBe(true);
  });
});
