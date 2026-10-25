import { ChangeAnimator } from '../animate';
import { paint } from '../paint';
import { IPlan, planChange } from '../patch';
import { analyse } from '../source';
import { GENERATED, load, NAMED, page, shape, UNTRUSTED } from './pages';

/** The parts of the CSS Custom Highlight API jsdom lacks. */
class FakeHighlight extends Set<AbstractRange> {
  priority = 0;
  constructor(...ranges: AbstractRange[]) {
    super(ranges);
  }
}

class FakeSheet {
  rules = '';
  replaceSync(rules: string): void {
    this.rules = rules;
  }
}

/**
 * A page open in the viewer: its document, a window that paints it, and the
 * animator, which a new file is planned against and started on as the viewer
 * will do it.
 */
function open(source: string) {
  const { analysis, doc } = load(source);
  const highlights = new Map<string, FakeHighlight>();
  doc.adoptedStyleSheets = [];
  const win = {
    document: doc,
    getComputedStyle: (element: Element) => window.getComputedStyle(element),
    CSS: { highlights },
    Highlight: FakeHighlight,
    CSSStyleSheet: FakeSheet
  } as unknown as Window;
  const animator = new ChangeAnimator(win);
  let shown = analysis;
  const view = {
    doc,
    win,
    highlights,
    animator,
    /** Plan the change to a new file against the page as it is now. */
    plan(next: string): IPlan {
      animator.finish();
      const reading = analyse(next, UNTRUSTED);
      const change = planChange(doc, shown, reading);
      if ('render' in change) {
        throw new Error(`renders: ${change.render}`);
      }
      shown = reading;
      return change;
    },
    /** Plan the change to a new file and start it; the new reading. */
    write(next: string) {
      animator.start(view.plan(next));
      return shown;
    },
    /** The text of the change highlights' stylesheet. */
    rules: () =>
      (doc.adoptedStyleSheets as unknown as FakeSheet[])
        .map(sheet => sheet.rules)
        .join('\n'),
    /** The change highlights on the page, by name, with the text of their ranges. */
    painted: () => {
      const found: Record<string, string[]> = {};
      highlights.forEach((highlight, name) => {
        if (/^jp-ahv-(added|removed)-/.test(name)) {
          found[name] = Array.from(highlight, range => String(range));
        }
      });
      return found;
    }
  };
  return view;
}

/** The percentages each change rule writes: its background and then its strike. */
function strengths(rules: string): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const line of rules.split('\n')) {
    const name = /^::highlight\(([^)]+)\)/.exec(line)?.[1];
    if (name) {
      found[name] = (line.match(/[\d.]+%/g) ?? []).map(parseFloat);
    }
  }
  return found;
}

/**
 * Every node put in or taken out and every text changed, in order, from the
 * records taken since the last call: `+B` a b element put in, `-#text` a text
 * node taken out, `~ab` a text that read `ab` changed.
 */
function watch(doc: Document): () => string[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true
  });
  return () => {
    const log: string[] = [];
    for (const record of observer.takeRecords()) {
      if (record.type === 'characterData') {
        log.push(`~${record.oldValue}`);
      }
      record.removedNodes.forEach(node => log.push(`-${node.nodeName}`));
      record.addedNodes.forEach(node => log.push(`+${node.nodeName}`));
    }
    return log;
  };
}

/** Advance the fake clock to a time since the test began. */
const at = (ms: number): void => {
  jest.advanceTimersByTime(ms - Date.now());
};

const text = (doc: Document, selector = 'p'): string[] =>
  Array.from(doc.querySelectorAll(selector), node => node.textContent ?? '');

