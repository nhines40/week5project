module.exports = async () => {
  const startMongo = require('./setupMongo');
  await startMongo();
};
