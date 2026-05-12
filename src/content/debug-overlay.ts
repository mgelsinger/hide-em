const OVERLAY_ID = 'he-debug-overlay';

export class DebugOverlay {
  private el: HTMLElement | null = null;
  private visible = false;

  show(): void {
    this.visible = true;
    this.getOrCreate().style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    if (this.el) this.el.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide(); else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(scanned: number, hidden: number, batchMs: number): void {
    const el = this.getOrCreate();
    const time = new Date().toLocaleTimeString();
    el.textContent =
      `hide-em | scanned: ${scanned} | hidden: ${hidden} | batch: ${batchMs.toFixed(1)}ms | ${time}`;
    if (!this.visible) el.style.display = 'none';
  }

  private getOrCreate(): HTMLElement {
    if (this.el) return this.el;
    const existing = document.getElementById(OVERLAY_ID);
    if (existing instanceof HTMLElement) {
      this.el = existing;
      return this.el;
    }
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.82)',
      color: '#4eff91',
      fontFamily: 'monospace',
      fontSize: '11px',
      lineHeight: '1.4',
      padding: '4px 8px',
      borderRadius: '3px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      userSelect: 'none',
    });
    el.style.display = 'none';
    document.documentElement.appendChild(el);
    this.el = el;
    return el;
  }
}
