import { Link } from 'react-router';
import { Button } from '../../ui/Button.jsx';

/** A message placed where the document sheet would be. */
export function SheetMessage({ title, children, actions }) {
  return (
    <div className="mx-auto mt-6 max-w-[46rem] rounded-md bg-sheet px-6 py-10 shadow-sheet sm:px-12">
      <h1 className="text-xl font-bold">{title}</h1>
      {children && <div className="mt-2 max-w-prose text-graphite">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function LoadingSheet() {
  return (
    <div aria-busy="true" className="mx-auto mt-6 max-w-[46rem] rounded-md bg-sheet px-6 py-12 shadow-sheet sm:px-16">
      <p className="sr-only">Loading the document…</p>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="h-9 w-2/3 rounded bg-ink/7" />
        <div className="h-4 w-full rounded bg-ink/5" />
        <div className="h-4 w-11/12 rounded bg-ink/5" />
        <div className="h-4 w-4/5 rounded bg-ink/5" />
      </div>
    </div>
  );
}

export function LockedState({ moved, onTakeOver, workspaceId }) {
  return (
    <SheetMessage
      title={moved ? 'You’re now editing this document in another tab' : 'This document is open in another tab'}
      actions={
        <>
          <Button variant="primary" onClick={onTakeOver}>
            Edit here instead
          </Button>
          <Link to={`/w/${workspaceId}`} className="inline-flex h-11 items-center px-2 font-semibold text-carbon underline underline-offset-2">
            Back to documents
          </Link>
        </>
      }
    >
      One tab at a time edits a document on this device, so the copy saved here always has one author. The other tab keeps
      everything it has written.
    </SheetMessage>
  );
}

export function NotOnDeviceState({ workspaceId }) {
  return (
    <SheetMessage
      title="This document isn’t on this device yet"
      actions={
        <Link to={`/w/${workspaceId}`} className="font-semibold text-carbon underline underline-offset-2">
          See documents saved on this device
        </Link>
      }
    >
      You’re offline, and this document hasn’t been opened in this browser before. Open it once while you’re online and a copy
      is kept here for next time.
    </SheetMessage>
  );
}
