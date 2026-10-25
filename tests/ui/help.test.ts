import { describe, it, expect } from 'vitest';
import { HELP_ITEMS, isHelpKey, renderHelpHtml } from '../../src/ui/help';

describe('help overlay', () => {
  it('toggles on ? but not while typing', () => {
    expect(isHelpKey('?')).toBe(true);
    expect(isHelpKey('?', 'DIV')).toBe(true);
    expect(isHelpKey('?', 'INPUT')).toBe(false);
    expect(isHelpKey('h')).toBe(false);
  });
  it('lists every control and escapes html', () => {
    const html = renderHelpHtml();
    for (const i of HELP_ITEMS) expect(html).toContain(i.does);
    expect(renderHelpHtml([{ keys: '<b>', does: 'x & y' }])).toContain('&lt;b&gt;');
    expect(renderHelpHtml([{ keys: '<b>', does: 'x & y' }])).toContain('x &amp; y');
  });
});