beforeEach(() => {
  // Animation frames come every 16 ms from 0.
  jest.useFakeTimers({ now: 0 });
  // The lab theme's two colours, as names the rules must carry through.
  const theme: Record<string, string> = {
    '--jp-success-color1': ' success',
    '--jp-error-color1': ' error'
  };
  jest.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => theme[name] ?? '',
    backgroundColor: ''
  } as unknown as CSSStyleDeclaration);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ACC-ANIM-108 added text is typed in', () => {
  /** Characters of sixty typed after `ms`, every draw of the jitter at `random`. */
  const typed = (random: number, ms: number): number => {
    const view = open(page(['<p></p>']));
    view.animator.random = () => random;
    const start = Date.now();
    view.write(page([`<p>${'x'.repeat(60)}</p>`]));
    at(start + ms);
    const length = text(view.doc)[0].length;
    view.animator.clear();
    return length;
  };

  it('types sixty characters in under a second and a tenth at the defaults', () => {
    // 800 ms even at 75 a second: 600 ms with every draw at its bottom, a
    // quarter less, and 1000 ms with every draw at its top, a quarter more.
    expect(typed(0, 400)).toBe(40);
    expect(typed(0, 592)).toBe(59);
    expect(typed(0, 608)).toBe(60);
    expect(typed(1, 976)).toBe(58);
    expect(typed(1, 1008)).toBe(60);
    expect(typed(1, 1100)).toBe(60);
  });

  it('types at 75 characters a second with every draw at the middle', () => {
    expect(typed(0.5, 416)).toBe(31);
  });

  it('keeps the speed on average over many characters', () => {
    // Draws far either side of the middle, by turns: 600 characters take
    // 8000 ms even.
    const view = open(page(['<p></p>']));
    let i = 0;
    view.animator.random = () => (i++ % 2 ? 0.95 : 0.05);
    view.write(page([`<p>${'x'.repeat(600)}</p>`]));
    at(7904);
    expect(text(view.doc)[0].length).toBeLessThan(600);
    at(8016);
    expect(text(view.doc)[0].length).toBe(600);
  });

  it('types two distant paragraphs at the same time', () => {
    const view = open(page(['<p></p>', '<p>keep</p>', '<p></p>']));
    view.animator.random = () => 0.5;
    view.write(page(['<p>first para</p>', '<p>keep</p>', '<p>other para</p>']));
    at(96);
    expect(text(view.doc)).toEqual(['first p', 'keep', 'other p']);
    at(176);
    expect(text(view.doc)).toEqual(['first para', 'keep', 'other para']);
  });
});

describe('ACC-ANIM-109 removed text warns, then is deleted from its end', () => {
  it('holds 750 ms, then deletes from the end beside the typing', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.animator.random = () => 0.5;
    view.write(page(['<p>keep newer keep</p>']));
    const p = view.doc.querySelector('p')!;
    const removed = p.childNodes[1];
    expect(removed.textContent).toBe('oldword');
    at(48);
    expect(p.textContent).toBe('keep oldwordnew keep');
    at(736);
    expect(p.textContent).toBe('keep oldwordnewer keep');
    at(800);
    expect(p.textContent).toBe('keep oldnewer keep');
    at(880);
    expect(p.textContent).toBe('keep newer keep');
    expect(removed.parentNode).toBeNull();
  });
});

describe('ACC-ANIM-110 a removed element loses its text first, then its tags, innermost first', () => {
  it('takes b out before li, and li before ul', () => {
    const view = open(page(['<p>x</p>', '<ul><li>A <b>bc</b></li></ul>']));
    // A character every 16.7 ms: no frame deletes two.
    view.animator.random = () => 1;
    const log = watch(view.doc);
    const plan = view.plan(page(['<p>x</p>']));
    log();
    view.animator.start(plan);
    at(736);
    expect(log()).toEqual([]);
    at(2000);
    expect(log()).toEqual([
      '~bc',
      '~b',
      '-#text',
      '-B',
      '~A ',
      '~A',
      '-#text',
      '-LI',
      '-UL',
      '-#text'
    ]);
  });

  it('takes an element with no text out when the deletion reaches it', () => {
    const view = open(page(['<p>x</p>', '<p>a<br>b</p>']));
    view.animator.random = () => 1;
    const log = watch(view.doc);
    const plan = view.plan(page(['<p>x</p>']));
    log();
    view.animator.start(plan);
    at(2000);
    expect(log()).toEqual([
      '~b',
      '-#text',
      '-BR',
      '~a',
      '-#text',
      '-P',
      '-#text'
    ]);
  });

  it('takes a removed element holding no text out when the change applies', () => {
    const view = open(page(['<p>x</p>', '<p><img src="a.png"></p>']));
    view.write(page(['<p>x</p>']));
    expect(view.doc.querySelector('img')).toBeNull();
  });
});

