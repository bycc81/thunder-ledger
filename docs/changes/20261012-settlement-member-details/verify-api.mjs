import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,root,output,id,reset,app,details,request,selection,full,ok,normalizeWrites,writes,statements} from './fixture.mjs';
const source=await readFile(path.join(root,'apps/backend/src/settlement-member-details.ts'),'utf8');
assert.doesNotMatch(source,/from ['"][^'"]*(?:cost-ledger|quick-sales|settlements)\.js['"]/,'Details route must not import calculations or ledger');
assert.doesNotMatch(source,/\b(?:rebuildProductCostLedger|saleAllocations)\s*\(/,'Details must read stored allocation records directly');
const checks=['Read-only route dependency guard: no financial/ledger imports or rebuild/allocation calls'];
try {
 for(const scenario of ['normal','quick','mixed','loss','zero','cents']){
  reset(); let {normal,quick,expenses,allocations,items}=fixture;if(scenario==='normal'){quick.splice(0);expenses.splice(0)}if(scenario==='quick'){normal.splice(0);expenses.splice(0)}
  if(scenario==='loss'){for(const row of [...normal,...quick])row.totalPriceCents='100'}
  if(scenario==='zero'){for(const row of [...normal,...quick]){row.costCents='0';row.consumedCostCents='0'}for(const row of allocations)row.amountCents='0';for(const row of items)row.costCents='0'}
  if(scenario==='cents'){normal[0].totalPriceCents='34923';expenses[0].amountCents='5226'}
  const recommendationBefore=await ok(request('recommendation',selection()));const previewBefore=await ok(request('preview',full()));
  writes.length=0;const confirmedBefore=await ok(request('',full()));const writesBefore=normalizeWrites([...writes]);
  const readSnapshot=JSON.stringify({normal,quick,expenses,allocations,items});const writeCount=writes.length;
  for(let member=1;member<=3;member++){
   const value=await ok(details(member));const previewMember=previewBefore.members.find(row=>row.userId===id(member));
   for(const key of ['costShare','purchasesPaid','expensesPaid','salesReceived'])assert.equal(value.totals[key],previewMember[key],`${scenario}: ${key}`);
   assert.equal(value.totals.costTotal,previewBefore.costTotal);assert.equal(value.issues.length,0);
   if(scenario==='mixed'&&member===1){assert.deepEqual(value.transactions.map(row=>row.id),[id(21),id(11)]);assert.deepEqual(value.transactions[0].quickItems.map(row=>row.id),[id(31),id(32)]);assert.equal(value.transactions[0].quickItems[0].consumptions[0].consumedCost,'350.00');assert.equal(value.transactions[0].quickItems[1].consumptions.length,0)}
  }
  assert.equal(writes.length,writeCount);assert.equal(JSON.stringify({normal,quick,expenses,allocations,items}),readSnapshot);
  assert.deepEqual(await ok(request('recommendation',selection())),recommendationBefore);assert.deepEqual(await ok(request('preview',full())),previewBefore);
  writes.length=0;const confirmedAfter=await ok(request('',full()));assert.deepEqual({...confirmedAfter,id:undefined},{...confirmedBefore,id:undefined});assert.deepEqual(normalizeWrites(writes),writesBefore);
  checks.push(`Calculation unchanged ${scenario}: recommendation/preview/confirmation/transfers/write parameters; details match existing member amounts; no mutations`);
 }
 reset();assert.equal((await request(`members/${id(1)}/details`,selection(),false)).statusCode,401);
 fixture.role='viewer';assert.equal((await details()).statusCode,403);fixture.role='owner';fixture.crossBatch=true;assert.equal((await details()).statusCode,404);fixture.crossBatch=false;
 fixture.batchStatus='closed';assert.equal((await details()).statusCode,409);fixture.batchStatus='open';assert.equal((await details(99)).statusCode,404);
 for(const invalid of [{...selection(),saleIds:[id(11),id(11)]},{...selection(),saleIds:['bad']},{...selection(),quickSaleIds:null},{saleIds:[],quickSaleIds:[],expenseIds:[]},{...selection(),expenseIds:[id(42),id(42)]}])assert.equal((await details(1,invalid)).statusCode,400);
 assert.equal((await details(1,{...selection(),saleIds:[id(99)]})).statusCode,409);assert.equal((await details(1,{...selection(),quickSaleIds:[id(99)]})).statusCode,409);assert.equal((await details(1,{...selection(),expenseIds:[id(99)]})).statusCode,409);
 fixture.missing=true;const missingValue=await ok(details());assert.ok(missingValue.issues.length);assert.equal(missingValue.transactions[0].costShare,null);assert.equal(missingValue.totals.costShare,'0.00');fixture.missing=false;
 reset();fixture.role='viewer';fixture.workspaceRole='admin';await ok(details());fixture.workspaceRole='owner';await ok(details());reset();
 const foreign=fixture.allocations.find(row=>row.source==='sale'&&row.type==='burden');foreign.userId=id(99);const foreignValue=await ok(details());assert.ok(foreignValue.issues.some(row=>row.message.includes('非当前批次成员')));reset();
 fixture.items[0].costCents='39999';assert.ok((await ok(details())).issues.some(row=>row.message.includes('商品项')));reset();fixture.items.splice(0);assert.ok((await ok(details())).issues.some(row=>row.message.includes('商品项')));reset();
 const releases=fixture.releaseCount;fixture.failDetailsQuery=true;assert.equal((await details()).statusCode,500);assert.equal(fixture.releaseCount,releases+1);fixture.failDetailsQuery=false;await ok(details());reset();
 checks.push('Diagnostics: foreign-member allocation, missing/mismatched quick items; workspace admin/owner; injected query failure rolls back/releases and next query succeeds');
 checks.push('API validation: 401/403/cross-batch404/closed409/member404/UUID+duplicate400/stale sale+quick+expense409, missing allocation diagnostics, rollback/release');reset();

await writeFile(path.join(output,'api-result.json'),JSON.stringify({checks,readonlyQueries:fixture.readonlyQueries,releaseCount:fixture.releaseCount},null,2));
await writeFile(path.join(output,'api-queries.json'),JSON.stringify([...new Map(statements.filter(row=>/^SELECT\b/i.test(row.sql)).map(row=>[row.sql,row])).values()],null,2));
console.log(checks.join('\n'));
}finally{await app.close()}
