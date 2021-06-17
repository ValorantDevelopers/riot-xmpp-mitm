const highlight = require('cli-highlight').highlight;
const compression = require('compression');
const connect = require('connect');
const axios = require('axios');
const http = require('http');
const tls = require('tls');
const fs = require('fs');

const host = '127.0.0.1';
const port = 8000;
const xmppPort = 5223;

const app = connect();

var remoteHostsMapping = {};
var remotePort = 0;

const requestListener = async (request, response) => {
  request.headers.host = 'clientconfig.rpg.riotgames.com';

  let query = await axios.get('https://clientconfig.rpg.riotgames.com' + request.url, {
    headers: request.headers
  });

  delete query.headers['content-length'];

  console.log(request.method, request.url);

  if (typeof query.data == 'object') {
    let object = query.data;

    if (object['chat.affinities']) {
      let start = 1;
      Object.keys(object['chat.affinities']).forEach(affinity => {
        remoteHostsMapping[start + ''] = object['chat.affinities'][affinity];
        object['chat.affinities'][affinity] = '127.0.0.' + start++;
      });

      remotePort = object['chat.port'];
      object['chat.port'] = xmppPort;
      object['chat.allow_bad_cert.enabled'] = true;
      object['chat.host'] = '127.0.0.1';
    }
  }

  response.writeHead(query.status, query.headers).end(typeof query.data === 'object' ? JSON.stringify(query.data) : query.data);
};

app.use(requestListener);

app.use(compression());

http.createServer(app).listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});

const tlsServerOptions = {
  key: fs.readFileSync('./certs/server.key'),
  cert: fs.readFileSync('./certs/server.crt'),
  rejectUnauthorized: false,
  requestCert: false
};

tls.createServer(tlsServerOptions, (socket) => {
  let targetChatEndpoint = remoteHostsMapping[(socket.localAddress.split('127.0.0.')[1])];
  console.log('proxy to', targetChatEndpoint);
  let tlsClientOptions = {
    host: targetChatEndpoint,
    port: remotePort,
    rejectUnauthorized: false,
    requestCert: false
  };

  socket.targetTlsBuffer = Buffer.alloc(0);

  socket.targetTls = tls.connect(tlsClientOptions, () => {
    if (socket.targetTlsBuffer.length > 0) {
      socket.targetTls.write(socket.targetTlsBuffer);
    }
  });

  socket.targetTls.on('data', buffer => {
    socket.write(buffer);
    console.log('[outgoing]', highlight(buffer.toString(), {language: 'xml', ignoreIllegals: true}));
  });

  socket.on('data', buffer => {
    if (socket.targetTls.readyState == 'opening') {
      socket.targetTlsBuffer = Buffer.concat([socket.targetTlsBuffer, buffer])
    } else {
      socket.targetTls.write(buffer);
    }
    console.log('[incoming]', highlight(buffer.toString(), {language: 'xml', ignoreIllegals: true}));
  });
}).listen(xmppPort);