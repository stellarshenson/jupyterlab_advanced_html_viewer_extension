import { nullTranslator } from '@jupyterlab/translation';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import {
  frameClass,
  frameMs,
  TAB_ARRIVING_CLASS,
  TAB_CHANGING_CLASS,
  TAB_UNREAD_CLASS,
  TabCue
} from '../cue';
import { Follower } from '../follow';

/** A follower whose looks at the file the test takes. */
function fakeFollower(): {
  follower: Follower;
  load: () => void;
  look: (...found: boolean[]) => void;
} {
  const owner = {};
  const loaded = new Signal<object, void>(owner);
  const looked = new Signal<object, void>(owner);
  return {
    follower: { loaded, looked } as unknown as Follower,
    load: () => loaded.emit(),
    look: (...found) =>
      found.forEach(change => {
        if (change) {
          loaded.emit();
        }
        looked.emit();
      })
  };
}

/** The marker classes on a widget's tab. */
function marker(widget: Widget): string[] {
  return widget.title.className
    .split(/\s+/)
    .filter(name => name.startsWith('jp-AdvancedHtml-tab'));
}

// The test compiler options carry the jest types alone, so the two things
// this file needs from the module system are declared where they are used.
declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};
const stylesheet = readFileSync(`${__dirname}/../../style/base.css`, 'utf8');

/** The declarations of the stylesheet rule written for one tab class. */
function markerRule(className: string): string {
  const selector = `.lm-TabBar-tab.${className} .lm-TabBar-tabLabel::before`;
  const block = stylesheet.split('}').find((part: string) => {
    const head = part.split('{')[0].trim().split('\n');
    return head[head.length - 1].trim() === selector;
  });
  expect(block).toBeDefined();
  return (block as string).split('{')[1];
}

/** The marker of a tab while changes arrive at the given frame length. */
const arriving = (ms: number): string[] => [
  TAB_CHANGING_CLASS,
  TAB_ARRIVING_CLASS,
  frameClass(ms)
];

/** The tooltip of the half circle and the tooltip of the unread marker. */
const CHANGING_WORDS =
  'The file changed on disk. The page shows the new content.';
const UNREAD_WORDS =
  'The file changed on disk while this tab was behind another. The page shows the new content.';

