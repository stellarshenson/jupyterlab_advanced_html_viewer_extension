/**
 * Typing in and deleting a change of the file, one frame at a time.
 *
 * A plan of src/patch.ts is carried out on the page over time, as the
 * advanced Markdown viewer animates a change (its src/animate.ts). Added text
 * is typed in letter by letter into text nodes of its own. Removed text
 * stands whole while its red rises and its strike is drawn, then loses its
 * characters from its end at the same speed, while the text that replaces it
 * types beside it. An added element is inserted empty, with its attributes,
 * and its content typed in after it, so an element comes before the elements
 * inside it; a removed element loses its text from its end, and each element
 * in it is taken out the moment it holds no more text, so an element goes
 * after the elements inside it. An element with no text, such as img or br,
 * is inserted or taken out the moment the typing or the deletion reaches it.
 * The parts of a change at different places type at the same time, from one
 * clock and one draw of the jitter per character.
 *
 * The loop runs in the lab's window and is timed on the wall clock: a frame
 * whose scripts are off may run no timer of its own, and a page whose frames
 * stopped catches up on the time that passed. It reads no layout. Each change
 * is painted through src/paint.ts, rising from its own start, and all changes
 * drain together at the end of one life, which every change starts again.
 */

import { MAX_LCS_TOKENS, tokenize } from './diff';
import {
  canPaint,
  changeColours,
  changeHighlight,
  changeName,
  IChangeColours,
  IHighlight,
  paintChanges
} from './paint';
import { applyPlan, contentOf, IHunk, IPlan, place, shell } from './patch';
import { IStaticElement } from './source';

/** Characters typed or deleted a second, on average. */
export const SPEED = 75;

/**
 * How far the time of a character strays from the even time at the speed,
 * as a share of it, drawn evenly either way, so the mean stays the speed.
 */
export const JITTER = 0.25;

/** How long a change's highlight stands, from the end of its rise, once nothing types. */
export const FADE_MS = 5000;

/** How long a highlight takes to rise to its colour. */
export const RISE_MS = 500;

/** How long the strike over removed text takes to arrive, after the rise. */
export const STRIKE_MS = 250;

/** How long removed text stands whole before it is deleted: the rise, then the strike. */
export const HOLD_MS = RISE_MS + STRIKE_MS;

/** How long the highlights take to drain, at the end of their life. */
export const DRAIN_MS = 750;

/** An added run or a removal of more tokens than the word diff's bound lands at once. */
const COARSE_TOKENS = MAX_LCS_TOKENS;

/**
 * CSS ease-out, cubic-bezier(0, 0, 0.58, 1), at a share of its time: the
 * curve's x is solved for by halving, and its y read there.
 */
function easeOut(x: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const s = (low + high) / 2;
    if (1.74 * s * s - 0.74 * s * s * s < x) {
      low = s;
    } else {
      high = s;
    }
  }
  const s = (low + high) / 2;
  return 3 * s * s - 2 * s * s * s;
}

/** A share of a span of time, held between 0 and 1. */
function share(elapsed: number, span: number): number {
  return Math.min(1, Math.max(0, elapsed / span));
}

/**
 * One step of a run: a node put in or taken out, and the characters typed
 * into it or deleted from it, none for an element or white space alone.
 */
interface IStep {
  node: ChildNode;
  text: string;
  /** For an added node, how it goes into the page. */
  put?: () => void;
}

/** The added or the removed part of one hunk. */
interface IRun {
  steps: IStep[];
  /** The step in progress. */
  next: number;
  /** Characters the run may still write, a share of one carried between frames. */
  left: number;
  /** Time left before a removal starts deleting, in milliseconds. */
  hold: number;
  removing: boolean;
}

/** One change on the page, painted from its start. */
interface IChange {
  n: number;
  start: number;
  colours: IChangeColours;
  added: IHighlight | null;
  removed: IHighlight | null;
}

/**
 * Put a run's progress on the page: added text typed in and nodes put in,
 * or removed text deleted from its end and nodes taken out, as far as its
 * characters reach.
 *
 * @returns whether the run is complete
 */
function write(run: IRun): boolean {
  for (; run.next < run.steps.length; run.next++) {
    const { node, text, put } = run.steps[run.next];
    const data = node as Text;
    if (run.removing) {
      if (text) {
        const count = Math.min(data.length, Math.floor(run.left));
        if (count) {
          data.deleteData(data.length - count, count);
          run.left -= count;
        }
        if (data.length) {
          return false;
        }
      }
      node.remove();
      continue;
    }
    if (!node.parentNode) {
      put!();
    }
    if (text) {
      const count = Math.min(text.length - data.length, Math.floor(run.left));
      if (count) {
        data.insertData(
          data.length,
          text.slice(data.length, data.length + count)
        );
        run.left -= count;
      }
      if (data.length < text.length) {
        return false;
      }
    }
  }
  return true;
}

