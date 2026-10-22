// Explicit operator command. Never invoked by builds, tests, or server startup.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import { MongoClient } from 'mongodb';
import { initializeLocalAccounts, initializeLocalOwner, resetLocalOwnerPassword } from '../server/local-accounts';

async function restrictedFile(filename, { rootOnly = true } = {}) {
  if (!path.isAbsolute(filename || '')) throw new Error('absolute_secret_file_required');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || (rootOnly && info.uid !== 0) || ![0o600, 0o640].includes(info.mode & 0o777) || info.size > 16384) {
      throw new Error('restricted_file_required');
    }
    return (await file.readFile('utf8')).trim();
  } finally { await file.close(); }
}

export async function readInstanceEnvironment(filename) {
  const content = await restrictedFile(filename);
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(line);
    if (!match || match[1] in values) throw new Error('instance_environment_invalid');
    values[match[1]] = match[2];
  }
  if (values.RELAY_AUTH_MODE !== 'username' || values.MONGO_HOST !== '127.0.0.1' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(values.MONGO_DATABASE || '') ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(values.MONGO_USER || '') ||
      !/^\d{1,5}$/.test(values.MONGO_PORT || '') || Number(values.MONGO_PORT) < 1 || Number(values.MONGO_PORT) > 65535) {
    throw new Error('local_username_instance_required');
  }
  const project = await realpath(values.RELAY_PROJECT_ROOT || '.');
  const config = await realpath(filename);
  if (!path.relative(project, config).startsWith(`..${path.sep}`)) throw new Error('configuration_must_be_outside_repository');
  return values;
}

export function readHiddenPassword(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('password_requires_interactive_terminal');
  return new Promise((resolve, reject) => {
    let password = '';
    const decoder = new StringDecoder('utf8');
    const wasRaw = input.isRaw;
    const finish = (error) => {
      input.off('data', onData); input.setRawMode(Boolean(wasRaw)); input.pause();
      output.write('\n');
      if (error) reject(error); else resolve(password);
    };
    const onData = (data) => {
      for (const char of decoder.write(Buffer.isBuffer(data) ? data : Buffer.from(data))) {
        if (char === '\u0003' || char === '\u0004') { finish(new Error('cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') password = Array.from(password).slice(0, -1).join('');
        else if (char >= ' ' && char !== '\u007f') {
          password += char;
          if (password.length > 128) { finish(new Error('password_too_long')); return; }
        }
      }
    };
    input.setRawMode(true); input.resume(); input.on('data', onData);
  });
}

async function choosePassword() {
  process.stdout.write('Choose password (12–128 characters, hidden): ');
  const password = await readHiddenPassword();
  process.stdout.write('Confirm password (hidden): ');
  const confirmation = await readHiddenPassword();
  if (password !== confirmation) throw new Error('passwords_do_not_match');
  if (password.length < 12 || password.length > 128) throw new Error('password_length_invalid');
  return password;
}

export async function runLocalAccountCommand(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!['initialize', 'reset-password', 'provision-database'].includes(command) ||
      (args.length && (args.length !== 2 || args[0] !== '--config'))) {
    throw new Error('usage: local-account.cjs initialize|reset-password|provision-database [--config /etc/relayune/instance.env]');
  }
  if (process.getuid?.() !== 0) throw new Error('local_account_command_requires_root');
  const env = await readInstanceEnvironment(args[1] || '/etc/relayune/instance.env');
  const appPassword = await restrictedFile(env.MONGO_PASSWORD_FILE);
  let username = 'admin'; let password;
  if (command !== 'provision-database') {
    if (command === 'initialize') {
      const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { username = (await terminal.question('Administrator username [admin]: ')).trim() || 'admin'; }
      finally { terminal.close(); }
    }
    password = await choosePassword();
  }
  const adminUser = process.env.RELAY_MONGO_ADMIN_USER;
  const adminPassword = adminUser ? await restrictedFile(process.env.RELAY_MONGO_ADMIN_PASSWORD_FILE) : undefined;
  const provision = command === 'provision-database';
  const client = new MongoClient(`mongodb://127.0.0.1:${env.MONGO_PORT}`, {
    ...(provision ? (adminUser ? { auth: { username: adminUser, password: adminPassword }, authSource: 'admin' } : {})
      : { auth: { username: env.MONGO_USER, password: appPassword }, authSource: env.MONGO_DATABASE }),
    directConnection: true, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
    retryWrites: false, retryReads: false,
  });
  try {
    await client.connect();
    const db = client.db(env.MONGO_DATABASE);
    if (provision) {
      // Never overwrite an existing database account or administrative password.
      const existing = await db.command({ usersInfo: env.MONGO_USER });
      if (existing.users?.length) throw new Error('database_account_already_exists');
      await db.command({ createUser: env.MONGO_USER, pwd: appPassword,
        roles: [{ role: 'readWrite', db: env.MONGO_DATABASE }] });
    } else {
      await initializeLocalAccounts(db);
      if (command === 'initialize') await initializeLocalOwner(db, username, password);
      else await resetLocalOwnerPassword(db, password);
    }
    process.stdout.write(provision ? 'Instance database account created.\n' : command === 'initialize'
      ? 'Instance administrator initialized. No password was printed or written to a plaintext file.\n'
      : 'Password changed; previous account sessions are invalid. Restart the instance service to drain existing connections.\n');
  } finally { await client.close(); }
}

// The distributed entry is bundled to local-account.cjs. Importing the helpers
// into a test never performs database writes or reads a real configuration.
if (process.argv[1]?.endsWith('/local-account.cjs') || process.argv[1]?.endsWith('\\local-account.cjs')) {
  runLocalAccountCommand().catch((error) => {
    const safe = ['cancelled', 'passwords_do_not_match', 'password_length_invalid', 'instance_already_initialized',
      'instance_not_initialized', 'database_account_already_exists', 'local_account_command_requires_root'];
    process.stderr.write(`${safe.includes(error.message) ? error.message : 'local_account_command_failed; check local configuration and database access'}\n`);
    process.exitCode = 1;
  });
}
