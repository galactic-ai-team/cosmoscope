// Help overlay (Lumi): press "?" (or click the ? button) to see how to get around.

export interface HelpItem { keys: string; does: string }

export const HELP_ITEMS: readonly HelpItem[] = [
  { keys: 'Drag', does: 'Look around (orbit the view)' },
  { keys: 'Scroll / pinch', does: 'Zoom in and out through the scales' },
  { keys: 'Arrow keys', does: 'Orbit with the keyboard' },
  { keys: '+ / -', does: 'Zoom with the keyboard' },
  { keys: '/', does: 'Jump to search' },
  { keys: 'Enter', does: 'Fly to the highlighted search result' },
  { keys: 'Grab the view', does: 'Stop a flight or the Grand Tour' },
  { keys: 'C', does: 'Constellation lines: Auto / On / Off' },
  { keys: '?', does: 'Show or hide this help' },
  { keys: 'Esc', does: 'Close this help' },
];

/** True when a keydown should toggle help (ignores typing in inputs). */
export function isHelpKey(key: string, targetTag?: string, editable = false): boolean {
  if (editable) return false; // contenteditable (GPT-6's review)
  if (targetTag && /^(INPUT|TEXTAREA|SELECT)$/i.test(targetTag)) return false;
  return key === '?';
}

export function renderHelpHtml(items: readonly HelpItem[] = HELP_ITEMS): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const rows = items.map((i) => `<tr><th scope="row">${esc(i.keys)}</th><td>${esc(i.does)}</td></tr>`).join('');
  return `<h2>Getting around</h2><table>${rows}</table><p>Data: NASA/JPL, HYG v4.1, galaxy catalogs. Built by the AI Playground team.</p>`;
}

/** Mounts the overlay and a small ? button. Returns a toggle for tests and callers. */
export function mountHelp(doc: Document = document): { toggle(open?: boolean): boolean } {
  const panel = doc.createElement('div');
  panel.id = 'help';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Help');
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.style.cssText = 'position:fixed;z-index:20;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'background:#0b1024ee;border:1px solid #3a4a7a;border-radius:12px;padding:16px 20px;max-width:90vw;'
    + 'font-size:14px;line-height:1.5';
  panel.innerHTML = renderHelpHtml();
  const btn = doc.createElement('button');
  btn.id = 'help-btn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Help');
  btn.style.cssText = 'position:fixed;z-index:6;top:16px;right:16px;width:34px;height:34px;border-radius:50%;'
    + 'background:#0b1024cc;color:#dfe8ff;border:1px solid #3a4a7a;font-size:16px;cursor:pointer';
  doc.body.append(panel, btn);
  let returnFocus: HTMLElement | null = null;
  const toggle = (open?: boolean): boolean => {
    const wasOpen = !panel.hidden;
    panel.hidden = !(open ?? panel.hidden);
    btn.setAttribute('aria-expanded', String(!panel.hidden));
    // Move focus into the dialog on open and restore it on close (GPT-6's review).
    if (!wasOpen && !panel.hidden) {
      returnFocus = doc.activeElement as HTMLElement | null;
      panel.focus();
    } else if (wasOpen && panel.hidden) {
      returnFocus?.focus?.();
      returnFocus = null;
    }
    return !panel.hidden;
  };
  btn.addEventListener('click', () => toggle());
  doc.addEventListener('keydown', (ev) => {
    const el = ev.target as HTMLElement | null;
    if (isHelpKey(ev.key, el?.tagName, el?.isContentEditable === true)) { ev.preventDefault(); toggle(); }
    else if (ev.key === 'Escape' && !panel.hidden) toggle(false);
  });
  return { toggle };
}
