import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import {
  frameClass,
  frameMs,
  RATE_WINDOW_MS,
  TAB_CHANGING_CLASS,
  TabCue
} from '../cue';
import { Follower, FOLLOW_MS } from '../follow';

/** A follower whose loaded signal the test emits. */
function fakeFollower(): { follower: Follower; load: () => void } {
  const owner = {};
  const loaded = new Signal<object, void>(owner);
  return {
    follower: { loaded } as unknown as Follower,
    load: () => loaded.emit()
  };
}

/** The marker classes on a widget's tab. */
function marker(widget: Widget): string[] {
  return widget.title.className
    .split(/\s+/)
    .filter(name => name.startsWith('jp-AdvancedHtml-tab'));
}

describe('the tab marker (ACC-LIVE-70)', () => {
  let widget: Widget;
  let cue: TabCue;
  let load: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    widget = new Widget();
    const fake = fakeFollower();
    load = fake.load;
    cue = new TabCue(widget, fake.follower);
  });

  afterEach(() => {
    cue.dispose();
    widget.dispose();
    jest.useRealTimers();
  });

  it('lasts 1 s a frame for one change and 0.25 s for a change at every look', () => {
    expect([0, 1, 2, 3, 4, 7].map(frameMs)).toEqual([
      1000, 1000, 750, 500, 250, 250
    ]);
  });

  it('turns faster with each change the follower loads at its beat', () => {
    const seen: string[][] = [];
    for (let i = 0; i < 4; i++) {
      load();
      seen.push(marker(widget));
      jest.advanceTimersByTime(FOLLOW_MS);
    }
    expect(seen).toEqual(
      [1000, 750, 500, 250].map(ms => [TAB_CHANGING_CLASS, frameClass(ms)])
    );
  });

  it('slows as the changes age out, and a tab behind keeps the marker at 1 s', () => {
    for (let i = 0; i < 4; i++) {
      load();
      jest.advanceTimersByTime(FOLLOW_MS);
    }
    // At the fifth beat the first change has left the window.
    expect(marker(widget)).toEqual([TAB_CHANGING_CLASS, frameClass(500)]);
    jest.advanceTimersByTime(RATE_WINDOW_MS);
    expect(widget.isVisible).toBe(false);
    expect(marker(widget)).toEqual([TAB_CHANGING_CLASS, frameClass(1000)]);
  });

  it('leaves a tab in front once no change is left in the window', () => {
    Widget.attach(widget, document.body);
    load();
    expect(marker(widget)).toEqual([TAB_CHANGING_CLASS, frameClass(1000)]);
    jest.advanceTimersByTime(RATE_WINDOW_MS - FOLLOW_MS);
    expect(marker(widget)).toEqual([TAB_CHANGING_CLASS, frameClass(1000)]);
    jest.advanceTimersByTime(FOLLOW_MS);
    expect(marker(widget)).toEqual([]);
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