describe('ACC-ANIM-118 an added element is inserted empty and typed in, outermost first', () => {
  it('inserts ul, then li, then types, then inserts b', () => {
    const view = open(page(['<p>x</p>']));
    view.animator.random = () => 1;
    const log = watch(view.doc);
    const plan = view.plan(page(['<p>x</p>', '<ul><li>A <b>bc</b></li></ul>']));
    log();
    view.animator.start(plan);
    // The white space before the list goes in whole, then the list.
    expect(log()).toEqual(['+#text', '+UL', '+LI', '+#text']);
    expect(view.doc.querySelector('li')!.outerHTML).toMatch(
      /^<li data-jp-ahv="\d+"><\/li>$/
    );
    at(2000);
    expect(log()).toEqual(['~', '~A', '+B', '+#text', '~', '~b']);
  });

  it('inserts an element with no text when the typing reaches it', () => {
    const view = open(page(['<p>x</p>']));
    view.animator.random = () => 1;
    const log = watch(view.doc);
    const plan = view.plan(page(['<p>x</p>', '<p>a<br>b</p>']));
    log();
    view.animator.start(plan);
    expect(log()).toEqual(['+#text', '+P', '+#text']);
    at(2000);
    expect(log()).toEqual(['~', '+BR', '+#text', '~']);
  });

  it('inserts an added element holding no text when the change applies', () => {
    const view = open(page(['<p>x</p>']));
    view.write(page(['<p>x</p>', '<p><img src="a.png"></p>']));
    expect(view.doc.querySelector('img')).not.toBeNull();
  });
});

describe('ACC-ANIM-111 a change too large to follow lands at once', () => {
  const long = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');

  it('lands an added run over 1000 tokens at once while a short one types', () => {
    const view = open(page(['<p>a</p>', '<p>b</p>']));
    view.write(page([`<p>a ${long}</p>`, '<p>b c</p>']));
    expect(text(view.doc)).toEqual([`a ${long}`, 'b']);
    at(48);
    expect(text(view.doc)).toEqual([`a ${long}`, 'b c']);
  });

  it('takes a removal over 1000 tokens out at once, with no hold', () => {
    const view = open(page([`<p>a ${long}</p>`, '<p>b c d</p>']));
    view.write(page(['<p>a</p>', '<p>b</p>']));
    expect(text(view.doc)).toEqual(['a', 'b c d']);
    at(1008);
    expect(text(view.doc)).toEqual(['a', 'b']);
  });
});

describe('ACC-ANIM-112 a write during an animation completes it, then animates the new one', () => {
  it('completes the running runs, then types the new change', () => {
    const view = open(page(['<p>one old</p>']));
    view.animator.random = () => 1;
    view.write(page(['<p>one new words</p>']));
    at(48);
    const p = view.doc.querySelector('p')!;
    expect(p.textContent).toBe('one oldne');
    const log = watch(view.doc);
    const plan = view.plan(page(['<p>one new words here</p>']));
    // The rest of the typing lands and the waiting removal goes.
    expect(p.textContent).toBe('one new words');
    log();
    view.animator.start(plan);
    at(1000);
    expect(p.textContent).toBe('one new words here');
    // Only the new text is typed: one character a frame.
    expect(log().filter(entry => entry.startsWith('~'))).toEqual([
      '~',
      '~ ',
      '~ h',
      '~ he',
      '~ her'
    ]);
    // The earlier highlights stay, and the new ones join them once risen.
    expect(view.painted()).toEqual({
      'jp-ahv-added-0': ['new words', ' here'],
      'jp-ahv-removed-0': ['']
    });
  });
});

