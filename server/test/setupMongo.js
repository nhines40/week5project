const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongo;

/**
 * Starts an in‑memory MongoDB instance and connects Mongoose to it.
 * This function is called by Jest's globalSetup.
 */
module.exports = async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();

  // Make the URI available to any code that reads it (e.g. server.js if you ever need it)
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri, {
    // No need for the old options – they are ignored in Mongoose 7
    // useNewUrlParser: true,
    // useUnifiedTopology: true,
  });
};

/**
 * Called by globalTeardown – shuts everything down.
 */
module.exports.teardown = async () => {
  await mongoose.disconnect();
  await mongo.stop();
};

