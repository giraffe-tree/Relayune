import { createInterface } from 'node:readline';
const write = m => process.stdout.write(`${JSON.stringify(m)}\n`);
const reply = (id, result) => write({ id, result });
let seq=0, prompt, reverse;
const session={sessionId:'sess_fixture',workspace:{workspacePath:process.cwd(),workspaceKey:process.cwd()},title:'Fixture',status:'idle',createdAt:1,updatedAt:2};
const event=(type,payload={})=>write({method:'session/event',params:{sessionId:session.sessionId,seq:++seq,type,payload}});
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(!m.method){
  if(m.id==='preferences'){if(m.result?.nativeSearchEnhancementsEnabled!==false)throw Error('invalid preferences');reply(reverse,{session});}
  if(m.id==='permission'){
   if(!['allow','deny'].includes(m.result?.decision))throw Error('invalid permission');
   event('model.streaming',{kind:'reasoning_delta',delta:'private reasoning'});
   event('model.streaming',{kind:'text_delta',delta:m.result.decision==='allow'?'Allowed':'Denied'});
   event('turn.completed',{resultType:'success'});
  }
  return;
 }
 switch(m.method){
 case 'session/list': reply(m.id,{sessions:[session]});break;
 case 'session/create': reverse=m.id;write({id:'preferences',method:'session/requestRuntimePreferences',params:{sessionId:session.sessionId}});break;
 case 'session/resume': reply(m.id,{session});break;
 case 'session/subscribe': reply(m.id,{eventSeq:seq,events:[]});break;
 case 'session/messages': reply(m.id,{messages:[
  {info:{messageId:'u1',role:'user',time:{created:1}},parts:[{type:'text',text:'Question'}]},
  {info:{messageId:'a1',parentMessageId:'u1',role:'assistant',time:{created:2}},parts:[{type:'reasoning',text:'hidden'},{type:'text',text:'Answer'}]},
 ]});break;
 case 'session/send':
  if(prompt){reply(m.id,{accepted:false});break;}
  if(m.params.attachments?.some(a=>a.kind!=='image'||!a.dataBase64||a.localPath))throw Error('invalid image transfer');
  prompt=m.params;reply(m.id,{accepted:true});event('turn.started');
  write({id:'permission',method:'interaction/requestPermission',params:{sessionId:session.sessionId,requestId:'req1',toolName:'Bash',options:[{kind:'allow_once',optionId:'allow_once',name:'Allow once',response:{decision:'allow'}}],input:{command:'npm test'}}});break;
 case 'session/stop':reply(m.id,{});event('turn.terminal',{status:'cancelled'});prompt=null;break;
 default:write({id:m.id,error:{code:-32601,message:'Unsupported method'}});
 }
});