describe('ACC-ANIM-113 animation off shows a change at once', () => {
  it('lands the change whole, and takes the removed text out when its highlight has drained', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.animator.animation = false;
    view.write(page(['<p>keep newer keep</p>']));
    expect(text(view.doc)).toEqual(['keep oldwordnewer keep']);
    at(5488);
    expect(text(view.doc)).toEqual(['keep oldwordnewer keep']);
    expect(strengths(view.rules())['jp-ahv-removed-0'][1]).toBeGreaterThan(0);
    at(5504);
    expect(text(view.doc)).toEqual(['keep newer keep']);
  });

  it('completes the runs in progress on the next frame', () => {
    const view = open(page(['<p>keep oldword keep</p>', '<p>gone soon</p>']));
    view.animator.random = () => 0.5;
    view.write(page(['<p>keep newer keep</p>', '<p>gone</p>']));
    at(800);
    expect(text(view.doc)).toEqual(['keep oldnewer keep', 'gone ']);
    view.animator.animation = false;
    at(816);
    expect(text(view.doc)).toEqual(['keep newer keep', 'gone']);
  });

  it('leaves a removal still whole standing until its highlight has drained', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.write(page(['<p>keep newer keep</p>']));
    at(48);
    view.animator.animation = false;
    at(64);
    expect(text(view.doc)).toEqual(['keep oldwordnewer keep']);
    at(5600);
    expect(text(view.doc)).toEqual(['keep newer keep']);
  });

  it('takes the removed text out at once with no highlight to drain', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.animator.animation = false;
    view.animator.highlight = false;
    view.write(page(['<p>keep newer keep</p>']));
    expect(text(view.doc)).toEqual(['keep newer keep']);
  });
});

describe('ACC-HILITE-114 added text on green, removed text on red and struck', () => {
  it('paints the two theme colours at their strengths, above the marks', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.animator.animation = false;
    view.write(page(['<p>keep newer keep</p>']));
    const reads = (window.getComputedStyle as jest.Mock).mock.calls.length;
    at(1008);
    expect(view.rules().split('\n')).toEqual([
      '::highlight(jp-ahv-added-0) { background-color: color-mix(in srgb, success 35.00%, transparent); }',
      '::highlight(jp-ahv-removed-0) { background-color: color-mix(in srgb, error 31.00%, transparent); text-decoration-line: line-through; text-decoration-color: color-mix(in srgb, currentcolor 100.00%, transparent); }'
    ]);
    expect(view.painted()).toEqual({
      'jp-ahv-added-0': ['newer'],
      'jp-ahv-removed-0': ['oldword']
    });
    expect(view.highlights.get('jp-ahv-added-0')!.priority).toBe(2);
    expect(view.highlights.get('jp-ahv-removed-0')!.priority).toBe(2);
    // The frames read nothing of the lab or the page.
    expect((window.getComputedStyle as jest.Mock).mock.calls.length).toBe(
      reads
    );
  });

  it('paints the colours of the theme the last change read, once the changes paint as one pair', () => {
    const view = open(page(['<p>one</p>']));
    view.animator.animation = false;
    view.write(page(['<p>one two</p>']));
    at(1008);
    // The lab's theme changes between the two changes.
    (window.getComputedStyle as jest.Mock).mockReturnValue({
      getPropertyValue: (name: string) =>
        ({
          '--jp-success-color1': ' dark-success',
          '--jp-error-color1': ' dark-error'
        })[name] ?? '',
      backgroundColor: ''
    });
    view.write(page(['<p>one two three</p>']));
    at(2016);
    expect(view.rules().split('\n')).toEqual([
      '::highlight(jp-ahv-added-0) { background-color: color-mix(in srgb, dark-success 35.00%, transparent); }',
      '::highlight(jp-ahv-removed-0) { background-color: color-mix(in srgb, dark-error 31.00%, transparent); text-decoration-line: line-through; text-decoration-color: color-mix(in srgb, currentcolor 100.00%, transparent); }'
    ]);
    expect(view.painted()['jp-ahv-added-0']).toEqual([' two', ' three']);
  });
});

