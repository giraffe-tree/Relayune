// Generates an isolated operator-owned instance directory. Does not install
// services, modify trust stores, contact a server, or publish any artifact.
import { randomBytes, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeInstanceOrigin(value) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !hostname || (!isIP(hostname) && (hostname.length > 253 ||
        !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))) {
    throw new Error('safe_https_origin_required');
  }
  return url.origin;
}

function quotedPath(value) {
  if (!path.isAbsolute(value) || /[\r\n\0$"\\]/.test(value)) throw new Error('safe_absolute_path_required');
  return `"${value}"`;
}

export function nginxInstanceConfiguration({ origin, directory, projectRoot, apiPort = 3192 }) {
  const url = new URL(normalizeInstanceOrigin(origin));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || 443);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 || port < 1024 && port !== 443) {
    throw new Error('invalid_instance_port');
  }
  const upstream = `http://127.0.0.1:${apiPort}`;
  return `# Generated for this instance; no plaintext listener and no credential logging.
server {
    listen ${isIP(host) === 6 ? '[::]' : '0.0.0.0'}:${port} ssl;
    server_name ${host};
    access_log off;
    error_log /dev/null;
    root ${quotedPath(path.join(projectRoot, 'dist/self-hosted'))};
    index index.html;
    ssl_certificate ${quotedPath(path.join(directory, 'tls/server-chain.pem'))};
    ssl_certificate_key ${quotedPath(path.join(directory, 'tls/server-key.pem'))};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_tickets off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Frame-Options DENY always;
    client_max_body_size 50m;
    location = /health {
        proxy_pass ${upstream};
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location ~ ^/api/(?:realtime|stream)$ {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
        proxy_buffering off;
    }
    location /api/ {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 75s;
        proxy_buffering off;
    }
    # These are official distribution channels, not this instance's updates.
    location ^~ /updates/ { return 404; }
    location ^~ /downloads/ { return 404; }
    location / { try_files $uri $uri/ /index.html; }
}
`;
}

function openssl(args) {
  const result = spawnSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  if (result.status !== 0) throw new Error('openssl_certificate_generation_failed');
}

