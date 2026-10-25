// Home key (Lumi): press "h" to fly back to the Sun from anywhere, the way
// Google Earth's home button snaps back to a familiar view.

export const HOME_ID = 'star:sol:sun';

/** True when a keydown should fly home (ignores typing and Ctrl/Cmd/Alt combos). */
export function isHomeKey(
  key: string,
  targetTag?: string,
  editable = false,
  modified = false,
): boolean {
  if (editable || modified) return false;
  if (targetTag && /^(INPUT|TEXTAREA|SELECT)$/i.test(targetTag)) return false;
  return key === 'h' || key === 'H';
}

/** Listens for the home key and calls goHome(HOME_ID). Returns an unsubscribe function. */
export function mountHomeKey(goHome: (id: string) => void, doc: Document = document): () => void {
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat || ev.defaultPrevented) return; // held key, or already handled
    const el = ev.target as HTMLElement | null;
    const modified = ev.ctrlKey || ev.metaKey || ev.altKey;
    if (isHomeKey(ev.key, el?.tagName, el?.isContentEditable === true, modified)) {
      ev.preventDefault();
      goHome(HOME_ID);
    }
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}
