import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexMessageSubmissions, submissionReceipt } from '../relay/codex-message-submissions.mjs';

test('cross-session concurrent admissions cannot exceed the durable receipt capacity', async () => {
  const ledger = new CodexMessageSubmissions();
  const results = await Promise.allSettled(Array.from({length:1001},(_,i)=>ledger.reserve(`S${i}`,'m')));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1000);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(ledger.receipts.size,1000);
});

test('new submissions reclaim expired receipts without removing unexpired uncertain work', async () => {
  let now=0;const removed=[];
  const ledger=new CodexMessageSubmissions({now:()=>now,remove:async r=>removed.push(r.clientMessageId)});
  await ledger.reserve('S','expired');now=24*60*60_000-1;
  await ledger.reserve('S','still_pending');now+=2;
  await ledger.reserve('S','new');
  assert.deepEqual(removed,['expired']);
  assert.equal(ledger.get('S','still_pending').state,'pending');
});

test('receipt sanitization never retains content hidden in extra fields or malformed IDs', () => {
  const value=submissionReceipt({sessionId:'S',clientMessageId:'m',createdAt:1,state:'accepted',
    content:'PRIVATE',attachments:['PRIVATE'],runtimeSettings:{secret:'PRIVATE'},
    result:{mode:'started',turnId:{secret:'PRIVATE'},input:'PRIVATE'}});
  assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
  assert.equal(value.result.turnId,null);
  assert.equal(submissionReceipt({sessionId:'S',clientMessageId:{secret:'PRIVATE'},createdAt:1,state:'pending'}),null);
});
