// Tests need a real MongoDB. Set TEST_MONGODB_URI (a server URI without a database name, using an
// account allowed to create databases) to use your own; otherwise an ephemeral mongod is started.
import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function setup(project) {
  if (process.env.TEST_MONGODB_URI) {
    project.provide('mongoUri', process.env.TEST_MONGODB_URI);
    return undefined;
  }
  const mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri());
  return async () => {
    await mongod.stop();
  };
}
