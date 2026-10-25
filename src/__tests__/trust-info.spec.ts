import { BESIDE_FILE, trustInfo } from '../trust-info';

/** A page that asks for a little of everything the dialog lists. */
const PAGE = `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://fonts.example.com/a.css">
<link rel="icon" href="favicon.ico">
<link rel="canonical" href="https://canonical.example.org/">
<script src="https://cdn.example.net/lib.js">navigator.clipboard</script>
<script src="present.js"></script>
<script>history.replaceState(null, '', '#1'); fetch('/api');</script>
<style>body { background: url("https://images.example.com/bg.png"); }</style>
</head><body>
<img alt="" srcset="https://img.example.com/a.png 1x, data:image/png;base64,AAAA 2x, small.png 3x">
<p style="background-image: url(//styles.example.com/p.png)">The page names localStorage in its text.</p>
<button onclick="window.open('x')">Open</button>
<iframe src="https://frame.example.org/embed"></iframe>
</body></html>
`;

describe('what the More info dialog lists about a page', () => {
  it('ACC-VIEW-97 counts the script elements without src and the event handler attributes', () => {
    expect(trustInfo(PAGE).inlineScripts).toBe(2);
  });

  it('ACC-VIEW-97 lists the address of each script file as written', () => {
    expect(trustInfo(PAGE).scriptFiles).toEqual([
      'https://cdn.example.net/lib.js',
      'present.js'
    ]);
  });

  it('ACC-VIEW-97 lists the other hosts from link, srcset, url() in style text and iframe', () => {
    expect(trustInfo(PAGE).hosts).toEqual([
      'fonts.example.com',
      BESIDE_FILE,
      'images.example.com',
      'img.example.com',
      'styles.example.com',
      'frame.example.org'
    ]);
  });

  it('ACC-VIEW-97 lists object, embed, audio, video and source loads', () => {
    const { hosts } = trustInfo(`<!DOCTYPE html>
<object data="https://objects.example.com/a.pdf"></object>
<embed src="https://embeds.example.com/a.svg">
<audio src="https://sound.example.com/a.ogg"></audio>
<video poster="https://posters.example.com/a.jpg"><source src="https://video.example.com/a.webm"></video>
`);
    expect(hosts).toEqual([
      'objects.example.com',
      'embeds.example.com',
      'sound.example.com',
      'posters.example.com',
      'video.example.com'
    ]);
  });

  it('ACC-VIEW-97 names a relative address this lab, beside the file', () => {
    const { hosts } = trustInfo(`<!DOCTYPE html>
<img src="pictures/a.png"><img src="../b.png"><img src="/files/c.png">
<img src="//other.example.com/d.png">
`);
    expect(hosts).toEqual([BESIDE_FILE, 'other.example.com']);
  });

  it('ACC-VIEW-97 names the features found in the inline script text only', () => {
    const { features } = trustInfo(PAGE);
    // Found: the inline script and the onclick attribute name them.
    expect(features).toContain('history (the page address)');
    expect(features).toContain('network requests');
    expect(features).toContain('pop-up windows');
    // Missed: storage is named in the page's text, the clipboard only inside
    // a script element with src, whose text the browser never runs.
    expect(features).not.toContain('storage and cookies');
    expect(features).not.toContain('clipboard');
  });

  it('ACC-VIEW-97 finds the lab window through parent, top or opener, and not a box edge', () => {
    expect(
      trustInfo('<script>parent.postMessage("x", "*");</script>').features
    ).toEqual(['the lab window, through parent, top or opener']);
    expect(
      trustInfo('<script>box.style.top = rect.top + "px";</script>').features
    ).toEqual([]);
  });

  it('ACC-VIEW-97 reads the HTML of an iframe srcdoc, nested ones too, into the same listing', () => {
    expect(
      trustInfo(`<!DOCTYPE html>
<iframe srcdoc="<script src='https://framed.example.com/inner.js'></script><script>sessionStorage.x = 1;</script><img src='https://pictures.example.com/a.png'><iframe srcdoc='&lt;script&gt;fetch(1)&lt;/script&gt;'></iframe>"></iframe>
`)
    ).toEqual({
      inlineScripts: 2,
      scriptFiles: ['https://framed.example.com/inner.js'],
      hosts: ['pictures.example.com'],
      features: ['storage and cookies', 'network requests']
    });
  });

  it('ACC-VIEW-97 counts each javascript: URL as an inline script and searches its text', () => {
    const info = trustInfo(`<!DOCTYPE html>
<a href="javascript:history.back()">Back</a>
<iframe src=" Java&#9;Script:parent.document"></iframe>
<form action="javascript:fetch('/x')"><button formaction="javascript:void 0">Go</button></form>
<object data="javascript:localStorage.clear()"></object>
<a href="https://site.example.com/javascript:no">Not a script</a>
`);
    expect(info.inlineScripts).toBe(5);
    expect(info.hosts).toEqual([]);
    expect(info.features).toEqual([
      'history (the page address)',
      'storage and cookies',
      'network requests',
      'the lab window, through parent, top or opener'
    ]);
  });

  it('ACC-VIEW-97 lists the href and xlink:href of an SVG script as a script file', () => {
    const info = trustInfo(`<!DOCTYPE html>
<svg><script href="https://svg.example.com/a.js"></script><script xlink:href="drawing.js"></script><script>top.name</script></svg>
`);
    expect(info.scriptFiles).toEqual([
      'https://svg.example.com/a.js',
      'drawing.js'
    ]);
    expect(info.inlineScripts).toBe(1);
  });

  it('ACC-VIEW-97 lists the hosts of link preload, modulepreload, prefetch and manifest, and of the background attribute', () => {
    expect(
      trustInfo(`<!DOCTYPE html>
<link rel="preload" href="https://preload.example.com/a.woff2" as="font">
<link rel="modulepreload" href="https://modules.example.com/m.js">
<link rel="prefetch" href="https://prefetch.example.com/next.html">
<link rel="manifest" href="app.webmanifest">
<body background="https://backgrounds.example.com/b.png">
<table background="//tables.example.com/t.png"></table>
`).hosts
    ).toEqual([
      'preload.example.com',
      'modules.example.com',
      'prefetch.example.com',
      BESIDE_FILE,
      'backgrounds.example.com',
      'tables.example.com'
    ]);
  });

  it('ACC-VIEW-97 returns empty parts for a page that asks for nothing', () => {
    expect(trustInfo('<!DOCTYPE html>\n<p>Nothing.</p>\n')).toEqual({
      inlineScripts: 0,
      scriptFiles: [],
      hosts: [],
      features: []
    });
  });
});