describe('ACC-HILITE-115 highlights rise, stand and drain', () => {
  it('rises over 500 ms, stands, and drains over the last 750 ms of its life', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    view.animator.animation = false;
    view.write(page(['<p>keep newer keep</p>']));
    const look = () => strengths(view.rules());
    expect(look()).toEqual({
      'jp-ahv-added-0': [0],
      'jp-ahv-removed-0': [0, 0]
    });
    // CSS ease-out at 256 of 500 ms is 0.6974.
    at(256);
    expect(look()).toEqual({
      'jp-ahv-added-0': [24.41],
      'jp-ahv-removed-0': [21.62, 0]
    });
    // The strike follows the rise: ease-out at 12 of 250 ms is 0.0790.
    at(512);
    expect(look()).toEqual({
      'jp-ahv-added-0': [35],
      'jp-ahv-removed-0': [31, 7.9]
    });
    at(752);
    expect(look()['jp-ahv-removed-0']).toEqual([31, 100]);
    at(4736);
    expect(look()['jp-ahv-added-0']).toEqual([35]);
    // The life is 5500 ms; ease-in at 386 of 750 ms is 0.3313.
    at(5136);
    expect(look()).toEqual({
      'jp-ahv-added-0': [23.41],
      'jp-ahv-removed-0': [20.73, 66.88]
    });
    at(5504);
    expect(view.rules()).toBe('');
    expect(view.painted()).toEqual({});
    expect(jest.getTimerCount()).toBe(0);
  });

  it('holds the drain while text still types', () => {
    const view = open(page(['<p></p>']));
    view.animator.random = () => 1;
    view.write(page([`<p>${'x'.repeat(60)}</p>`]));
    // Typed by 1008 ms; the life ends 5500 ms after.
    at(5744);
    expect(strengths(view.rules())['jp-ahv-added-0']).toEqual([35]);
    at(6496);
    expect(strengths(view.rules())['jp-ahv-added-0'][0]).toBeLessThan(2);
    at(6512);
    expect(view.painted()).toEqual({});
  });

  it('drains every change together at the end of the last one', () => {
    const view = open(page(['<p>one</p>']));
    view.animator.animation = false;
    view.write(page(['<p>one two</p>']));
    at(3008);
    view.write(page(['<p>one two three</p>']));
    at(5504);
    // Risen, the two changes paint as one pair.
    expect(strengths(view.rules())).toEqual({
      'jp-ahv-added-0': [35],
      'jp-ahv-removed-0': [31, 100]
    });
    expect(view.painted()['jp-ahv-added-0']).toEqual([' two', ' three']);
    at(3008 + 5136);
    expect(strengths(view.rules())).toEqual({
      'jp-ahv-added-0': [23.41],
      'jp-ahv-removed-0': [20.73, 66.88]
    });
    at(3008 + 5504);
    expect(view.painted()).toEqual({});
  });

  it('paints a file that keeps changing with a bounded set of highlights', () => {
    const view = open(page(['<p>w</p>']));
    view.animator.animation = false;
    let words = '';
    for (let k = 0; k < 50; k++) {
      at(k * 1008);
      words += ` w${k}`;
      view.write(page([`<p>w${words}</p>`]));
      expect(Object.keys(view.painted()).length).toBeLessThanOrEqual(4);
      expect(view.rules().split('\n').length).toBeLessThanOrEqual(4);
    }
    at(50 * 1008);
    expect(Object.keys(view.painted())).toEqual([
      'jp-ahv-added-0',
      'jp-ahv-removed-0'
    ]);
    expect(view.painted()['jp-ahv-added-0'].join('')).toBe(words);
    at(49 * 1008 + 5504);
    expect(view.painted()).toEqual({});
  });

  it('tints text a new page shows as added text, rising and draining as a change does', () => {
    const view = open(page(['<p>new text</p>']));
    const range = view.doc.createRange();
    range.selectNodeContents(view.doc.querySelector('p')!);
    view.animator.tint([range]);
    at(512);
    expect(strengths(view.rules())['jp-ahv-added-0']).toEqual([35]);
    expect(view.painted()['jp-ahv-added-0']).toEqual(['new text']);
    at(5504);
    expect(view.painted()).toEqual({});
  });
});