describe('the tab marker (ACC-LIVE-70)', () => {
  let widget: Widget;
  let cue: TabCue;
  let load: () => void;
  let look: (...found: boolean[]) => void;
  const still = [TAB_CHANGING_CLASS];
  const unread = [TAB_CHANGING_CLASS, TAB_UNREAD_CLASS];

  /** Bring the tab to the front, or put it behind, as the dock panel does. */
  const front = (): void => widget.show();
  const behind = (): void => widget.hide();

  beforeEach(() => {
    widget = new Widget();
    widget.hide();
    Widget.attach(widget, document.body);
    const fake = fakeFollower();
    load = fake.load;
    look = fake.look;
    cue = new TabCue(
      widget,
      fake.follower,
      nullTranslator.load('jupyterlab_advanced_html_viewer_extension')
    );
  });

  afterEach(() => {
    cue.dispose();
    widget.dispose();
  });

  it('lasts 1 s a frame for one change and 0.25 s for a change at every look', () => {
    expect([0, 1, 2, 3, 4, 7].map(frameMs)).toEqual([
      1000, 1000, 750, 500, 250, 250
    ]);
  });

  it('alternates faster with each look that finds a change', () => {
    const seen: string[][] = [];
    for (let i = 0; i < 4; i++) {
      look(true);
      seen.push(marker(widget));
    }
    expect(seen).toEqual([1000, 750, 500, 250].map(arriving));
  });

  it('slows as the changes leave the four looks', () => {
    look(true, true, true, true, false);
    expect(marker(widget)).toEqual(arriving(500));
  });

  it('stands still after two looks without a change, and leaves once none of the four looks holds one', () => {
    front();
    look(true);
    expect(marker(widget)).toEqual(arriving(1000));
    look(false);
    expect(marker(widget)).toEqual(arriving(1000));
    look(false);
    expect(marker(widget)).toEqual(still);
    look(false);
    expect(marker(widget)).toEqual(still);
    look(false);
    expect(marker(widget)).toEqual([]);
  });

  it('DEF-LIVE-30 keeps alternating through a change at every other look, with no other state between', () => {
    front();
    const seen = new Set<string>();
    widget.title.changed.connect(() => {
      seen.add(marker(widget).join(' '));
    });
    look(true, false, true, false, true, false, true);
    expect([...seen]).toEqual([1000, 750].map(ms => arriving(ms).join(' ')));
  });

  it('is the same before and after the look that loaded a change finishes', () => {
    look(true, false, false, false);
    load();
    const before = marker(widget);
    look(false);
    expect(before).toEqual(arriving(1000));
    expect(marker(widget)).toEqual(before);
  });

  it('DEF-LIVE-29 gives no unread marker to a change the reader watched, and leaves on time on a tab that went behind', () => {
    front();
    look(true);
    behind();
    look(false, false);
    expect(marker(widget)).toEqual(still);
    look(false, false);
    expect(marker(widget)).toEqual([]);
  });

  describe('changes nobody has looked at (ACC-LIVE-79)', () => {
    it('show the unread marker on a tab behind another, two looks after the last change, for as long as it is behind', () => {
      expect(widget.isVisible).toBe(false);
      look(true, false);
      expect(marker(widget)).toEqual(arriving(1000));
      look(false);
      expect(marker(widget)).toEqual(unread);
      look(...Array(12).fill(false));
      expect(marker(widget)).toEqual(unread);
    });

    it('alternate again when a change arrives, and are the unread marker again once it stops', () => {
      look(true, false, false, false, false);
      expect(marker(widget)).toEqual(unread);
      look(true);
      expect(marker(widget)).toEqual(arriving(1000));
      look(false, false);
      expect(marker(widget)).toEqual(unread);
    });

    it('are a still half circle on a tab brought to the front while a look still holds a change', () => {
      look(true, false, false);
      expect(marker(widget)).toEqual(unread);
      front();
      expect(marker(widget)).toEqual(still);
      look(false, false);
      expect(marker(widget)).toEqual([]);
    });

    it('leave a tab brought to the front at once when no look holds a change', () => {
      look(true, false, false, false, false);
      expect(marker(widget)).toEqual(unread);
      front();
      expect(marker(widget)).toEqual([]);
    });

    it('are read once the tab was in front, however short, and get no unread marker after it goes behind again', () => {
      look(true);
      front();
      behind();
      look(false, false);
      expect(marker(widget)).toEqual(still);
    });
  });

  describe('the tooltip (ACC-LIVE-80)', () => {
    it('says the words of the half circle and of the unread marker above the caption of the document', () => {
      widget.title.caption = 'Name: page.html';
      front();
      look(true);
      expect(widget.title.caption).toBe(`${CHANGING_WORDS}\n\nName: page.html`);
      look(false, false);
      expect(widget.title.caption).toBe(`${CHANGING_WORDS}\n\nName: page.html`);
      behind();
      look(true, false, false);
      expect(marker(widget)).toEqual(unread);
      expect(widget.title.caption).toBe(`${UNREAD_WORDS}\n\nName: page.html`);
    });

    it('gives the caption of the document back when the marker leaves', () => {
      widget.title.caption = 'Name: page.html';
      look(true, false, false);
      front();
      look(false, false);
      expect(marker(widget)).toEqual([]);
      expect(widget.title.caption).toBe('Name: page.html');
    });

    it('stays over a caption the document manager writes meanwhile, and gives that one back', () => {
      widget.title.caption = 'Last Modified: 10:00';
      front();
      look(true);
      widget.title.caption = 'Last Modified: 10:01';
      expect(widget.title.caption).toBe(
        `${CHANGING_WORDS}\n\nLast Modified: 10:01`
      );
      look(false, false, false, false);
      expect(widget.title.caption).toBe('Last Modified: 10:01');
    });
  });

  describe('the tabCue setting (ACC-LIVE-81)', () => {
    it('off takes the marker and its tooltip off the tab at once', () => {
      widget.title.caption = 'Name: page.html';
      look(true);
      cue.enabled = false;
      expect(marker(widget)).toEqual([]);
      expect(widget.title.caption).toBe('Name: page.html');
    });

    it('off shows no marker for later changes, behind or in front', () => {
      cue.enabled = false;
      look(true, false, false);
      expect(marker(widget)).toEqual([]);
      front();
      look(true);
      expect(marker(widget)).toEqual([]);
    });

    it('on again shows the marker of the changes that arrive', () => {
      cue.enabled = false;
      cue.enabled = true;
      look(true);
      expect(marker(widget)).toEqual(arriving(1000));
    });
  });

  describe('the stylesheet', () => {
    it('alternates two characters, neither of them turned or moved', () => {
      // DEF-LIVE-27. One character turned half a turn about the centre of
      // its box changed height on the tab at every frame. The second frame
      // is the second character, drawn where the font draws it.
      expect(markerRule(TAB_CHANGING_CLASS)).toMatch(/content: '\\25D0';/);
      const frames = /@keyframes jp-AdvancedHtml-tab-turn \{([^@]*?)\n\}/.exec(
        stylesheet
      );
      expect(frames).not.toBeNull();
      expect((frames as RegExpExecArray)[1]).toMatch(
        /^\s*50% \{\s*content: '\\25D1';\s*\}\s*$/
      );
    });

    it('moves the marker only while changes arrive', () => {
      expect(markerRule(TAB_ARRIVING_CLASS)).toMatch(
        /animation: jp-AdvancedHtml-tab-turn 2s step-end infinite;/
      );
      expect(markerRule(TAB_CHANGING_CLASS)).not.toContain('animation');
    });

    it("draws the unread marker as a 7 px round dot in the theme's brand colour 2, centred on the capitals, standing still", () => {
      const unread = markerRule(TAB_UNREAD_CLASS);
      expect(unread).toMatch(/content: '';/);
      expect(unread).toMatch(/width: 7px;/);
      expect(unread).toMatch(/height: 7px;/);
      expect(unread).toMatch(/vertical-align: calc\(\(1cap - 7px\) \/ 2\);/);
      expect(unread).toMatch(/background-color: var\(--jp-brand-color2\);/);
      expect(unread).toMatch(/border-radius: 50%;/);
      expect(unread).toMatch(/forced-color-adjust: none;/);
      expect(unread).not.toContain('animation');
      expect(stylesheet).not.toContain('--jp-AdvancedHtml-unread');
      expect(stylesheet).not.toContain('#116329');
      expect(stylesheet).not.toContain('#66bb6a');
    });
  });

  it('keeps the classes other extensions give the tab', () => {
    widget.title.className = 'jp-colourful-tab-mint';
    load();
    expect(widget.title.className.split(' ')).toContain(
      'jp-colourful-tab-mint'
    );
    cue.dispose();
    expect(widget.title.className).toBe('jp-colourful-tab-mint');
  });
});
