// Servidor local mínimo para abrir a página de teste em http://localhost:8123/teste/teste.html
// Uso: node teste/servidor.js   (a partir da pasta do projeto)
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const caminho = path.normalize(path.join(RAIZ, decodeURIComponent(req.url.split('?')[0])));
  if (!caminho.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  fs.readFile(caminho, (err, dados) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(caminho)] || 'application/octet-stream',
      // Permite injetar o content.js no PDV real durante o desenvolvimento (só leitura de arquivos locais)
      'Access-Control-Allow-Origin': 'https://web.codxis.api.br',
      'Access-Control-Allow-Private-Network': 'true',
    });
    res.end(dados);
  });
}).listen(8123, '127.0.0.1', () => console.log('Abra http://localhost:8123/teste/teste.html'));