/** Complete runs at once. */
function complete(runs: IRun[]): void {
  for (const run of runs) {
    run.left = Infinity;
    write(run);
  }
}

/**
 * Carries the changes of one page out over time, and paints them.
 */
export class ChangeAnimator {
  /**
   * @param win - the page's window, whose document the plans are made for
   */
  constructor(private readonly _win: Window) {}

  /**
   * Whether changes are typed in and deleted; off, a change lands at once,
   * and removed text stands until its highlight has drained. Read on every
   * frame, so a switch takes effect on the next one.
   */
  animation = true;

  /** Whether changes are painted. Read on every frame; off ends the painting at once. */
  highlight = true;

  /** The draw behind the jitter, replaceable by a test that needs a run to take a known time. */
  random: () => number = Math.random;

  /** Called when the page has come to read as the last plan's new text, after a change that took time. */
  settled: () => void = () => undefined;

  /** Whether a change is still typed in or deleted, or removed text still stands. */
  get animating(): boolean {
    return this._runs.length > 0 || this._standing.length > 0;
  }

  /**
   * Carry a plan out over time. A change still running completes first.
   *
   * The numbers and the attributes change at once. Each hunk's added part
   * starts typing on the first frame and its removed part waits, so the added
   * content goes in after what it replaces before that leaves.
   */
  start(plan: IPlan): void {
    this.finish();
    applyPlan(this._win.document, { ...plan, hunks: [] });
    const now = Date.now();
    const change = this._change(now);
    for (const hunk of plan.hunks) {
      if (hunk.at) {
        this._runs.push(this._adding(hunk, change));
      }
      if (hunk.removed.length) {
        this._runs.push(this._removing(hunk, change));
      }
    }
    this._last = now;
    this._step(0, now);
    this._loop();
  }

  /**
   * Paint ranges as text a change added, rising and draining as a change
   * does: the text a new page shows that the page before it did not.
   */
  tint(ranges: Range[]): void {
    const change = this._change(Date.now());
    ranges.forEach(range => change.added?.add(range));
    this._loop();
  }

  /**
   * Complete every run at once: the rest of the added text lands and the
   * removed text goes, a removal left standing with the animation off as
   * well. The highlights stay. A change is planned against the page only
   * after this, since the plan reads the page.
   *
   * shortcut: a write during an animation completes the runs in progress, and
   * does not continue a run whose text the new write extends, as the
   * Markdown viewer does (its ACC-ANIM-78); continue such a run when an agent
   * appending to text still typing in makes the jump show.
   */
  finish(): void {
    const busy = this.animating;
    complete(this._runs);
    complete(this._standing);
    this._runs = [];
    this._standing = [];
    if (busy) {
      this.settled();
    }
  }

  /** Complete every run, take the highlights off the page, and stop. */
  clear(): void {
    // First: a window that throws below leaves no frame pending.
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this.finish();
    this._changes = [];
    paintChanges(this._win, []);
  }

  /** A new change, painted where highlighting is on, and the life every change shares started again. */
  private _change(now: number): IChange {
    const n = this._count++;
    const painted = this.highlight && canPaint(this._win);
    const change: IChange = {
      n,
      start: now,
      colours: changeColours(),
      added: painted
        ? changeHighlight(this._win, changeName('added', n))
        : null,
      removed: painted
        ? changeHighlight(this._win, changeName('removed', n))
        : null
    };
    if (painted) {
      this._changes.push(change);
    }
    this._end = Math.max(this._end, now + FADE_MS + RISE_MS);
    return change;
  }

  /**
   * The added part of a hunk: each node of its content in document order,
   * made empty, to be put in when the typing reaches it, the first at the
   * hunk's place and the next after it, an element's content into it.
   */
  private _adding(hunk: IHunk, change: IChange): IRun {
    const doc = this._win.document;
    const steps: IStep[] = [];
    let tokens = 0;
    const walk = (
      items: (string | IStaticElement)[],
      put: (node: ChildNode) => void
    ): void => {
      for (const item of items) {
        if (typeof item === 'string') {
          tokens += tokenize(item).length;
          const typed = /\S/.test(item);
          const node = doc.createTextNode(typed ? '' : item);
          steps.push({ node, text: typed ? item : '', put: () => put(node) });
          continue;
        }
        const node = shell(doc, item);
        steps.push({ node, text: '', put: () => put(node) });
        walk(contentOf(item), child => node.append(child));
      }
    };
    let last: ChildNode | null = null;
    walk(hunk.added, node => {
      if (last) {
        last.after(node);
      } else {
        place(hunk.at!, [node]);
      }
      last = node;
      const range = doc.createRange();
      range.selectNode(node);
      change.added?.add(range);
    });
    return {
      steps,
      next: 0,
      left: tokens > COARSE_TOKENS ? Infinity : 0,
      hold: 0,
      removing: false
    };
  }

