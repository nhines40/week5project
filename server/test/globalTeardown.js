module.exports = async () => {
  const { teardown } = require('./setupMongo');
  await teardown();
};
