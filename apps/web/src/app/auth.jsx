import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { deleteUserStore } from '@syncspace/sync-client';
import { api, NetworkError, onUnauthorized } from '../lib/api.js';
import { deviceMemory } from '../lib/device-memory.js';
import { clearAll } from '../lib/resource.js';

const AuthContext = createContext(null);

/**
 * Session states:
 *  checking    first verification in progress
 *  signed-in   the server confirmed the session
 *  offline     the server is unreachable; working as the last user who signed in on this device
 *  expired     the server rejected a previously valid session mid-use (sign in again to resume syncing)
 *  signed-out  no session
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState(() => {
    const last = deviceMemory.pendingSignOut() ? null : deviceMemory.lastUser();
    return { status: 'checking', user: last };
  });
  const checking = useRef(null);

  const verify = useCallback(() => {
    checking.current ??= (async () => {
      try {
        if (deviceMemory.pendingSignOut()) {
          // A sign-out made while offline: end the server session now that we can.
          await api.post('/auth/logout');
          deviceMemory.setPendingSignOut(false);
        }
        const { user } = await api.get('/auth/session');
        deviceMemory.setLastUser(user);
        setState({ status: 'signed-in', user });
      } catch (error) {
        if (error instanceof NetworkError) {
          const last = deviceMemory.pendingSignOut() ? null : deviceMemory.lastUser();
          setState(last ? { status: 'offline', user: last } : { status: 'signed-out', user: null, offline: true });
        } else {
          if (deviceMemory.pendingSignOut()) deviceMemory.setPendingSignOut(false);
          const last = deviceMemory.lastUser();
          setState({ status: 'signed-out', user: null, endedFor: error?.code === 'session_expired' ? last : null });
        }
      } finally {
        checking.current = null;
      }
    })();
    return checking.current;
  }, []);

  useEffect(() => {
    void verify();
  }, [verify]);

  // Coming back online is the moment to confirm an offline session is still valid.
  const onOnline = useEffectEvent(() => {
    if (state.status === 'offline' || (state.status === 'signed-out' && state.offline)) void verify();
  });
  useEffect(() => {
    const listener = () => onOnline();
    window.addEventListener('online', listener);
    return () => window.removeEventListener('online', listener);
  }, []);

  /** The server rejected our session (an API 401 or a WebSocket 4401): keep the user, ask to sign in. */
  const expire = useCallback(() => {
    setState((current) => (current.status === 'signed-in' ? { ...current, status: 'expired' } : current));
  }, []);

  useEffect(() => {
    onUnauthorized(expire);
  }, [expire]);

  const signIn = useCallback(async ({ email, password }) => {
    const { user } = await api.post('/auth/login', { email, password });
    deviceMemory.setPendingSignOut(false);
    deviceMemory.setLastUser(user);
    clearAll();
    setState({ status: 'signed-in', user });
    return user;
  }, []);

  const register = useCallback(async ({ name, email, password }) => {
    const { user } = await api.post('/auth/register', { name, email, password });
    deviceMemory.setPendingSignOut(false);
    deviceMemory.setLastUser(user);
    clearAll();
    setState({ status: 'signed-in', user });
    return user;
  }, []);

  /**
   * Signs out. `eraseDevice` also deletes this user's offline copies from this browser.
   * Returns { serverConfirmed } so the UI can be honest when the server could not be reached.
   */
  const signOut = useCallback(
    async ({ eraseDevice = false } = {}) => {
      const user = state.user;
      let serverConfirmed = true;
      try {
        await api.post('/auth/logout');
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        serverConfirmed = false;
        deviceMemory.setPendingSignOut(true);
      }
      if (eraseDevice && user) await deleteUserStore(user.id).catch(() => {});
      deviceMemory.setLastUser(null);
      clearAll();
      // When offline, the sign-in page explains that the server session ends once back online.
      setState({ status: 'signed-out', user: null, serverSignOutPending: !serverConfirmed });
      return { serverConfirmed };
    },
    [state.user],
  );

  const value = useMemo(
    () => ({ ...state, verify, expire, signIn, register, signOut }),
    [state, verify, expire, signIn, register, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
