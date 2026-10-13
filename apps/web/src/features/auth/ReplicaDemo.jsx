// An interactive explanation of SyncSpace's core promise, using real Yjs replicas in the page:
// two devices and a server. Each device can be taken offline; its edits queue on the device and
// merge when it reconnects. Plain DOM sheets with CSS transforms (see ADR 0005).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useAnnounce } from '../../ui/Announcer.jsx';

const SEED = 'Lab meeting moved to Thursday. Bring the results.';
const LATENCY_MS = 140;

function createNetwork() {
  const docs = { laptop: new Y.Doc(), server: new Y.Doc(), phone: new Y.Doc() };
  docs.server.getText('page').insert(0, SEED);
  const seed = Y.encodeStateAsUpdate(docs.server);
  Y.applyUpdate(docs.laptop, seed, 'net');
  Y.applyUpdate(docs.phone, seed, 'net');

  const online = { laptop: true, phone: true };
  const unsent = { laptop: 0, phone: 0 };
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());
  const timers = new Set();

  const later = (fn) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, LATENCY_MS);
    timers.add(timer);
  };

  docs.server.on('update', (update, origin) => {
    for (const device of ['laptop', 'phone']) {
      if (origin?.from !== device && online[device]) later(() => online[device] && Y.applyUpdate(docs[device], update, 'net'));
    }
  });

  for (const device of ['laptop', 'phone']) {
    docs[device].on('update', (update, origin) => {
      if (origin === 'net') return;
      if (online[device]) {
        later(() => {
          if (!online[device]) return; // dropped in flight: resent on reconnect
          Y.applyUpdate(docs.server, update, { from: device });
        });
      } else {
        unsent[device] += 1;
        changed();
      }
    });
  }

  function setOnline(device, value) {
    online[device] = value;
    if (value) {
      // Reconnecting: exchange exactly what each side is missing, then everything is in register.
      Y.applyUpdate(docs.server, Y.encodeStateAsUpdate(docs[device], Y.encodeStateVector(docs.server)), { from: device });
      Y.applyUpdate(docs[device], Y.encodeStateAsUpdate(docs.server, Y.encodeStateVector(docs[device])), 'net');
      unsent[device] = 0;
    }
    changed();
  }

  return {
    docs,
    online,
    unsent,
    setOnline,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Cancels in-flight deliveries. The docs are left to garbage collection. */
    stop() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

/** A <textarea> bound to a Y.Text, keeping the caret steady while remote edits arrive. */
function ReplicaText({ ytext, label, readOnly, id }) {
  const [value, setValue] = useState(() => ytext.toString());
  const ref = useRef(null);

  useEffect(() => {
    const observer = (event, transaction) => {
      if (transaction.origin === 'input') return;
      const element = ref.current;
      let start = element?.selectionStart ?? 0;
      let end = element?.selectionEnd ?? 0;
      let index = 0;
      for (const op of event.delta) {
        if (op.retain) index += op.retain;
        else if (op.insert) {
          const length = op.insert.length;
          if (index < start) start += length;
          if (index < end) end += length;
          index += length;
        } else if (op.delete) {
          if (index < start) start = Math.max(index, start - op.delete);
          if (index < end) end = Math.max(index, end - op.delete);
        }
      }
      setValue(ytext.toString());
      requestAnimationFrame(() => {
        if (element && document.activeElement === element) element.setSelectionRange(start, end);
      });
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  function onChange(event) {
    const next = event.target.value;
    const previous = ytext.toString();
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    ytext.doc.transact(() => {
      const removed = previous.length - prefix - suffix;
      if (removed > 0) ytext.delete(prefix, removed);
      const inserted = next.slice(prefix, next.length - suffix);
      if (inserted) ytext.insert(prefix, inserted);
    }, 'input');
    setValue(next);
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        rows={3}
        className={`w-full resize-none rounded-md bg-transparent p-0 font-writing text-[1rem] leading-relaxed text-ink outline-none ${
          readOnly ? 'cursor-default' : ''
        }`}
      />
    </>
  );
}

function Sheet({ title, status, tone, offset, children, footer }) {
  return (
    <div
      className="ss-plate relative rounded-md border border-rule bg-sheet p-4 shadow-sheet"
      style={{ transform: offset ? 'translate(10px, -6px) rotate(-0.6deg)' : 'none' }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-bold">{title}</p>
        <p className={`text-right text-sm ${tone === 'wet' ? 'font-semibold text-carbon' : 'text-graphite'}`}>{status}</p>
      </div>
      {children}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

function Link({ connected }) {
  return (
    <div aria-hidden="true" className="flex h-7 justify-center">
      <span className={`w-0 border-l-2 ${connected ? 'border-ink/60' : 'border-dashed border-rule-strong'}`} />
    </div>
  );
}

/**
 * @param {{ onState?: (state: Record<'laptop' | 'server' | 'phone', { text: string, online: boolean, unsent: number }>) => void }} props
 *   onState: called with every replica's text and connection whenever any of them changes (the
 *   landing page's light table draws these copies).
 */
export default function ReplicaDemo({ onState }) {
  const network = useMemo(() => createNetwork(), []);
  const [, rerender] = useReducer((n) => n + 1, 0);
  const announce = useAnnounce();
  useEffect(() => network.subscribe(rerender), [network]);
  useEffect(() => () => network.stop(), [network]);
  useEffect(() => {
    if (!onState) return undefined;
    const report = () =>
      onState(
        Object.fromEntries(
          ['laptop', 'server', 'phone'].map((key) => [
            key,
            { text: network.docs[key].getText('page').toString(), online: key === 'server' || network.online[key], unsent: network.unsent[key] ?? 0 },
          ]),
        ),
      );
    report();
    const docs = Object.values(network.docs);
    docs.forEach((doc) => doc.on('update', report));
    const unsubscribe = network.subscribe(report);
    return () => {
      docs.forEach((doc) => doc.off('update', report));
      unsubscribe();
    };
  }, [network, onState]);

  const device = (key, name, shortName) => {
    const online = network.online[key];
    const unsent = network.unsent[key];
    const status = online ? 'In step with the server' : unsent > 0 ? `Offline: ${unsent} ${unsent === 1 ? 'edit' : 'edits'} only here` : 'Offline';
    return (
      <Sheet
        title={name}
        status={status}
        tone={!online && unsent > 0 ? 'wet' : 'dry'}
        offset={!online && unsent > 0}
        footer={
          <button
            type="button"
            onClick={() => {
              network.setOnline(key, !online);
              announce(online ? `${name} is offline. Edits stay on it.` : `${name} reconnected. Its copy merged with the server.`, { visible: false });
            }}
            className={`h-9 rounded-md px-3 text-sm font-semibold ${online ? 'border border-rule-strong text-ink hover:border-carbon hover:text-carbon' : 'bg-carbon text-sheet hover:bg-carbon-strong'}`}
          >
            {online ? `Take ${shortName} offline` : `Reconnect ${shortName}`}
          </button>
        }
      >
        <ReplicaText id={`demo-${key}`} ytext={network.docs[key].getText('page')} label={`${name} copy of the page`} />
      </Sheet>
    );
  };

  return (
    <div className="flex flex-col rounded-lg bg-desk-raised p-4 sm:p-5">
      {device('laptop', 'Your laptop', 'your laptop')}
      <Link connected={network.online.laptop} />
      <Sheet title="Server" status="Stores every copy’s edits">
        <ReplicaText id="demo-server" ytext={network.docs.server.getText('page')} label="Server copy of the page" readOnly />
      </Sheet>
      <Link connected={network.online.phone} />
      {device('phone', 'Ana’s phone', 'Ana’s phone')}
      <p className="mt-4 text-sm text-graphite">
        Runs Yjs, the same merging engine SyncSpace uses, entirely in this page. Nothing here is sent anywhere.
      </p>
    </div>
  );
}
