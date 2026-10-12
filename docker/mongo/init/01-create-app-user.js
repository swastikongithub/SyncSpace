// Runs once, when the mongo-data volume is first initialised (mongosh, authenticated as root).
// Creates the least-privilege account the backend connects with.
const appDbName = process.env.MONGO_APP_DB || 'syncspace';
const username = process.env.MONGO_APP_USERNAME;
const password = process.env.MONGO_APP_PASSWORD;

if (!username || !password) {
  throw new Error('MONGO_APP_USERNAME and MONGO_APP_PASSWORD must be set');
}

const appDb = db.getSiblingDB(appDbName);
if (appDb.getUser(username)) {
  print(`[init] user "${username}" already exists on "${appDbName}"`);
} else {
  appDb.createUser({
    user: username,
    pwd: password,
    roles: [{ role: 'readWrite', db: appDbName }],
  });
  print(`[init] created readWrite user "${username}" on "${appDbName}"`);
}
