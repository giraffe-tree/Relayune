import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';

// Exercise the real SMTP envelope without opening a connection or reading files.
// These synthetic addresses cover the recipient-confusion advisories fixed in
// Nodemailer 10.1.4 (GHSA-8c8m-p3m8-cjg8, m943-m63m-w62w and 85x2-q946-cp5h).
const cases = [
  {
    name: 'nested display-name comments do not add a hidden SMTP recipient',
    address: 'Owner (outer(inner) <unexpected@example.invalid>) <expected@allowed.invalid>',
    expected: 'expected@allowed.invalid',
  },
  {
    name: 'a semicolon inside a group comment does not release a hidden recipient',
    address: 'Group: (annotation; <unexpected@example.invalid>) <expected@allowed.invalid>;',
    expected: 'expected@allowed.invalid',
  },
  {
    name: 'an angle character inside a quoted local part cannot change the recipient domain',
    address: '<"local@unexpected.invalid>"@allowed.invalid>',
  },
];

for (const entry of cases) {
  test(entry.name, async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const message = await transport.sendMail({
      from: 'sender@example.invalid',
      to: entry.address,
      subject: 'Synthetic recipient-isolation regression',
      text: 'Synthetic mail body; no account or verification credentials.',
    });
    assert.equal(message.envelope.to.length, 1);
    const recipient = message.envelope.to[0];
    if (entry.expected) assert.equal(recipient, entry.expected);
    assert.equal(recipient.slice(recipient.lastIndexOf('@') + 1), 'allowed.invalid');
    assert.ok(Buffer.isBuffer(message.message));
  });
}
