const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const database = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const sessions = new Map();

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
}

function getCookies(request) {
    return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((item) => {
        const separator = item.indexOf('=');
        return [item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1).trim())];
    }));
}

function getUser(request) {
    return sessions.get(getCookies(request).session_id);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch (error) {
                reject(error);
            }
        });
        request.on('error', reject);
    });
}

function serveFile(request, response) {
    const requestedPath = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0];
    const protectedFiles = ['/server.js', '/data.json', '/package.json'];
    if (protectedFiles.includes(requestedPath)) {
        sendJson(response, 404, { error: 'Pagina nao encontrada.' });
        return;
    }

    if (requestedPath === '/pagina-interna.html' && !getUser(request)) {
        response.writeHead(302, { Location: '/' });
        response.end();
        return;
    }

    const filePath = path.resolve(ROOT, `.${requestedPath}`);
    if (!filePath.startsWith(ROOT)) {
        sendJson(response, 403, { error: 'Acesso negado.' });
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            sendJson(response, 404, { error: 'Pagina nao encontrada.' });
            return;
        }
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
        response.end(content);
    });
}

const server = http.createServer(async (request, response) => {
    try {
        if (request.method === 'POST' && request.url === '/api/login') {
            const { login, senha } = await readBody(request);
            const user = database.users.find((item) => item.login === String(login || '').trim().toLowerCase() && item.password === senha);
            if (!user) {
                sendJson(response, 401, { error: 'Login ou senha incorretos.' });
                return;
            }

            const sessionId = crypto.randomBytes(24).toString('hex');
            sessions.set(sessionId, { login: user.login, name: user.name });
            response.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Set-Cookie': `session_id=${sessionId}; HttpOnly; SameSite=Lax; Path=/`
            });
            response.end(JSON.stringify({ ok: true }));
            return;
        }

        if (request.method === 'POST' && request.url === '/api/logout') {
            const cookies = getCookies(request);
            sessions.delete(cookies.session_id);
            response.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Set-Cookie': 'session_id=; HttpOnly; Max-Age=0; SameSite=Lax; Path=/'
            });
            response.end(JSON.stringify({ ok: true }));
            return;
        }

        if (request.method === 'GET' && request.url === '/api/session') {
            const user = getUser(request);
            if (!user) {
                sendJson(response, 401, { error: 'Sessao expirada.' });
                return;
            }
            sendJson(response, 200, { user });
            return;
        }

        if (request.method === 'GET' && request.url.startsWith('/api/products')) {
            if (!getUser(request)) {
                sendJson(response, 401, { error: 'Faca login para acessar os produtos.' });
                return;
            }
            sendJson(response, 200, { products: database.products });
            return;
        }

        if (request.method === 'GET') {
            serveFile(request, response);
            return;
        }

        sendJson(response, 405, { error: 'Metodo nao permitido.' });
    } catch (error) {
        sendJson(response, 400, { error: 'Nao foi possivel processar a solicitacao.' });
    }
});

server.listen(PORT, () => {
    console.log(`Site funcionando em http://localhost:${PORT}`);
});
