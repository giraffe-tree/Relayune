import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../mobile/assets/local_web/font-fallback.js',import.meta.url),'utf8');
function declaration(family,priority='') {
  const values={'font-family':family,'font-size':'19px','font-weight':'700','color':'red'};
  return {values,getPropertyValue:name=>values[name]||'',getPropertyPriority:()=>priority,setProperty(name,value,p){values[name]=value;assert.equal(p,priority)}};
}
function fixture({healthy=false,canvasError=false}={}){
  const sheets=[],inline=[],styles=[],callbacks={},frames=[],timers=[];
  let mutation,observing=false;
  const document={styleSheets:sheets,adoptedStyleSheets:[],hidden:false,documentElement:{},
    head:{append:style=>styles.push(style)},querySelectorAll:()=>inline,
    addEventListener:(name,callback)=>{callbacks[name]=callback},
    createElement:name=>{
      if(name==='style')return {};
      let context={font:'',fillText(text){this.text=text},getImageData(){
        if(canvasError)throw Error('canvas denied');
        return {data:new Uint8ClampedArray([!healthy&&/system-ui|-apple-system/.test(this.font)?1:this.text==='汉'?2:3,255])};
      }};
      return {getContext:()=>context};
    }};
  vm.runInNewContext(script,{document,MutationObserver:class{constructor(cb){mutation=cb}observe(){observing=true}disconnect(){observing=false}},requestAnimationFrame:cb=>frames.push(cb),setInterval:cb=>{timers.push(cb);return timers.length},clearInterval:()=>{},addEventListener:(name,cb)=>{callbacks[name]=cb}});
  return {sheets,inline,styles,callbacks,timers,get observing(){return observing},flush(){mutation?.();while(frames.length)frames.shift()()}};
}
test('healthy or inconclusive font raster never changes the page or starts polling',()=>{
  for(const opts of [{healthy:true},{canvasError:true}]){const f=fixture(opts);assert.equal(f.styles.length,0);assert.equal(f.timers.length,0);assert.equal(f.observing,false)}
});
test('broken system aliases preserve site font order, quoted names, importance and other typography',()=>{
 const f=fixture();
 const a=declaration('"Brand, Serif", system-ui, -apple-system, sans-serif','important');
 const normal=declaration('Georgia, serif');const face=declaration('system-ui');
 f.sheets.push({cssRules:[{type:1,style:a},{type:1,style:normal},{type:5,style:face}]});f.flush();
 assert.equal(a.values['font-family'],'"Brand, Serif", "Relayune Local Web CJK", system-ui, "Relayune Local Web CJK", -apple-system, sans-serif');
 assert.equal(a.values['font-weight'],'700');assert.equal(a.values['font-size'],'19px');assert.equal(a.values.color,'red');
 assert.equal(normal.values['font-family'],'Georgia, serif');assert.equal(face.values['font-family'],'system-ui');
 const once=a.values['font-family'];f.flush();assert.equal(a.values['font-family'],once);
 assert.match(f.styles[0].textContent,/unicode-range:/);assert.match(f.styles[0].textContent,/\/_relayune\/compat\/cjk\.woff2/);
});
test('late styles, inline fonts, nested media rules and CSSOM changes are repaired; BFCache resumes',()=>{
 const f=fixture();const inline=declaration('system-ui');f.inline.push({style:inline});
 const nested=declaration('-apple-system');f.sheets.push({cssRules:[{type:4,cssRules:[{type:1,style:nested}]}]});f.flush();
 assert.match(inline.values['font-family'],/Relayune/);assert.match(nested.values['font-family'],/Relayune/);
 nested.values['font-family']='Custom, system-ui';f.timers[0]();f.flush();assert.equal(nested.values['font-family'],'Custom, "Relayune Local Web CJK", system-ui');
 f.callbacks.pagehide();assert.equal(f.observing,false);f.callbacks.pageshow({persisted:true});assert.equal(f.observing,true);f.flush();
});
