const http = require('node:http');

// Serve a tiny welcome page and the health endpoint used by Core.
function handleRequest(request, response) {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'UP' }));
    return;
  }
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Hello from Vajravyuha Core');
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

// Start the sample service on the container port mapped by Core.
function start() {
  const server = http.createServer(handleRequest);
  server.listen(3000, '0.0.0.0');
  return server;
}

if (require.main === module) start();

module.exports = { handleRequest, start };
