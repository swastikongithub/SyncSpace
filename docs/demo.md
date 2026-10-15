# Demo walkthrough (about five minutes)

Uses the seeded accounts (`npm run seed`). All three share the password printed by the seed script (`syncspace-demo-2026` unless `SEED_PASSWORD` is set):

| Person | Email | Role in "Physics study group" |
|---|---|---|
| Ana Ferreira | `ana@demo.syncspace.test` | owner |
| Ben Okafor | `ben@demo.syncspace.test` | editor |
| Chen Li | `chen@demo.syncspace.test` | viewer |

Use two separate browser profiles (or one normal and one private window) so each person has their own session and their own offline storage.

## 1. The promise, before signing in

On the landing page (`/`, signed out), use **Try it: one page, three copies**. Take *your laptop* offline, type in both the laptop and Ana's phone, then reconnect. Both edits survive and the copies come back into register. The demo runs real Yjs replicas in the page.

The sign-in page tells the same story in one gesture: this device's copy lies out of register beside the form and snaps into register when you sign in.

## 2. Two people in one document

1. Window A: sign in as **Ana** and open *Thermodynamics revision notes*.
2. Window B: sign in as **Ben** and open the same document.
3. Type in both. Each sees the other's ply-coloured caret, and the **Copies** panel lists the other person under *Here now*.
4. The header reads **Stored on server** once the server has written each change to MongoDB. That label appears only after the server's acknowledgement.

## 3. Losing the connection

1. In window B, go offline (DevTools → Network → *Offline*, or switch off Wi-Fi).
2. Keep typing as Ben. Then:
   - the header changes to **Saved on this device only**;
   - the device plate in the registration mark slips out of register;
   - edited paragraphs get a carbon *wet-ink* line in the margin;
   - the Copies panel shows exactly how many edits haven't reached the server.
3. Keep typing as Ana in window A, including in the same paragraph.
4. Reload window B **while still offline**. The document reopens from the service worker and IndexedDB, with Ben's unsent edits and their count intact.
5. Bring window B back online. The marks dry, the plates come back into register, and both windows show the same merged text.

## 4. History and restore

1. As Ana, open **History**, name a version ("Before the experiment"), and make a few edits.
2. Select the version to preview it read-only, then **Restore this version**.
3. Ben's window updates immediately, with a notice saying who restored it. History now holds a **Before restoring…** copy, so the restore can itself be undone.

## 5. Roles and access

1. Sign in as **Chen** (viewer): the document is readable, live, and not editable.
2. As Ana, open **Members**: change Ben to *viewer*. Ben's open editor becomes read-only at once; change him back.
3. Invite a new address and open the generated link in another profile. Only the invited email address can accept it, and only once.

## 6. Signing out with unsent work

1. Take a window offline, edit, then **Sign out**. The dialog lists the documents with unsent edits and lets you keep them on the device or erase them.
2. Keep them, go online and sign in again. The edits are sent in the background without reopening the document.
