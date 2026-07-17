// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { collectBoundedText, findHideTarget, isHideTargetElement } from './scanner-targets.js';

describe('scanner targets', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('selects semantic cards without selecting broad sections', () => {
    document.body.innerHTML = '<section><article><span id="text">blocked</span></article></section>';
    const text = document.getElementById('text');
    const article = document.querySelector('article');
    const section = document.querySelector('section');
    expect(findHideTarget(text)).toBe(article);
    expect(isHideTargetElement(section!)).toBe(false);
  });

  it('recognizes ARIA list items, custom renderers, and conservative card classes', () => {
    document.body.innerHTML = `
      <div role="listitem" id="aria"><span></span></div>
      <ytd-video-renderer id="custom"><span></span></ytd-video-renderer>
      <div class="stream-item" id="generic"><span></span></div>
    `;
    expect(isHideTargetElement(document.getElementById('aria')!)).toBe(true);
    expect(isHideTargetElement(document.getElementById('custom')!)).toBe(true);
    expect(isHideTargetElement(document.getElementById('generic')!)).toBe(true);
  });

  it('does not treat an arbitrary item-like class as a card', () => {
    document.body.innerHTML = '<div class="menu-itemish" data-testid="postcard-controls" id="menu"></div>';
    expect(isHideTargetElement(document.getElementById('menu')!)).toBe(false);
  });

  it('collects phrases split across nested elements', () => {
    document.body.innerHTML = '<article id="card"><span>daily</span><strong>news</strong><button><span>ignored control</span></button></article>';
    expect(collectBoundedText(document.getElementById('card')!, 100)).toBe('daily news');
  });

  it('abandons aggregate scanning when card text exceeds the limit', () => {
    document.body.innerHTML = `<article id="card">${'a'.repeat(101)}</article>`;
    expect(collectBoundedText(document.getElementById('card')!, 100)).toBeNull();
  });

  it('ignores nested editable text', () => {
    document.body.innerHTML = '<article id="card">visible <div contenteditable="true"><span>private draft</span></div></article>';
    expect(collectBoundedText(document.getElementById('card')!, 100)).toBe('visible ');
  });
});