describe('ACC-HILITE-116 highlighting can be switched off', () => {
  it('paints no change highlight, and the change still types', () => {
    const view = open(page(['<p>one</p>']));
    view.animator.highlight = false;
    view.write(page(['<p>one two</p>']));
    expect(view.painted()).toEqual({});
    expect(text(view.doc)).toEqual(['one']);
    at(1008);
    expect(text(view.doc)).toEqual(['one two']);
    expect(view.rules()).toBe('');
  });

  it('ends a running highlight at once, and the typing goes on', () => {
    const view = open(page(['<p>one</p>']));
    view.animator.random = () => 1;
    view.write(page(['<p>one two three</p>']));
    at(48);
    expect(Object.keys(view.painted())).toHaveLength(2);
    view.animator.highlight = false;
    at(64);
    expect(view.painted()).toEqual({});
    expect(view.rules()).toBe('');
    expect(text(view.doc)[0]).toBe('one tw');
    at(1008);
    expect(text(view.doc)).toEqual(['one two three']);
  });
});

describe('ACC-HILITE-117 marks stay painted through a change', () => {
  it('leaves the mark highlights as they are, and a repaint of marks leaves the change ones', () => {
    const view = open(page(['<p>marked</p>', '<p>one</p>']));
    const mark = view.doc.createRange();
    mark.selectNodeContents(view.doc.querySelector('p')!);
    paint(view.win, new Map([['jp-ahv-yellow', [mark]]]));
    view.write(page(['<p>marked</p>', '<p>one two</p>']));
    at(48);
    paint(view.win, new Map([['jp-ahv-yellow', [mark]]]));
    expect(view.highlights.has('jp-ahv-yellow')).toBe(true);
    expect(Object.keys(view.painted())).toHaveLength(2);
    at(8000);
    expect(view.highlights.has('jp-ahv-yellow')).toBe(true);
    expect(view.painted()).toEqual({});
  });
});

describe('ACC-HILITE-117 says once when the page reads as the file', () => {
  it('settles when the last run ends, and after the drain where removed text stands', () => {
    const view = open(page(['<p>one</p>', '<p>gone</p>']));
    view.animator.random = () => 1;
    let settled = 0;
    view.animator.settled = () => settled++;
    view.write(page(['<p>one two</p>', '<p>gone</p>']));
    expect(view.animator.animating).toBe(true);
    at(48);
    expect(settled).toBe(0);
    at(2000);
    expect(view.animator.animating).toBe(false);
    expect(settled).toBe(1);
    view.animator.animation = false;
    view.write(page(['<p>one two</p>']));
    at(2048);
    expect(view.animator.animating).toBe(true);
    at(30000);
    expect(view.animator.animating).toBe(false);
    expect(settled).toBe(2);
  });
});

describe('ACC-LIVE-107 the animation ends equal to a fresh page', () => {
  describe.each([
    ['animated', true],
    ['with the animation off', false]
  ])('%s', (_, animation) => {
    it.each([...GENERATED, ...NAMED])('%s', (_, before, after) => {
      const view = open(before);
      view.animator.animation = animation;
      const reading = view.write(after);
      at(30000);
      expect(jest.getTimerCount()).toBe(0);
      const fresh = load(after);
      expect(shape(view.doc, reading)).toEqual(
        shape(fresh.doc, fresh.analysis)
      );
      expect(view.painted()).toEqual({});
    });
  });

  it('clears at once: the change lands, the highlights leave and the loop stops', () => {
    const view = open(page(['<p>keep oldword keep</p>']));
    const reading = view.write(page(['<p>keep newer keep</p>']));
    at(48);
    view.animator.clear();
    expect(jest.getTimerCount()).toBe(0);
    expect(view.painted()).toEqual({});
    const fresh = load(page(['<p>keep newer keep</p>']));
    expect(shape(view.doc, reading)).toEqual(shape(fresh.doc, fresh.analysis));
  });
});
