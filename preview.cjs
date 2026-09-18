// Compatibility entrypoint; npm start also loads .env.
const { createApp } = require('./server.cjs');
const port = Number(process.env.PORT || 4173);
const { server } = createApp();
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`JIDE NOVA CORE: ${process.env.APP_ORIGIN || 'http://127.0.0.1:' + port}`);
});
