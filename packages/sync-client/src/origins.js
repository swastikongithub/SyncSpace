/** Transaction origin for state read back from this device's storage. */
export const LOCAL_LOAD = Symbol('syncspace:local-load');
/** Transaction origin for changes received from the server. */
export const REMOTE = Symbol('syncspace:remote');