  /**
   * The removed part of a hunk: its text nodes from the last back, each
   * element after everything inside it, painted red as it stands. Removed
   * text that holds no character but white space goes without a hold.
   */
  private _removing(hunk: IHunk, change: IChange): IRun {
    const doc = this._win.document;
    const steps: IStep[] = [];
    let tokens = 0;
    const walk = (node: ChildNode): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const data = (node as Text).data;
        tokens += tokenize(data).length;
        steps.push({ node, text: /\S/.test(data) ? data : '' });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        Array.from(node.childNodes).reverse().forEach(walk);
        steps.push({ node, text: '' });
      }
    };
    for (const node of [...hunk.removed].reverse()) {
      walk(node);
      const range = doc.createRange();
      range.selectNode(node);
      change.removed?.add(range);
    }
    const coarse = tokens > COARSE_TOKENS;
    return {
      steps,
      next: 0,
      left: coarse ? Infinity : 0,
      hold: !coarse && steps.some(step => step.text) ? HOLD_MS : 0,
      removing: true
    };
  }

  private _tick = (): void => {
    this._frame = null;
    const now = Date.now();
    const dt = now - this._last;
    this._last = now;
    this._step(dt, now);
    this._loop();
  };

  private _loop(): void {
    if (
      this._frame === null &&
      (this._runs.length || this._standing.length || this._changes.length)
    ) {
      this._frame = requestAnimationFrame(this._tick);
    }
  }

  /** One frame: the runs move on by the time that passed, and the changes are painted for now. */
  private _step(dt: number, now: number): void {
    const busy = this.animating;
    if (!this.highlight) {
      this._changes = [];
    }
    if (this._runs.length) {
      // The life starts again while anything types, so the drain waits.
      this._end = Math.max(this._end, now + FADE_MS + RISE_MS);
      const budget = this.animation ? this._budget(dt) : Infinity;
      this._runs = this._runs.filter(run => {
        if (run.hold > 0) {
          if (!this.animation && this._changes.length) {
            this._standing.push(run);
            return false;
          }
          run.hold -= this.animation ? dt : Infinity;
          if (run.hold > 0) {
            return true;
          }
        }
        run.left += budget;
        return !write(run);
      });
    }
    if (!this._runs.length && now >= this._end) {
      this._changes = [];
    }
    if (!this._changes.length) {
      complete(this._standing);
      this._standing = [];
    }
    // Risen changes paint alike, so their ranges join the oldest one's
    // highlights, and a file that keeps changing paints one pair, not one a
    // change. The changes come in order of their start, and the pair takes
    // the colours the later one read, the lab theme's as it stands.
    // shortcut: a theme switch recolours a standing change only when the next change joins it; read the colours on the theme's change if one shows in the old colours for its life.
    while (
      this._changes.length > 1 &&
      now - this._changes[1].start >= HOLD_MS
    ) {
      const [into, from] = this._changes;
      from.added?.forEach(range => into.added?.add(range));
      from.removed?.forEach(range => into.removed?.add(range));
      into.colours = from.colours;
      this._changes.splice(1, 1);
    }
    // The share of the colour gone: CSS ease-in over the last of the life.
    const gone = 1 - easeOut(1 - share(now - this._end + DRAIN_MS, DRAIN_MS));
    paintChanges(
      this._win,
      this._changes.map(({ n, start, colours }) => ({
        n,
        colours,
        strength: easeOut(share(now - start, RISE_MS)) * (1 - gone),
        strike: easeOut(share(now - start - RISE_MS, STRIKE_MS)) * (1 - gone)
      }))
    );
    if (busy && !this.animating) {
      this.settled();
    }
  }

  /**
   * How many characters a frame's time buys, walked one character at a time:
   * each character takes the even time scaled by a factor drawn once for it,
   * and the one draw serves every run, so runs that follow one another keep
   * in step.
   */
  private _budget(dt: number): number {
    const even = 1000 / SPEED;
    let budget = 0;
    let left = dt;
    while (left > 0) {
      if (this._charLeft <= 0) {
        this._charLeft = 1;
        this._factor = 1 + JITTER * (2 * this.random() - 1);
      }
      const time = even * this._factor;
      const need = this._charLeft * time;
      if (left < need) {
        budget += left / time;
        this._charLeft -= left / time;
        break;
      }
      budget += this._charLeft;
      left -= need;
      this._charLeft = 0;
    }
    return budget;
  }

  private _runs: IRun[] = [];
  /** Removals left whole while the animation is off, until the highlights drain. */
  private _standing: IRun[] = [];
  private _changes: IChange[] = [];
  private _count = 0;
  /** When the highlights' life ends. */
  private _end = 0;
  private _last = 0;
  private _frame: number | null = null;
  private _factor = 1;
  private _charLeft = 0;
}