export async function prepareSelfHostedInstance({ directory, projectRoot, origin, apiPort = 3192,
  mongoPort = 27017, mongoDatabase = 'relayune', mongoUser = 'relayune' }) {
  origin = normalizeInstanceOrigin(origin);
  if (!path.isAbsolute(directory) || !path.isAbsolute(projectRoot) || /[\r\n\0]/.test(directory + projectRoot)) {
    throw new Error('absolute_instance_paths_required');
  }
  const project = await realpath(projectRoot);
  const parent = await realpath(path.dirname(directory));
  directory = path.join(parent, path.basename(directory));
  const relative = path.relative(project, directory);
  if (!relative.startsWith(`..${path.sep}`) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(mongoDatabase) || !/^[A-Za-z0-9_-]{1,64}$/.test(mongoUser) ||
      !Number.isInteger(mongoPort) || mongoPort < 1 || mongoPort > 65535) {
    throw new Error('instance_configuration_invalid');
  }
  if (await lstat(directory).catch(() => null)) throw new Error('instance_directory_already_exists');
  const nginx = nginxInstanceConfiguration({ origin, directory, projectRoot: project, apiPort });
  await mkdir(directory, { mode: 0o700 });
  try {
    await mkdir(path.join(directory, 'tls'), { mode: 0o700 });
    const write = async (name, value, mode = 0o600) => writeFile(path.join(directory, name), value, { flag: 'wx', mode });
    await write('mongo-password', randomBytes(32).toString('base64url') + '\n');
    await write('setup-token', randomBytes(32).toString('base64url') + '\n');
    await write('instance.env', [
      'APP_ENV=server', 'HOST=127.0.0.1', `PORT=${apiPort}`, `PUBLIC_ORIGIN=${origin}`,
      'RELAY_AUTH_MODE=username', `RELAY_PROJECT_ROOT=${project}`, `RELAY_SETUP_TOKEN_FILE=${directory}/setup-token`,
      'MONGO_HOST=127.0.0.1', `MONGO_PORT=${mongoPort}`, `MONGO_DATABASE=${mongoDatabase}`, `MONGO_USER=${mongoUser}`,
      `MONGO_PASSWORD_FILE=${directory}/mongo-password`, 'RELAY_BLOB_DIR=/var/lib/relayune/blobs', '',
    ].join('\n'));
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    const san = isIP(host) ? `IP:${host}` : `DNS:${host}`;
    await write('tls/ca.cnf', '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=Relayune instance CA\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
    await write('tls/server.cnf', `[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=Relayune instance\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\nauthorityKeyIdentifier=keyid,issuer\n`);
    const file = (name) => path.join(directory, 'tls', name);
    openssl(['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-sha256',
      '-days', '3650', '-config', file('ca.cnf'), '-keyout', file('ca-key.pem'), '-out', file('ca.pem')]);
    openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-sha256',
      '-config', file('server.cnf'), '-keyout', file('server-key.pem'), '-out', file('server.csr')]);
    openssl(['x509', '-req', '-in', file('server.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca-key.pem'),
      '-CAcreateserial', '-sha256', '-days', '365', '-extfile', file('server.cnf'), '-extensions', 'server', '-out', file('server.pem')]);
    const ca = await readFile(file('ca.pem'), 'utf8');
    const leaf = await readFile(file('server.pem'), 'utf8');
    const caFingerprint = new X509Certificate(ca).fingerprint256;
    await write('tls/server-chain.pem', leaf + ca);
    await write('instance-connection.json', JSON.stringify({ schema_version: 1, origin,
      ca_pem: ca, ca_sha256: caFingerprint }, null, 2) + '\n');
    for (const name of ['ca-key.pem', 'server-key.pem', 'ca.pem', 'server.pem', 'server-chain.pem']) await chmod(file(name), 0o600);
    await write('nginx.conf', nginx);
    await write('OPERATIONS.md', `# This Relayune instance\n\nOrigin: ${origin}\n\nCA SHA-256: ${caFingerprint}\n\n` +
      'Keep this directory outside the repository. CA/server private keys, database password and setup token are private.\n' +
      'Share only tls/ca.pem and its fingerprint through an authenticated channel. Do not share instance.env, keys or setup-token.\n\n' +
      'Next: provision the loopback MongoDB application account with local-account.cjs provision-database --config <instance.env>.\n' +
      'Run local-account.cjs initialize --config <instance.env> in a terminal to choose the owner password. No password is preconfigured.\n' +
      'Install the generated nginx site and run the API with instance.env using your process manager. This generator does not perform those operations.\n' +
      'Give only the API service group read access (root-owned 0640) to the environment/password files and, if HTTP setup is enabled, setup-token.\n' +
      'Keep tls/ca-key.pem root-only 0600. Nginx can load the TLS key as its privileged master. Never grant the API group the CA private key.\n' +
      'For macOS/browser login, explicitly trust this CA in the OS/browser after comparing its fingerprint. Mobile supports a scoped CA import.\n' +
      'A CA import is not a certificate-verification bypass. Hostname, signature and expiration remain checked. Address/key changes require reconfiguration.\n' +
      'Back up MongoDB, encrypted blobs, restricted environment and TLS material together to encrypted external storage. Test restore in an isolated instance.\n' +
      'Renew the leaf certificate before its one-year expiry using the same protected CA, or rotate CA with explicit client re-trust.\n');
    return { origin, directory, caFingerprint };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function runPrepareInstance(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--directory', '--project-root', '--origin'].includes(argv[i]) || !argv[i + 1] || options[argv[i]]) throw new Error('invalid_arguments');
    options[argv[i]] = argv[i + 1];
  }
  if (process.getuid?.() !== 0) throw new Error('run_instance_preparation_as_root');
  // OpenSSL writes by pathname. A protected child is insufficient if another
  // user can rename its parent while this privileged command is running.
  let ancestor = await realpath(path.dirname(options['--directory'] || '/etc/relayune'));
  for (;;) {
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022) !== 0) throw new Error('trusted_root_owned_parent_required');
    if (ancestor === path.dirname(ancestor)) break;
    ancestor = path.dirname(ancestor);
  }
  const result = await prepareSelfHostedInstance({ directory: options['--directory'] || '/etc/relayune',
    projectRoot: options['--project-root'] || process.cwd(), origin: options['--origin'] });
  // Only public connection metadata; no key, password, or setup token is printed.
  console.log(`Instance files prepared: ${result.directory}\nServer: ${result.origin}\nCA SHA-256: ${result.caFingerprint}\nRead OPERATIONS.md before starting services.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPrepareInstance().catch(() => { console.error('Instance preparation failed. Check root permissions, paths, HTTPS origin and OpenSSL; an existing directory is never overwritten.'); process.exitCode = 1; });
}
