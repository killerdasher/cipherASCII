// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NewProjectModal } from '../../src/components/NewProjectModal';
import type { Document } from '../../src/core/types';

describe('<NewProjectModal /> launch picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(element);
    });
  };

  const cards = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('.preset-card'));
  const cardNamed = (title: string) =>
    cards().find((c) => c.textContent?.includes(title));

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

  it('is open at launch, before the user does anything', async () => {
    await render(<NewProjectModal onCreate={() => {}} />);
    expect(container.querySelector('.project-modal')).toBeTruthy();
    expect(cards().length).toBeGreaterThanOrEqual(8);
    expect(cardNamed('Web Banner')).toBeTruthy();
    expect(cardNamed('Ad Leaderboard')).toBeTruthy();
    expect(cardNamed('TikTok / Reels')).toBeTruthy();
    expect(cardNamed('Instagram Portrait')).toBeTruthy();
    expect(cardNamed('YouTube Thumbnail')).toBeTruthy();
  });

  it('applies the clicked ratio to name, width and height', async () => {
    await render(<NewProjectModal onCreate={() => {}} />);
    await act(async () => {
      cardNamed('Web Banner')!.click();
    });
    const inputs = container.querySelectorAll<HTMLInputElement>('.preset-custom-row input');
    expect(inputs[0].value).toBe('Web Banner'); // name
    expect(inputs[1].value).toBe('90'); // columns (720 px)
    expect(inputs[2].value).toBe('19'); // rows (300 px)
  });

  it('creates a document with the selected preset footprint', async () => {
    const onCreate = vi.fn();
    await render(<NewProjectModal onCreate={onCreate} />);
    await act(async () => {
      cardNamed('Ad Leaderboard')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.modal-actions .primary')!.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const doc = onCreate.mock.calls[0][0] as Document;
    expect(doc.canvas.width).toBe(91);
    expect(doc.canvas.height).toBe(6);
    expect(doc.imageSettings.columns).toBe(91);
    expect(doc.metadata.name).toBe('Ad Leaderboard');
    // Modal closes after creating.
    expect(container.querySelector('.project-modal')).toBeNull();
  });

  it('closes on Escape without creating anything', async () => {
    const onCreate = vi.fn();
    await render(<NewProjectModal onCreate={onCreate} />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.project-modal')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    // The toolbar trigger reopens the picker.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.modal-trigger')!.click();
    });
    expect(container.querySelector('.project-modal')).toBeTruthy();
  });
});
