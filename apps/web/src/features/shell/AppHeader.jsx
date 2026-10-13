import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronDown, LogOut, Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '../../app/auth.jsx';
import { useLocalData } from '../../app/local-data.jsx';
import { Brand } from '../../ui/Brand.jsx';
import { Button } from '../../ui/Button.jsx';
import { Menu } from '../../ui/Menu.jsx';
import { plyClass } from '../../ui/Ply.jsx';
import { SignOutDialog } from '../account/SignOutDialog.jsx';
import { useWorkspaces } from '../data.js';
import { SearchDialog } from '../search/SearchDialog.jsx';
import { ThemeMenu } from '../../ui/ThemeMenu.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function WorkspaceSwitcher({ workspace }) {
  const workspaces = useWorkspaces();
  const navigate = useNavigate();
  const items = [
    { heading: 'Your workspaces' },
    ...(workspaces.data ?? []).map((item) => ({
      key: item.id,
      label: item.name,
      hint: item.role,
      current: item.id === workspace?.id,
      icon: item.id === workspace?.id ? Check : undefined,
      onSelect: () => navigate(`/w/${item.id}`),
    })),
    { separator: true },
    { key: 'new', label: 'New workspace', icon: Plus, onSelect: () => navigate('/w?new=1') },
  ];
  return (
    <Menu
      label="Switch workspace"
      align="start"
      items={items}
      trigger={
        <button type="button" className="flex h-10 min-w-0 max-w-[48vw] items-center gap-1.5 rounded-md px-2 font-semibold text-ink hover:bg-ink/6 sm:max-w-xs">
          <span className="truncate">{workspace?.name ?? 'Workspace'}</span>
          <ChevronDown aria-hidden="true" size={16} className="flex-none text-graphite" />
        </button>
      }
    />
  );
}

function AccountMenu() {
  const { user } = useAuth();
  const { docs } = useLocalData();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;
  return (
    <>
      <Menu
        label="Account"
        items={[
          { heading: `${user.name} (${user.email})` },
          { key: 'device', label: `${docs.size} ${docs.size === 1 ? 'document' : 'documents'} kept on this device`, disabled: true },
          { separator: true },
          { key: 'signout', label: 'Sign out…', icon: LogOut, onSelect: () => setSigningOut(true), keepFocus: true },
        ]}
        trigger={
          <button type="button" aria-label={`Account: ${user.name}`} className={`flex h-10 items-center gap-2 rounded-md px-2 hover:bg-ink/6 ${plyClass(user.ply)}`}>
            <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-[5px] border border-ply-ink/45 bg-ply text-ply-ink">
              <UserRound size={16} />
            </span>
            <span className="hidden max-w-36 truncate text-sm font-semibold md:inline">{user.name}</span>
          </button>
        }
      />
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </>
  );
}

export function AppHeader({ workspace }) {
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-desk/95 backdrop-blur supports-[backdrop-filter]:bg-desk/85">
      <div className="flex h-14 items-center gap-1 px-2 sm:px-4">
        <Brand to={workspace ? `/w/${workspace.id}` : '/w'} compact />
        <span aria-hidden="true" className="px-1 text-rule-strong">
          /
        </span>
        <WorkspaceSwitcher workspace={workspace} />
        <div className="flex-1" />
        <Button variant="quiet" size="sm" onClick={() => setSearching(true)} aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'} className="gap-2 text-graphite">
          <Search aria-hidden="true" size={17} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border border-rule px-1.5 py-0.5 font-ui text-xs font-semibold text-graphite md:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </Button>
        <ThemeMenu />
        <AccountMenu />
      </div>
      <SearchDialog open={searching} onClose={() => setSearching(false)} workspaceId={workspace?.id} />
    </header>
  );
}
