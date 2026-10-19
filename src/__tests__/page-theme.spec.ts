import {
  applyPageTheme,
  PAGE_THEME_STYLE_ID,
  pageThemeCss,
  pageThemeStyle
} from '../page-theme';

/**
 * Replace the computed style of the host body for one test. The lab's theme
 * variables are not part of jsdom's cascade, so the module is given the values
 * the lab would carry.
 */
function stubComputed(values: Record<string, string>): void {
  jest.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => values[name] ?? ''
  } as unknown as CSSStyleDeclaration);
}

describe('page theme', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives the light fallbacks where the theme defines no scrollbar colours', () => {
    stubComputed({});
    const style = pageThemeStyle();
    expect(style).toContain(`id="${PAGE_THEME_STYLE_ID}"`);
    expect(style).toContain(
      'scrollbar-color: rgb(205, 205, 205) #f0f0f0 !important'
    );
    expect(style).toContain('background: #f0f0f0 !important');
    expect(style).toContain('background: rgb(205, 205, 205) !important');
    expect(style).toContain('border: 3.5px solid transparent !important');
    expect(style).toContain('border-radius: 9px !important');
    const declarations = style
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.endsWith(';'));
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration).toContain('!important');
    }
  });

  it('takes the dark theme values', () => {
    stubComputed({
      '--jp-scrollbar-thumb-color': '104, 112, 114',
      '--jp-scrollbar-background-color': '#3f4244',
      '--jp-scrollbar-thumb-margin': '3.5px',
      '--jp-scrollbar-thumb-radius': '9px'
    });
    const css = pageThemeCss();
    expect(css).toContain(
      'scrollbar-color: rgb(104, 112, 114) #3f4244 !important'
    );
    expect(css).toContain('background: rgb(104, 112, 114) !important');
    expect(css).toContain('background: #3f4244 !important');
    expect(css).toContain('border: 3.5px solid transparent !important');
    expect(css).toContain('background-clip: content-box !important');
    expect(css).toContain('border-radius: 9px !important');
  });

  it('adds the style element once, then keeps it and replaces its text', () => {
    stubComputed({});
    const doc = document.implementation.createHTMLDocument('page');
    applyPageTheme(doc);
    const style = doc.getElementById(PAGE_THEME_STYLE_ID) as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(style.textContent).toBe(pageThemeCss());

    style.textContent = 'old';
    applyPageTheme(doc);
    expect(doc.getElementById(PAGE_THEME_STYLE_ID)).toBe(style);
    expect(style.textContent).toBe(pageThemeCss());
  });
});
