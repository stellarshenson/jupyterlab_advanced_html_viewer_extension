/**
 * The More info dialog beside the trust controls (ACC-VIEW-97): what trust
 * allows, and what the file asks for, read from its text with the parser the
 * viewer uses. Nothing of the page runs, and the dialog changes nothing.
 */

import { Dialog, showDialog } from '@jupyterlab/apputils';
import type { TranslationBundle } from '@jupyterlab/translation';
import { html as p5 } from 'parse5';
import * as React from 'react';

import { parseDocument } from './parse';
import { allElements } from './source';

/** The host of a relative address: the folder of the file, in this lab. */
export const BESIDE_FILE = 'this lab, beside the file';

/**
 * The browser features looked for in the inline script text, by name. A text
 * search: it misses a name built at run time, and finds one in a comment.
 */
const FEATURES: ReadonlyArray<[string, RegExp]> = [
  ['history (the page address)', /\bhistory\b/],
  [
    'storage and cookies',
    /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|cookie)\b/
  ],
  [
    'network requests',
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/
  ],
  ['pop-up windows', /\bwindow\.open\b|(?<![\w$.])open\s*\(/],
  [
    'the lab window, through parent, top or opener',
    /\bwindow\.(?:parent|top|opener)\b|(?<![\w$.])(?:parent|top|opener)\s*\./
  ],
  ['clipboard', /clipboard|execCommand/i]
];

/** What a page asks for, as the dialog lists it. */
export interface ITrustInfo {
  /** Script elements without src, event handler attributes, and javascript: addresses. */
  inlineScripts: number;
  /** The src of each script element that has one, as written. */
  scriptFiles: string[];
  /** Every host the page loads anything else from, in file order. */
  hosts: string[];
  /** The features of the table named in the inline script text. */
  features: string[];
}

/** An address in url() or an @import of style text. */
const STYLE_ADDRESS =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;

/** Where an address loads from: a host, BESIDE_FILE, or null for none. */
function hostOf(address: string): string | null {
  if (!address.trim()) {
    return null;
  }
  try {
    const url = new URL(address.trim(), 'https://lab.invalid/');
    return url.host === 'lab.invalid' ? BESIDE_FILE : url.host || null;
  } catch {
    return null;
  }
}

/** The attributes whose javascript: URL runs as a script. */
const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'data'];

/** The link relations that load from the address in href. */
const LOADING_RELS = [
  'stylesheet',
  'preload',
  'modulepreload',
  'prefetch',
  'manifest'
];

/**
 * The code of a javascript: URL, its scheme read as the URL parser reads it;
 * null for any other address.
 */
function scriptOf(address: string): string | null {
  try {
    const url = new URL(address, 'https://lab.invalid/');
    return url.protocol === 'javascript:'
      ? url.href.slice('javascript:'.length)
      : null;
  } catch {
    return null;
  }
}

/** The addresses of a srcset: each candidate's first word, commas trimmed. */
function srcsetAddresses(value: string): string[] {
  const found: string[] = [];
  const word = /[\s,]*(\S+)/g;
  for (let match = word.exec(value); match; match = word.exec(value)) {
    const address = match[1].replace(/,+$/, '');
    if (address) {
      found.push(address);
    }
    if (address === match[1]) {
      // The descriptors run to the next comma.
      const comma = value.indexOf(',', word.lastIndex);
      word.lastIndex = comma < 0 ? value.length : comma + 1;
    }
  }
  return found;
}

