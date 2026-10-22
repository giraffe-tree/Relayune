import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { piSessionTitle, readPiSession, listPiSessions } from '../relay/pi-history.mjs';
const user = content => ({ type: 'message', message: { role: 'user', content } });

test('Pi titles select first meaningful user text, skipping image and file blocks', () => {
  const branch = [
    user([{ type: 'image', data: 'PRIVATE_IMAGE_BYTES' }, { type: 'file', name: 'photo.png' }]),
    { type: 'message', message: { role: 'assistant', content: 'not a title' } },
    user([{ type: 'image', data: 'PRIVATE_IMAGE_BYTES' }, { type: 'text', text: '  帮我分析这张图片\n找出问题  ' }]),
    user('later message'),
  ];
  for (const name of ['Pi', '新建远程会话', 'New remote session', undefined]) {
    assert.equal(piSessionTitle(name, branch), '帮我分析这张图片 找出问题');
  }
  assert.equal(piSessionTitle('我的标题', branch), '我的标题');
});

test('Pi title strips image markup and waits for text after image-only prompts', () => {
  const images = '<image name="x" path="/private/photo.png">hidden</image> ![photo](data:image/png;base64,AAA) [Image #1] <|image_1|> data:image/png;base64,BBB';
  assert.equal(piSessionTitle('新建远程会话', [user(images)]), '新建远程会话');
  assert.equal(piSessionTitle('Pi', [user(images), user('检查布局')]), '检查布局');
  assert.equal(piSessionTitle('Pi', [user(images + ' 看看哪里需要修改')]), '看看哪里需要修改');
});

test('Pi titles truncate by grapheme without splitting emoji', () => {
  const emoji = '👩🏽‍💻';
  assert.equal(piSessionTitle('Pi', [user(emoji.repeat(33))]), emoji.repeat(32) + '…');
});

test('Pi catalog and reopened history repair legacy defaults without rewriting native files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-title-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sessions'));
  const file = join(root, 'sessions', 'session.jsonl');
  const records = [
    { type: 'session', version: 3, id: 'title-test', cwd: root },
    { type: 'session_info', id: 'name', parentId: null, name: '新建远程会话' },
    { ...user([{ type: 'image', data: 'AAA' }]), id: 'image', parentId: 'name' },
    { ...user('修复手机会话名称'), id: 'text', parentId: 'image' },
  ];
  await writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  assert.equal((await readPiSession(file)).title, '修复手机会话名称');
  assert.equal((await listPiSessions(root)).find(s => s.header.id === 'title-test')?.title, '修复手机会话名称');
  records.push({ type: 'session_info', id: 'renamed', parentId: 'text', name: '用户重命名' });
  await writeFile(file, records.map(JSON.stringify).join('\n') + '\n');
  assert.equal((await readPiSession(file)).title, '用户重命名');
});
