// Vercel entry point: every request is rewritten here and handled by the same app as `npm start`.
const { createApp } = require('../server.cjs');
let app;
module.exports = (req, res) => {
  app ??= createApp();
  app.server.emit('request', req, res);
};