// shortcut: not read are image-set() strings without url(), the href of SVG image, use and feImage, meta refresh, a ping, and the addresses a script asks for as it runs (a module's import, a fetch); read each when a page is found that loads from one.
/** What the page in a file text asks for, read without running it. */
export function trustInfo(source: string): ITrustInfo {
  let inlineScripts = 0;
  const scriptFiles = new Set<string>();
  const hosts = new Set<string>();
  const code: string[] = [];
  const load = (address: string): void => {
    const host = hostOf(address);
    if (host) {
      hosts.add(host);
    }
  };
  const styleText = (text: string): void => {
    STYLE_ADDRESS.lastIndex = 0;
    for (
      let match = STYLE_ADDRESS.exec(text);
      match;
      match = STYLE_ADDRESS.exec(text)
    ) {
      load(match.slice(1).find(each => each !== undefined) ?? '');
    }
  };
  // An iframe srcdoc is HTML the page shows: its text is read the same way.
  const read = (html: string): void => {
    for (const element of allElements(parseDocument(html, false))) {
      const tag = element.tagName;
      const attribute = (name: string): string | undefined =>
        element.attrs.find(each => each.name === name)?.value;
      const text = (): string =>
        element.childNodes
          .map(child => ('value' in child ? child.value : ''))
          .join('');
      for (const { name, value } of element.attrs) {
        const run = URL_ATTRIBUTES.includes(name) ? scriptOf(value) : null;
        if (name.startsWith('on') || run !== null) {
          inlineScripts++;
          code.push(run ?? value);
        } else if (name === 'srcdoc' && tag === 'iframe') {
          read(value);
        } else if (name === 'srcset') {
          srcsetAddresses(value).forEach(load);
        } else if (name === 'style') {
          styleText(value);
        } else if (
          (name === 'src' && tag !== 'script') ||
          (name === 'data' && tag === 'object') ||
          (name === 'poster' && tag === 'video') ||
          name === 'background'
        ) {
          load(value);
        } else if (
          name === 'href' &&
          tag === 'link' &&
          (attribute('rel') ?? '')
            .toLowerCase()
            .split(/\s+/)
            .some(rel => LOADING_RELS.includes(rel) || rel.endsWith('icon'))
        ) {
          load(value);
        }
      }
      if (tag === 'script') {
        // An SVG script names its file in href, or in xlink:href where it
        // has no href; parse5 names both href.
        const hrefs = element.attrs.filter(each => each.name === 'href');
        const src =
          element.namespaceURI === p5.NS.SVG
            ? (hrefs.find(each => !each.prefix) ?? hrefs[0])?.value
            : attribute('src');
        if (src === undefined) {
          inlineScripts++;
          code.push(text());
        } else {
          scriptFiles.add(src);
        }
      } else if (tag === 'style') {
        styleText(text());
      }
    }
  };
  read(source);
  const scripts = code.join('\n');
  return {
    inlineScripts,
    scriptFiles: [...scriptFiles],
    hosts: [...hosts],
    features: FEATURES.filter(([, named]) => named.test(scripts)).map(
      ([feature]) => feature
    )
  };
}

/** Show the dialog for a file text. */
export async function showTrustInfo(
  source: string,
  trans: TranslationBundle
): Promise<void> {
  const info = trustInfo(source);
  const h = React.createElement;
  const list = (items: string[]): React.ReactElement =>
    items.length
      ? h(
          'ul',
          null,
          items.map(item => h('li', { key: item }, item))
        )
      : h('p', null, trans.__('none'));
  const body = h(
    'div',
    { className: 'jp-AdvancedHtml-trustInfo' },
    h('h3', null, trans.__('What trusting this page allows')),
    h(
      'ul',
      null,
      h(
        'li',
        null,
        trans.__(
          "Its scripts can read and change this lab with your access, such as your files and your kernels: the frame then has allow-scripts and allow-same-origin, and the blob: address the lab made for the page has the lab's origin."
        )
      ),
      h('li', null, trans.__("The page's scripts run.")),
      h('li', null, trans.__('It may open pop-up windows.'))
    ),
    h('h3', null, trans.__('Scripts')),
    h(
      'p',
      null,
      info.inlineScripts
        ? trans.__(
            'Inline scripts: %1 (script elements without src, event handler attributes such as onclick, and javascript: addresses)',
            info.inlineScripts
          )
        : trans.__('Inline scripts: none')
    ),
    h('p', null, trans.__('Script files:')),
    list(info.scriptFiles),
    h('h3', null, trans.__('Other hosts the page loads from')),
    list(info.hosts),
    h('h3', null, trans.__('Browser features named in the inline scripts')),
    h(
      'p',
      null,
      trans.__(
        'These are found by text search, which can miss a feature or name one that is never used.'
      )
    ),
    list(info.features)
  );
  await showDialog({
    title: trans.__('More info: trusting this page'),
    body,
    buttons: [Dialog.okButton({ label: trans.__('Close') })]
  });
}
