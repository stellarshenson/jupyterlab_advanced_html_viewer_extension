/**
 * An HTML viewer with marks, comments and a notes panel.
 *
 * The viewer shows an HTML file in a sandboxed frame and trusts and refreshes
 * it as JupyterLab's own HTML Viewer does. The reader marks passages of the
 * page and writes notes on them; a mark is a pair of HTML comments in the file
 * itself, the grammar of the advanced Markdown viewer, so the file alone
 * carries the whole conversation and a browser shows the page unchanged. Only
 * text written in the file takes a mark: text the page's scripts produce, and
 * whatever an iframe, object or embed of the page shows, does not (see
 * src/origin.ts).
 *
 * This module is the wiring: the widget factory, which is the default for
 * .html files, the commands the context menu, the palette and the keyboard
 * call, and the settings.
 */

import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  Clipboard,
  ICommandPalette,
  IThemeManager,
  WidgetTracker
} from '@jupyterlab/apputils';
import { IHTMLViewerTracker } from '@jupyterlab/htmlviewer';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { html5Icon } from '@jupyterlab/ui-components';
import { Menu } from '@lumino/widgets';

import { NoteHandle } from './handle';
import { MARK_ICONS, MARK_MENU_ICON, NOTE_ICON, PANEL_ICONS } from './icons';
import {
  DEFAULT_COLOUR,
  HIDE_MINIMAP_LABEL,
  MARK_COLOURS,
  MarkColour,
  PANEL_LABELS,
  PanelState
} from './marks';
import {
  explainRefusal,
  INotesSettings,
  NotesController,
  SELECTING_CLASS
} from './notes';
import {
  installNotesPanel,
  NotesPanel,
  PANEL_CLASS,
  ROW_CLASS
} from './notes-panel';
import { applySwatchColours } from './swatch';
import {
  AdvancedHTMLViewer,
  AdvancedHTMLViewerFactory,
  VIEWER_CLASS
} from './viewer';

/** The plugin identifier, which is also the settings identifier. */
const PLUGIN_ID = 'jupyterlab_advanced_html_viewer_extension:plugin';

/** The settings of the built-in viewer, whose trustByDefault this one honours. */
const BUILT_IN_ID = '@jupyterlab/htmlviewer-extension:plugin';

/** The name of the widget factory. */
export const FACTORY = 'Advanced HTML Viewer';

/** The commands the context menu, the palette and the keyboard call. */
export const COMMANDS = {
  /** Mark the selected passage in the colour named by the `colour` argument. */
  mark: 'advanced-html-viewer:mark',
  /** The same from the palette and the keyboard. */
  markSelection: 'advanced-html-viewer:mark-selection',
  /** Mark the selected passage and open the note field on it. */
  addNote: 'advanced-html-viewer:add-note',
  /** Put the notes panel into the state named by the `state` argument. */
  panel: 'advanced-html-viewer:notes-panel',
  /** Copy the identifier of the mark whose panel row the menu was opened on. */
  copyMarkId: 'advanced-html-viewer:copy-mark-id',
  /** Ask for the handle note lines are signed with. */
  setHandle: 'advanced-html-viewer:set-note-handle'
};

/** The frame of a viewer, where the page's context menu is opened. */
const FRAME_SELECTOR = `.${VIEWER_CLASS} iframe`;

/** The same while the page holds a selection of file text. */
const MARKING_SELECTOR = `.${SELECTING_CLASS}.${VIEWER_CLASS} iframe`;

/** A row of the notes panel. */
const ROW_SELECTOR = `.${PANEL_CLASS} .${ROW_CLASS}`;

/** The order the context menu offers the three panel states in. */
const PANEL_ORDER: PanelState[] = ['expanded', 'minimap', 'hidden'];

/** The pieces attached to one open viewer. */
interface IAttachment {
  viewer: AdvancedHTMLViewer;
  notes: NotesController;
  panel: NotesPanel;
}

