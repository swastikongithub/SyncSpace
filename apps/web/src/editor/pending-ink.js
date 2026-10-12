// "Wet ink": marks top-level blocks containing local changes the server has not confirmed yet.
//
// A local transaction marks the blocks it touched with version = Infinity ("unresolved"). The
// engine then records the change as local version v, and the editor resolves every unresolved
// mark to v. When the server acknowledges everything up to version d, marks with version <= d
// dry and disappear. Unresolved marks never dry early, so a mark can linger slightly but never
// claims a block is stored when it is not.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

export const pendingInkKey = new PluginKey('syncspacePendingInk');

const UNRESOLVED = Number.POSITIVE_INFINITY;

function touchedBlocks(tr) {
  const ranges = [];
  tr.mapping.maps.forEach((map, index) => {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      const rest = tr.mapping.slice(index + 1);
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  const positions = new Set();
  for (const [from, to] of ranges) {
    const start = Math.max(0, Math.min(from, tr.doc.content.size));
    const end = Math.max(start, Math.min(to, tr.doc.content.size));
    tr.doc.nodesBetween(start, end === start ? Math.min(start + 1, tr.doc.content.size) : end, (node, pos, parent) => {
      if (parent === tr.doc) {
        if (node.type.name !== 'title') positions.add(pos);
        return false;
      }
      return true;
    });
  }
  return [...positions];
}

function markBlocks(set, doc, positions) {
  let next = set;
  for (const pos of positions) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    const existing = next.find(pos, pos + node.nodeSize, (spec) => spec.pendingInk);
    next = next.remove(existing);
    next = next.add(doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'ss-wet' }, { pendingInk: true, version: UNRESOLVED })]);
  }
  return next;
}

export const PendingInk = Extension.create({
  name: 'pendingInk',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pendingInkKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(pendingInkKey);
            if (meta?.resolve !== undefined) {
              const unresolved = next.find(undefined, undefined, (spec) => spec.version === UNRESOLVED);
              next = next.remove(unresolved).add(
                tr.doc,
                unresolved.map((decoration) =>
                  Decoration.node(decoration.from, decoration.to, { class: 'ss-wet' }, { pendingInk: true, version: meta.resolve }),
                ),
              );
            }
            if (meta?.durable !== undefined) {
              const dry = meta.allClear
                ? next.find()
                : next.find(undefined, undefined, (spec) => spec.version !== UNRESOLVED && spec.version <= meta.durable);
              next = next.remove(dry);
            }
            const sync = tr.getMeta(ySyncPluginKey);
            const remote = Boolean(sync?.isChangeOrigin);
            if (tr.docChanged && !remote) next = markBlocks(next, tr.doc, touchedBlocks(tr));
            return next;
          },
        },
        props: {
          decorations(state) {
            return pendingInkKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Connects the plugin to a sync session; returns an unsubscribe function. */
export function bindPendingInk(editor, session) {
  let lastLocal = session.state.localVersion;
  let lastDurable = session.state.durableVersion;
  return session.on('change', (state) => {
    const meta = {};
    if (state.localVersion !== lastLocal) {
      lastLocal = state.localVersion;
      meta.resolve = state.localVersion;
    }
    if (state.durableVersion !== lastDurable) {
      lastDurable = state.durableVersion;
      meta.durable = state.durableVersion;
      meta.allClear = state.durableVersion >= state.localVersion;
    }
    if (Object.keys(meta).length === 0) return;
    // Defer: this listener can fire while ProseMirror is mid-update.
    queueMicrotask(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(pendingInkKey, meta).setMeta('addToHistory', false));
    });
  });
}
