/**
 * ============================================================
 * DATA GENERATOR
 * ============================================================
 * Generates dynamic test data for payloads and search.
 */

const crypto = require('crypto');

/**
 * Generates unique product data for create APIs.
 */
function generateProductData(userContext, events, done) {
  const id = crypto.randomUUID().substring(0, 5);

  const names = ['James', 'Mary', 'Robert', 'Patricia', 'John'];
  const cities = ['New York', 'Los Angeles', 'Chicago'];

  userContext.vars.productId = `P-${id}`;
  userContext.vars.fullName = names[Math.floor(Math.random() * names.length)];
  userContext.vars.city = cities[Math.floor(Math.random() * cities.length)];
  userContext.vars.zipCode = String(Math.floor(10000 + Math.random() * 90000));
  userContext.vars.price = Math.floor(Math.random() * 9000) + 1000;

  done();
}

/**
 * Generates a random keyword for search scenarios.
 */
function generateRandomData(userContext, events, done) {
  const words = ['laptop', 'phone', 'camera', 'headphones'];
  userContext.vars.keywords = words[Math.floor(Math.random() * words.length)];
  done();
}

module.exports = {
  generateProductData,
  generateRandomData
};