/** A colour as the Mark submenu names it. */
function colourLabel(colour: MarkColour): string {
  return colour[0].toUpperCase() + colour.slice(1);
}

/** The colour a mark command was asked for, the default without one. */
function colourOf(value: unknown): MarkColour {
  return MARK_COLOURS.includes(value as MarkColour)
    ? (value as MarkColour)
    : DEFAULT_COLOUR;
}

/** The settings this extension reads, with their defaults. */
function readSettings(
  settings: ISettingRegistry.ISettings | null
): INotesSettings {
  const author = settings?.composite.author;
  return { author: typeof author === 'string' ? author : '' };
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'HTML viewer with trust, refresh, marks and notes stored in the file',
  autoStart: true,
  optional: [
    ISettingRegistry,
    ICommandPalette,
    ITranslator,
    IThemeManager,
    ILayoutRestorer,
    IHTMLViewerTracker
  ],
  activate: (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null,
    palette: ICommandPalette | null,
    translator: ITranslator | null,
    themeManager: IThemeManager | null,
    restorer: ILayoutRestorer | null,
    // Asked for so this plugin activates after the built-in viewer, whose
    // factory would otherwise take the default for .html files back.
    _builtIn: IHTMLViewerTracker | null
  ) => {
    console.log(
      'JupyterLab extension jupyterlab_advanced_html_viewer_extension is activated!'
    );
    const labTranslator = translator ?? nullTranslator;
    const trans = labTranslator.load(
      'jupyterlab_advanced_html_viewer_extension'
    );
    const labTrans = labTranslator.load('jupyterlab');
    applySwatchColours(document.body);
    themeManager?.themeChanged.connect(() => applySwatchColours(document.body));
    const handle = new NoteHandle(trans);
    const language = labTranslator.languageCode;
    let current = readSettings(null);
    let trustByDefault = false;

    // The built-in viewer registers the html file type; without it, it is
    // registered here.
    if (!app.docRegistry.getFileType('html')) {
      app.docRegistry.addFileType({
        name: 'html',
        contentType: 'file',
        fileFormat: 'text',
        displayName: labTrans.__('HTML File'),
        extensions: ['.html'],
        mimeTypes: ['text/html'],
        icon: html5Icon
      });
    }

    const factory = new AdvancedHTMLViewerFactory({
      name: FACTORY,
      label: trans.__('Advanced HTML Viewer'),
      fileTypes: ['html'],
      defaultFor: ['html'],
      readOnly: true,
      translator: labTranslator,
      contents: app.serviceManager.contents
    });
    app.docRegistry.addWidgetFactory(factory);

    const tracker = new WidgetTracker<AdvancedHTMLViewer>({
      namespace: 'advanced-htmlviewer'
    });
    if (restorer) {
      void restorer.restore(tracker, {
        command: 'docmanager:open',
        args: widget => ({ path: widget.context.path, factory: FACTORY }),
        name: widget => widget.context.path
      });
    }

    const attachments = new Map<AdvancedHTMLViewer, IAttachment>();

    /** Marks the selection of one page, or says why it takes no mark. */
    const markSelected = async (
      notes: NotesController,
      colour: MarkColour
    ): Promise<void> => {
      const selection = notes.selection;
      if (!selection) {
        return;
      }
      if ('refused' in selection) {
        explainRefusal(
          trans.__('Only text written in the file takes a comment.')
        );
        return;
      }
      await notes.mark(colour);
    };

    factory.widgetCreated.connect((_, viewer) => {
      if (trustByDefault) {
        viewer.trusted = true;
      }
      viewer.title.icon = html5Icon;
      void tracker.add(viewer);
      viewer.context.pathChanged.connect(() => void tracker.save(viewer));

      const notes = new NotesController({
        viewer,
        serverSettings: app.serviceManager.serverSettings,
        settings: current
      });
      const panel = new NotesPanel({
        view: notes,
        handlers: {
          addNote: async (id, text) => {
            await handle.askIfUnset();
            return notes.addNote(id, text);
          },
          editNote: (id, note, text) => notes.editNote(id, note, text),
          removeNote: (id, note) => void notes.removeNote(id, note),
          setColour: (id, colour) => void notes.setColour(id, colour),
          setClosed: (id, closed) => void notes.setClosed(id, closed),
          setShowClosed: on => notes.setShowClosed(on),
          removeMark: id => void notes.remove(id),
          removeEmptyDocument: id => void notes.removeEmptyDocument(id),
          markDocument: () => notes.markDocument(),
          setState: state => void notes.setPanelState(state)
        },
        state: notes.panelState,
        trans,
        locale: language
      });
      installNotesPanel(viewer, panel);

      const sync = (): void => {
        panel.state = notes.panelState;
        panel.showClosed = notes.showClosed;
        panel.setMarks(
          notes.marks.map(mark => ({
            mark,
            passage: mark.text,
            anchored: !mark.unanchored,
            position: mark.position
          }))
        );
      };
      notes.changed.connect(sync);
      notes.activated.connect((_, id) => panel.openFromPassage(id));
      notes.markKey.connect(() => void markSelected(notes, DEFAULT_COLOUR));
      sync();

      attachments.set(viewer, { viewer, notes, panel });
      viewer.disposed.connect(() => attachments.delete(viewer));
    });

    /**
     * The viewer a command acts on: from the context menu, the one the menu
     * was opened over; otherwise, or where that is gone, the one in front.
     * The lab keeps the last context menu event and never clears it, so a
     * command run from the keyboard or the palette must not consult it.
     */
    const target = (menu: boolean): IAttachment | null => {
      const node = menu
        ? app.contextMenuHitTest(candidate =>
            candidate.classList.contains(VIEWER_CLASS)
          )
        : undefined;
      let found: IAttachment | undefined;
      if (node) {
        for (const attachment of attachments.values()) {
          if (attachment.viewer.node === node) {
            found = attachment;
          }
        }
      }
      const viewer = found?.viewer ?? tracker.currentWidget;
      return (viewer && attachments.get(viewer)) ?? null;
    };

    /** The target while its page holds a selection of file text. */
    const marking = (menu: boolean): IAttachment | null => {
      const attachment = target(menu);
      const selection = attachment?.notes.selection;
      return attachment && selection && 'span' in selection ? attachment : null;
    };

    app.commands.addCommand(COMMANDS.mark, {
      label: args => colourLabel(colourOf(args.colour)),
      icon: args => MARK_ICONS[colourOf(args.colour)],
      describedBy: {
        args: {
          type: 'object',
          properties: { colour: { type: 'string', enum: MARK_COLOURS } }
        }
      },
      isVisible: () => marking(true) !== null,
      execute: async args => {
        await marking(true)?.notes.mark(colourOf(args.colour));
      }
    });

    app.commands.addCommand(COMMANDS.markSelection, {
      label: trans.__('Mark the selected passage'),
      icon: args => MARK_ICONS[colourOf(args.colour)],
      describedBy: {
        args: {
          type: 'object',
          properties: { colour: { type: 'string', enum: MARK_COLOURS } }
        }
      },
      // The key runs on a refused selection too, to say why it takes no
      // mark; the palette offers the command only for file text.
      isEnabled: args =>
        (args._luminoEvent as { type?: string } | undefined)?.type ===
        'keybinding'
          ? !!target(false)?.notes.selection
          : marking(false) !== null,
      execute: async args => {
        const attachment = target(false);
        if (attachment) {
          await markSelected(attachment.notes, colourOf(args.colour));
        }
      }
    });

    app.commands.addCommand(COMMANDS.addNote, {
      label: trans.__('Add Comment'),
      icon: NOTE_ICON,
      describedBy: { args: { type: 'object', properties: {} } },
      isVisible: () => marking(true) !== null,
      execute: async () => {
        const attachment = marking(true);
        if (!attachment) {
          return;
        }
        // The note is written on a mark, so a note on unmarked text marks it
        // first and opens the field on the new mark.
        const id = await attachment.notes.mark(DEFAULT_COLOUR);
        if (id) {
          attachment.panel.selectMark(id, true);
        }
      }
    });

    app.commands.addCommand(COMMANDS.setHandle, {
      label: trans.__('Set note handle'),
      caption: trans.__('Set the handle your notes are signed with'),
      describedBy: { args: { type: 'object', properties: {} } },
      isEnabled: () => handle.ready,
      execute: () => handle.change()
    });

    const rowUnderMenu = (): string | null =>
      app.contextMenuHitTest(node => node.classList.contains(ROW_CLASS))
        ?.dataset.mark ?? null;
    app.commands.addCommand(COMMANDS.copyMarkId, {
      label: trans.__('Copy mark ID'),
      describedBy: { args: { type: 'object', properties: {} } },
      isVisible: () => rowUnderMenu() !== null,
      execute: () => {
        const id = rowUnderMenu();
        if (id) {
          Clipboard.copyToSystem(id);
        }
      }
    });

    app.commands.addCommand(COMMANDS.panel, {
      label: args => {
        const state = args.state as PanelState;
        return state === 'hidden' &&
          target(args.menu === true)?.panel.state === 'minimap'
          ? HIDE_MINIMAP_LABEL
          : PANEL_LABELS[state];
      },
      icon: args => PANEL_ICONS[args.state as PanelState],
      describedBy: {
        args: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: PANEL_ORDER },
            menu: { type: 'boolean' }
          }
        }
      },
      isVisible: args => {
        const attachment = target(args.menu === true);
        return !!attachment && attachment.panel.state !== args.state;
      },
      execute: async args => {
        await target(args.menu === true)?.notes.setPanelState(
          args.state as PanelState
        );
      }
    });

    palette?.addItem({
      command: COMMANDS.markSelection,
      category: trans.__('HTML Viewer')
    });
    palette?.addItem({
      command: COMMANDS.panel,
      args: { state: 'expanded' },
      category: trans.__('HTML Viewer')
    });
    palette?.addItem({
      command: COMMANDS.setHandle,
      category: trans.__('HTML Viewer')
    });

    const markMenu = new Menu({ commands: app.commands });
    markMenu.title.label = trans.__('Mark');
    markMenu.title.icon = MARK_MENU_ICON;
    for (const colour of MARK_COLOURS) {
      markMenu.addItem({ command: COMMANDS.mark, args: { colour } });
    }
    app.contextMenu.addItem({
      type: 'submenu',
      submenu: markMenu,
      selector: MARKING_SELECTOR,
      rank: 10
    });
    app.contextMenu.addItem({
      command: COMMANDS.addNote,
      selector: FRAME_SELECTOR,
      rank: 20
    });
    PANEL_ORDER.forEach((state, index) => {
      app.contextMenu.addItem({
        command: COMMANDS.panel,
        args: { state, menu: true },
        selector: FRAME_SELECTOR,
        rank: 30 + index
      });
    });
    app.contextMenu.addItem({
      command: COMMANDS.copyMarkId,
      selector: ROW_SELECTOR,
      rank: 40
    });

    if (settingRegistry) {
      settingRegistry
        .load(PLUGIN_ID)
        .then(settings => {
          const apply = (): void => {
            current = readSettings(settings);
            for (const attachment of attachments.values()) {
              attachment.notes.updateSettings(current);
            }
          };
          handle.settings = settings;
          app.commands.notifyCommandChanged(COMMANDS.setHandle);
          apply();
          settings.changed.connect(apply);
        })
        .catch(reason => {
          console.error(`Failed to load settings for ${PLUGIN_ID}.`, reason);
        });
      settingRegistry
        .load(BUILT_IN_ID)
        .then(settings => {
          const apply = (): void => {
            trustByDefault = settings.composite.trustByDefault === true;
          };
          apply();
          settings.changed.connect(apply);
        })
        .catch(() => {
          // The built-in viewer is not installed; files open untrusted.
        });
    }
  }
};

export default plugin;
