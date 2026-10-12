// Actual Fastify endpoints + built mobile UI; fixture boundary rejects details writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=fileURLToPath(new URL('./evidence/implementation/',import.meta.url));await mkdir(output,{recursive:true});
assert.ok(process.env.SESSION_SECRET&&process.env.DATABASE_URL);
for(const file of ['settlements.ts','cost-ledger.ts','quick-sales.ts'])assert.equal((await readFile(path.join(root,'apps/backend/src',file),'utf8')).replace(/\r\n/g,'\n'),execFileSync('git',['show',`HEAD:apps/backend/src/${file}`],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'),`${file}: calculation/confirmation code must remain byte-identical`);
const {buildApp}=await import(pathToFileURL(path.join(root,'apps/backend/dist/app.js')));const {getPool}=await import(pathToFileURL(path.join(root,'apps/backend/dist/db/client.js')));
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`,batchId=id(100),workspaceId=id(101),userId=id(1);
const members=[{id:id(1),username:'follow'},{id:id(2),username:'dan'},{id:id(3),username:'零成本人员'}];
const sale=(n,source,seller,cost,price,time)=>({id:id(n),source,productId:source==='sale'?id(200):null,productName:source==='sale'?'普通卡片 · 樱':'组合快速售出',productGroupName:null,variantName:null,quantity:2,totalPriceCents:String(price),consumedCostCents:String(cost),costCents:String(cost),serviceFeeCents:'25',sellerUserId:id(seller),sellerUsername:members[seller-1].username,occurredAt:time,createdAt:time});
let normal,quick,expenses,allocations,items,role='owner',workspaceRole='editor',batchStatus='open',crossBatch=false,missing=false,failDetailsQuery=false;
const reset=()=>{
 normal=[sale(11,'sale',1,30007,34922,'2026-10-12T02:00:00Z')];quick=[sale(21,'quick_sale',2,69500,103062,'2026-10-12T11:00:00+08:00')];
 expenses=[{id:id(41),saleId:null,quickSaleId:id(21),name:'邮费',amountCents:'5225',payerUserId:id(1),payerUsername:'follow',occurredAt:'2026-10-12T03:10:00Z'},{id:id(42),saleId:null,quickSaleId:null,name:'其他费用',amountCents:'100',payerUserId:id(2),payerUsername:'dan',occurredAt:'2026-10-12T03:00:00Z'}];
 allocations=[{saleId:id(11),source:'sale',userId:id(1),username:'follow',type:'burden',amountCents:'20000'},{saleId:id(11),source:'sale',userId:id(2),username:'dan',type:'burden',amountCents:'10007'},{saleId:id(11),source:'sale',userId:id(1),username:'follow',type:'payer',amountCents:'30007'},{saleId:id(21),source:'quick_sale',userId:id(1),username:'follow',type:'burden',amountCents:'32000'},{saleId:id(21),source:'quick_sale',userId:id(2),username:'dan',type:'burden',amountCents:'37500'},{saleId:id(21),source:'quick_sale',userId:id(1),username:'follow',type:'payer',amountCents:'69500'}];
 items=[{id:id(31),quickSaleId:id(21),name:'组合卡片',quantity:1,costCents:'40000',consumptionId:id(51),productId:id(200),productName:'库存卡片',linkedQuantity:2,consumedCostCents:'35000'},{id:id(32),quickSaleId:id(21),name:'自由商品',quantity:1,costCents:'29500',consumptionId:null,productId:null,productName:null,linkedQuantity:null,consumedCostCents:null}];
 role='owner';workspaceRole='editor';batchStatus='open';crossBatch=false;missing=false;failDetailsQuery=false;
};reset();
const statements=[],writes=[];let readOnly=false,readonlyQueries=0,releaseCount=0;
const result=rows=>({rows,rowCount:rows.length});
const query=async(sql,params=[])=>{
 if(sql.startsWith('BEGIN')){assert.equal(readOnly,false);readOnly=sql.includes('READ ONLY');return result([])}
 if(sql==='ROLLBACK'||sql==='COMMIT'){readOnly=false;return result([])}
 if(readOnly){assert.match(sql.trim(),/^SELECT\b/i,'Details transaction only SELECT');assert.doesNotMatch(sql,/\bFOR\s+UPDATE\b/i);readonlyQueries++;if(failDetailsQuery)throw new Error('Injected read-only query failure')}
 statements.push({sql,params});
 if(sql.startsWith('INSERT')){assert.equal(readOnly,false);writes.push({sql,params});return result([])}
 if(sql.includes('SELECT username,status,session_version FROM users'))return result([{username:'follow',status:'active',session_version:1}]);
 if(sql.includes('SELECT workspace_id FROM collaboration_batches'))return result(crossBatch?[]:[{workspace_id:workspaceId}]);
 if(sql.includes('SELECT wm.role FROM workspace_members'))return result([{role:workspaceRole}]);
 if(sql.includes('SELECT role FROM batch_members'))return result([{role}]);
 if(sql.includes('SELECT status FROM collaboration_batches'))return result([{status:batchStatus}]);
 if(sql.includes('SELECT u.id,u.username FROM batch_members'))return result(members);
 if(sql.includes('FROM sale_cost_allocations')||sql.includes('FROM quick_sale_cost_allocations')){
  const source=sql.includes('FROM quick_sale_cost_allocations')?'quick_sale':'sale';let rows=allocations.filter(row=>row.source===source&&params[0].includes(row.saleId));if(missing)rows=rows.filter(row=>row.userId!==id(1));
  if(sql.includes('SUM(')){const totals=new Map();for(const row of rows.filter(row=>row.type===params[1]))totals.set(row.userId,(totals.get(row.userId)||0)+Number(row.amountCents));return result([...totals].map(([userId,amount])=>({userId,amount:String(amount)})))}
  return result(rows);
 }
 if(sql.includes('SELECT id FROM quick_sales WHERE'))return result(quick.filter(row=>params[1].includes(row.id)).map(row=>({id:row.id})));
 if(sql.includes('FROM quick_sale_items qsi'))return result(items.filter(row=>params[0].includes(row.quickSaleId)));
 if(sql.includes('FROM sales s')||sql.includes('FROM quick_sales qs')){
  const rows=sql.includes('FROM sales s')?normal:quick;return result(params[1]?rows.filter(row=>params[1].includes(row.id)):rows);
 }
 if(sql.includes('FROM expenses e')){
  const available=expenses.filter(row=>(row.saleId===null||params[1].includes(row.saleId)||params[2].includes(row.quickSaleId)));
  return result(params[3]?available.filter(row=>params[3].includes(row.id)):available);
 }
 if(sql.includes('FROM workspaces w JOIN workspace_members'))return result([{id:workspaceId,name:'测试工作区',kind:'collaborative',role:'editor'}]);
 if(sql.includes('AS invited_at FROM users'))return result(members);
 if(sql.includes('SELECT DISTINCT b.id,b.workspace_id'))return result([{id:batchId,workspace_id:workspaceId,name:'测试批次',role:'owner',status:'open'}]);
 throw new Error(`Unexpected fixture SQL: ${sql}`);
};
const pool=getPool();pool.query=query;pool.connect=async()=>({query,release(){releaseCount++;assert.equal(readOnly,false,'Read-only transaction rolled back before release')}});
const app=await buildApp();await app.ready();const cookie=`thunderledger_session=${app.jwt.sign({sub:userId,sessionVersion:1})}`;
const request=(suffix,payload,authenticated=true)=>app.inject({method:'POST',url:`/api/batches/${batchId}/settlements${suffix ? '/'+suffix : ''}`,headers:authenticated?{cookie}:{},payload});
const selection=()=>({saleIds:normal.map(row=>row.id),quickSaleIds:quick.map(row=>row.id),expenseIds:[]});
const full=()=>({...selection(),profitShares:members.map((row,index)=>({userId:row.id,percentage:index===0?50:index===1?50:0}))});
const details=(member=1,sel=selection())=>request(`members/${id(member)}/details`,sel);
const ok=async(response)=>{const value=await response;assert.equal(value.statusCode,200,value.body);return value.json()};
const normalizeWrites=rows=>rows.map(row=>({sql:row.sql,params:row.params.map(value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)&&!value.startsWith('00000000-')?'<generated-id>':value)}));

export { sale, root,output,id,batchId,workspaceId,members,reset,app,details,request,selection,full,ok,normalizeWrites,statements,writes };
export const fixture={get normal(){return normal},get quick(){return quick},get expenses(){return expenses},get allocations(){return allocations},get items(){return items},set role(value){role=value},set workspaceRole(value){workspaceRole=value},set failDetailsQuery(value){failDetailsQuery=value},set crossBatch(value){crossBatch=value},set batchStatus(value){batchStatus=value},set missing(value){missing=value},get readonlyQueries(){return readonlyQueries},get releaseCount(){return releaseCount}};
