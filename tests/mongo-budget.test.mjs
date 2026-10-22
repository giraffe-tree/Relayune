import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';

const dir = await mkdtemp(join(tmpdir(), 'mongo-budget-test-'));
await build({stdin:{contents:"export * from './server/mongo-budget'; export {handleRelayApi} from './server/relay-api';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:join(dir,'budget.cjs')});
const {MongoBudget, MongoBusyError, budgetMongoDatabase, handleRelayApi} = createRequire(import.meta.url)(join(dir,'budget.cjs'));
test.after(() => rm(dir,{recursive:true,force:true}));

test('a delayed first wave cannot release reservations into a second rolling-second burst', async () => {
  const budget = new MongoBudget({limit:6,concurrency:6,waitMs:4000});
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const issued = [];
  const first = Array.from({length:6}, () => budget.run(async () => { await barrier; issued.push(performance.now()); }));
  await delay(1050);
  const second = Array.from({length:6}, () => budget.run(async () => { issued.push(performance.now()); }));
  release();
  await Promise.all(first);
  await delay(30);
  assert.equal(issued.length,6);
  await Promise.all(second);
  assert.ok(issued[6] - issued[5] >= 995);
  for (const time of issued) assert.ok(issued.filter(other => other > time - 1000 && other <= time).length <= 6);
  budget.close();
});

test('bounded queue times out with retryable busy rather than executing rejected work', async () => {
  const budget = new MongoBudget({limit:3,concurrency:1,queueLimit:1,waitMs:30});
  let release;
  const first = budget.run(() => new Promise(resolve => { release = resolve; }));
  let ran = false;
  const queued = budget.run(async () => { ran = true; });
  await assert.rejects(budget.run(async () => {}), {code:'database_busy',status:503});
  await assert.rejects(queued,{code:'database_busy',status:503});
  release(); await first;
  assert.equal(ran,false); budget.close();
});

test('cursor iteration budgets every server batch and cleanup, not just find construction', async () => {
  const costs=[];
  let batch=0, closed=false;
  const cursor={
    get closed() { return closed; }, bufferedCount:()=>0,
    async tryNext() { if (++batch <= 4) return {id:batch}; closed=true; return null; },
    async close() { closed=true; }, sort(){return this;},limit(){return this;},
  };
  const raw={collection(){return {find(){return cursor;}};}};
  const db=budgetMongoDatabase(raw,{run:async (op,cost)=>{costs.push(cost);return op();}});
  assert.deepEqual(await db.collection('x').find({}).sort({id:1}).limit(4).toArray(),[{id:1},{id:2},{id:3},{id:4}]);
  assert.deepEqual(costs,[3,3,3,3,3]);
  assert.equal(await db.collection('x').find({}).tryNext(),null);
});

test('writes, background deletes and bulk statements share the same budget; unknown I/O fails closed', async () => {
  const costs=[];
  const collection={async insertOne(){return {acknowledged:true};},async deleteMany(){return {deletedCount:2};},async bulkWrite(){return {};},watch(){throw Error('must not execute');}};
  const db=budgetMongoDatabase({collection(){return collection;},async command(){return {ok:1};}}, {run:async(op,cost)=>{costs.push(cost);return op();}});
  await db.collection('x').insertOne({}); await db.collection('x').deleteMany({});
  await db.collection('x').bulkWrite([{}, {}, {}]); await db.command({ping:1});
  assert.deepEqual(costs,[1,1,3,1]);
  assert.throws(()=>db.collection('x').watch(),/unsupported_budgeted_database_operation/);
});

test('shutdown rejects pending operations and never starts them later', async () => {
  const budget=new MongoBudget({limit:3,concurrency:1});
  let release; const running=budget.run(()=>new Promise(resolve=>{release=resolve;}));
  const queued=budget.run(async()=>assert.fail('closed queue started'));
  await delay(0); budget.close(); await assert.rejects(queued,{code:'database_busy'});
  release(); await running;
});

test('Relay HTTP reports budget exhaustion as retryable busy, not an opaque internal error', async () => {
  const response = await handleRelayApi(new Request('https://fixture.test/api/bootstrap',{
    headers:{'oai-authenticated-user-email':'fixture@example.test'},
  }),{DB:{prepare(){throw new MongoBusyError();}}});
  assert.equal(response.status,503);
  assert.equal(response.headers.get('Retry-After'),'1');
  assert.equal((await response.json()).error.code,'database_busy');
});
