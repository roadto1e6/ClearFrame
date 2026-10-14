const $ = id => document.getElementById(id);
const api = window.__TAURI__, invoke = api?.core.invoke;
let media=null, element=null, rects=[], selected=-1, history=[], future=[], drag=null;
let busy=false, compare=false, heldCompare=false, pinnedCompare=false, showGuides=true, tool='draw', renderer=null;
let zoom=1, scale=1, dirty=false, savedSignature='[]', busyTimer=0, busyStart=0, seekDragging=false;
let lastTime=-1, renderDirty=true, raf=0, renderingError=false, fieldStart=null;
const canvas=$('preview'), overlay=$('overlay'), ctx=overlay.getContext('2d');
const clamp=(n,l,h)=>Math.max(l,Math.min(h,n));
const sig=()=>JSON.stringify(rects);
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);$('statusDot').style.background=error?'#ecaaa0':'#8fb99a';}
function controls(){
 const editing=!!media&&!busy;
 document.body.classList.toggle('no-media',!media);
 $('transport').hidden=!media?.video;
 $('open').textContent=media?'更换素材':'导入素材';
 $('export').title=!media?'请先导入素材':!rects.length?'请先框选需要修补的区域':'导出修补结果 (Ctrl+Enter)';
 $('compare').disabled=!editing||!rects.length;
 ['open','emptyOpen','help'].forEach(id=>$(id).disabled=busy);
 $('export').disabled=!editing||!rects.length;
 ['guides','fit','zoomIn','zoomOut','drawTool','selectTool'].forEach(id=>$(id).disabled=!editing);
 $('remove').disabled=$('duplicate').disabled=!editing||selected<0;
 $('duplicate').disabled ||=rects.length>=16;
 $('clear').disabled=!editing||!rects.length;
 $('undo').disabled=!editing||!history.length;$('redo').disabled=!editing||!future.length;
 ['play','seek','mute','speed'].forEach(id=>$(id).disabled=!editing||!media.video);
 ['rectX','rectY','rectW','rectH'].forEach(id=>$(id).disabled=!editing);
 $('transport').classList.toggle('image',!!media&&!media.video);
 document.body.classList.toggle('busy',busy);
}
function capture(){return {rects:structuredClone(rects),selected};}
function commit(before){
 if(JSON.stringify(before.rects)===sig())return;
 history.push(before);if(history.length>80)history.shift();future=[];
 dirty=sig()!==savedSignature;renderDirty=true;list();
}
function restore(state){rects=structuredClone(state.rects);selected=state.selected;dirty=sig()!==savedSignature;renderDirty=true;list();drawOverlay();}
function undo(){if(busy||drag||!history.length)return;future.push(capture());restore(history.pop());}
function redo(){if(busy||drag||!future.length)return;history.push(capture());restore(future.pop());}
function inspector(){
 const r=rects[selected];$('inspector').hidden=!r;
 if(!r)return;
 $('selectedTitle').textContent='区域 '+String(selected+1).padStart(2,'0')+' · 精确调整';
 [['rectX',r.x,media.width],['rectY',r.y,media.height],['rectW',r.w,media.width],['rectH',r.h,media.height]].forEach(([id,v,n])=>{if(document.activeElement!==$(id))$(id).value=Math.round(v*n);});
}
function list(){
 const focused=document.activeElement?.dataset?.region;
 $('regions').replaceChildren();$('count').textContent=rects.length+' / 16';
 if(!rects.length){const n=document.createElement('div');n.className='no-regions';const b=document.createElement('b');b.textContent='＋';n.append(b,document.createTextNode(media?'在画面拖动，创建第一个选区':'导入素材后，开始框选'));$('regions').append(n);}
 rects.forEach((r,i)=>{
  const b=document.createElement('button');b.className='region'+(i===selected?' active':'');b.dataset.region=i;b.setAttribute('role','option');b.setAttribute('aria-selected',i===selected);
  const left=document.createElement('span');left.className='region-left';const number=document.createElement('span');number.className='number';number.textContent=String(i+1).padStart(2,'0');left.append(number,document.createTextNode('修补区域'));
  const size=document.createElement('small');size.textContent=Math.round(r.w*media.width)+' × '+Math.round(r.h*media.height);b.append(left,size);
  b.onclick=()=>{selected=i;setTool('select');list();drawOverlay();};
  $('regions').append(b);
 });
 if(focused!==undefined)$('regions').querySelector('[data-region="'+focused+'"]')?.focus({preventScroll:true});
 const overlap=rects.some((a,i)=>rects.some((b,j)=>j>i&&a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
 $('regionTip').textContent=overlap?'选框有重叠，建议合并为一个区域，减少预览和导出之间的差异。':rects.length?'拖动边缘控制点调整大小；方向键微调 1 像素，按住 Shift 微调 10 像素。':'在画面上拖动添加选区。支持最多 16 个区域。';
 inspector();controls();
}
function handles(r){return [['nw',r.x,r.y],['n',r.x+r.w/2,r.y],['ne',r.x+r.w,r.y],['e',r.x+r.w,r.y+r.h/2],['se',r.x+r.w,r.y+r.h],['s',r.x+r.w/2,r.y+r.h],['sw',r.x,r.y+r.h],['w',r.x,r.y+r.h/2]];}
function drawOverlay(){
 const dpr=overlay.width/parseFloat(overlay.style.width||overlay.width),w=overlay.width/dpr,h=overlay.height/dpr;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(compare||!showGuides)return;
 rects.forEach((r,i)=>{
  const x=r.x*w,y=r.y*h,rw=r.w*w,rh=r.h*h;
  ctx.strokeStyle=i===selected?'#b8f2cc':'#8faaa1';ctx.lineWidth=i===selected?1.5:1;
  ctx.fillStyle=i===selected?'#b7f8c90b':'transparent';ctx.fillRect(x,y,rw,rh);ctx.strokeRect(x,y,rw,rh);
  const labelY=y>=22?y-22:y+2;ctx.fillStyle=i===selected?'#b8f2cc':'#344a3e';ctx.fillRect(x,labelY,25,18);ctx.fillStyle=i===selected?'#193323':'#d3e9da';ctx.font='10px Segoe UI';ctx.fillText(String(i+1).padStart(2,'0'),x+6,labelY+12);
  if(i===selected)handles(r).forEach(([,hx,hy])=>{ctx.fillStyle='#10231a';ctx.fillRect(hx*w-4,hy*h-4,8,8);ctx.strokeStyle='#b8f2cc';ctx.lineWidth=1;ctx.strokeRect(hx*w-4,hy*h-4,8,8);});
 });
}
function fit(reset=false){
 if(!media)return;if(reset)zoom=1;
 const stage=$('stage'),base=Math.min((stage.clientWidth-50)/media.width,(stage.clientHeight-50)/media.height,1);
 scale=Math.max(.01,base)*zoom;const w=Math.max(2,Math.round(media.width*scale)),h=Math.max(2,Math.round(media.height*scale)),dpr=Math.min(devicePixelRatio||1,2);
 $('frame').style.width=w+'px';$('frame').style.height=h+'px';
 for(const c of [canvas,overlay]){c.style.width=w+'px';c.style.height=h+'px';c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
 $('zoomValue').textContent=Math.round(scale*100)+'%';
 $('fit').classList.toggle('active',zoom===1);renderDirty=true;drawOverlay();
 if(reset){stage.scrollTop=0;stage.scrollLeft=0;}
}
function setZoom(factor){
 if(!media||busy)return;const stage=$('stage'),rx=(stage.scrollLeft+stage.clientWidth/2)/Math.max(stage.scrollWidth,1),ry=(stage.scrollTop+stage.clientHeight/2)/Math.max(stage.scrollHeight,1);
 zoom=clamp(zoom*factor,.5,8);fit();stage.scrollLeft=rx*stage.scrollWidth-stage.clientWidth/2;stage.scrollTop=ry*stage.scrollHeight-stage.clientHeight/2;
}
function time(t){t=Number.isFinite(t)?t:0;return String(Math.floor(t/60)).padStart(2,'0')+':'+(t%60).toFixed(1).padStart(4,'0');}
function updateTransport(){
 if(!media?.video||!element)return;
 $('time').replaceChildren(document.createTextNode(time(element.currentTime)+' '));
 const em=document.createElement('em');em.textContent='/ '+time(element.duration);$('time').append(em);
 if(!seekDragging)$('seek').value=element.duration?element.currentTime/element.duration*1000:0;
 $('play').textContent=element.paused?'▶':'Ⅱ';$('play').setAttribute('aria-label',element.paused?'播放':'暂停');
}
function draw(){
 try{renderer?.();renderingError=false;drawOverlay();}
 catch(e){if(!renderingError)status('预览未能显示：'+String(e),true);renderingError=true;}
}
function loop(){
 if(media?.video&&element?.readyState>=2&&element.currentTime!==lastTime){lastTime=element.currentTime;renderDirty=true;updateTransport();}
 if(renderDirty){draw();renderDirty=false;}
 raf=requestAnimationFrame(loop);
}
function setTool(value){
 if(busy)return;
 pinnedCompare=heldCompare=false;comparison();
 showGuides=true;$('guides').setAttribute('aria-pressed','true');$('guides').textContent='显示选框';
 tool=value;['draw','select'].forEach(v=>{$(v+'Tool').classList.toggle('active',v===value);$(v+'Tool').setAttribute('aria-pressed',v===value);});overlay.style.cursor=value==='draw'?'crosshair':'default';$('canvasHint').textContent=value==='draw'?'在空白处拖动添加选区，也可拖动已有选区':'选择并拖动选区；放大后滚动查看';}
function comparison(){compare=pinnedCompare||heldCompare;$('compare').setAttribute('aria-pressed',pinnedCompare);$('viewLabel').classList.toggle('original',compare);$('viewLabel').replaceChildren();const dot=document.createElement('i');$('viewLabel').append(dot,document.createTextNode(compare?'原片对照':'修补预览'));renderDirty=true;drawOverlay();}
function setBusy(value,kind='import'){
 busy=value;controls();$('busyVeil').hidden=!value;clearInterval(busyTimer);
 if(value){element?.pause?.();heldCompare=false;comparison();busyStart=Date.now();$('busyTitle').textContent=kind==='import'?'正在准备素材':'正在导出修补结果';$('busyDetail').textContent=kind==='import'?'选择文件后会生成本机预览，大视频需要稍候。':'选择保存位置后，将以原始分辨率处理。';$('busyProgress').removeAttribute('value');$('elapsed').textContent='已用时 0 秒';busyTimer=setInterval(()=>{$('elapsed').textContent='已用时 '+Math.floor((Date.now()-busyStart)/1000)+' 秒';},1000);}
}
async function confirmReplace(){
 if(!dirty||!rects.length)return true;
 const dialog=$('confirmDialog');dialog.showModal();
 return new Promise(resolve=>{const finish=v=>{dialog.close();dialog.oncancel=null;$('confirmAccept').onclick=null;$('confirmCancel').onclick=null;resolve(v);};$('confirmAccept').onclick=()=>finish(true);$('confirmCancel').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};});
}
async function open(){
 if(busy||!await confirmReplace())return;
 if(!invoke){status('请在 ClearFrame 桌面程序中导入素材。',true);return;}
 setBusy(true);status('正在选择素材…');let changed=false;
 try{
  const info=await invoke('open_media');if(!info){status(media?'已取消导入，继续编辑当前素材。':'等待导入素材');return;}
  changed=true;element?.pause?.();element?.removeAttribute?.('src');media=info;rects=[];history=[];future=[];selected=-1;dirty=false;savedSignature='[]';pinnedCompare=heldCompare=false;comparison();lastTime=-1;
  $('busyDetail').textContent='正在加载预览…';
  const next=info.video?document.createElement('video'):new Image();next.crossOrigin='anonymous';
  if(info.video){next.preload='auto';next.playsInline=true;next.playbackRate=Number($('speed').value);next.muted=$('mute').getAttribute('aria-pressed')==='true';}
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('预览加载超时，请重新导入。')),30000);
   next.addEventListener(info.video?'loadeddata':'load',()=>{clearTimeout(timer);resolve();},{once:true});
   next.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('预览加载失败，请检查素材是否有效。'));},{once:true});
   next.src=api.core.convertFileSrc(info.preview);
  });
  element=next;renderer ||=createRenderer();$('empty').hidden=true;$('frame').hidden=false;
  $('type').textContent=info.video?'VIDEO':'IMAGE';$('filename').textContent=info.name;$('filename').title=info.name;$('dimensions').textContent=info.width+' × '+info.height;
  $('time').textContent=info.video?'00:00.0 / '+time(info.duration):'静态图片';
  $('outputType').textContent=info.video?'MP4 · H.264':'PNG';
  $('outputDetail').textContent=info.width+' × '+info.height+(info.video?' · 保留音轨（AAC）':' · 原始分辨率');
  $('savedBox').hidden=true;$('saved').value='';$('progress').hidden=true;
  setTool('draw');fit(true);list();status('素材已就绪，拖动框选水印区域。');
 }catch(e){if(changed){media=element=null;rects=[];selected=-1;$('frame').hidden=true;$('empty').hidden=false;list();}status(String(e),true);}
 finally{setBusy(false);if(changed&&media)setTool('draw');}
}
function point(e){const b=overlay.getBoundingClientRect();return{x:clamp((e.clientX-b.left)/b.width,0,1),y:clamp((e.clientY-b.top)/b.height,0,1)};}
function hitTest(p){
 const bw=parseFloat(overlay.style.width),bh=parseFloat(overlay.style.height);
 if(rects[selected])for(const [name,x,y] of handles(rects[selected]))if(Math.abs(p.x-x)*bw<9&&Math.abs(p.y-y)*bh<9)return {index:selected,handle:name};
 for(let i=rects.length-1;i>=0;i--){const r=rects[i];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)return {index:i,handle:'move'};}
 return null;
}
const cursors={nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',move:'move'};
overlay.onpointerdown=e=>{
 if(!media||busy||compare||!showGuides||e.button!==0)return;
 overlay.focus({preventScroll:true});const p=point(e),hit=hitTest(p);
 if(!hit&&tool==='select'){selected=-1;list();drawOverlay();return;}
 if(!hit&&rects.length>=16){status('最多可添加 16 个区域。删除一个后再试。');return;}
 const before=capture();element?.pause?.();updateTransport();
 if(!hit){rects.push({x:p.x,y:p.y,w:0,h:0});selected=rects.length-1;drag={mode:'new',start:p,before};}
 else{selected=hit.index;drag={mode:hit.handle,start:p,origin:{...rects[selected]},before};}
 overlay.setPointerCapture(e.pointerId);list();drawOverlay();
};
overlay.onpointermove=e=>{
 if(!media||busy)return;const p=point(e);
 if(!drag){const hit=showGuides&&!compare?hitTest(p):null;overlay.style.cursor=compare||!showGuides?'default':hit?cursors[hit.handle]:tool==='draw'?'crosshair':'default';return;}
 const r=rects[selected],o=drag.origin,m=drag.mode,minW=3/media.width,minH=3/media.height;
 if(m==='new'){r.x=Math.min(p.x,drag.start.x);r.y=Math.min(p.y,drag.start.y);r.w=Math.abs(p.x-drag.start.x);r.h=Math.abs(p.y-drag.start.y);}
 else if(m==='move'){r.x=clamp(o.x+p.x-drag.start.x,0,1-r.w);r.y=clamp(o.y+p.y-drag.start.y,0,1-r.h);}
 else{
  let l=o.x,t=o.y,right=o.x+o.w,bottom=o.y+o.h;
  if(m.includes('w'))l=clamp(p.x,0,right-minW);if(m.includes('e'))right=clamp(p.x,l+minW,1);
  if(m.includes('n'))t=clamp(p.y,0,bottom-minH);if(m.includes('s'))bottom=clamp(p.y,t+minH,1);
  Object.assign(r,{x:l,y:t,w:right-l,h:bottom-t});
 }
 inspector();renderDirty=true;drawOverlay();
};
function finish(cancel=false){
 if(!drag)return;const before=drag.before;drag=null;
 if(cancel){rects=before.rects;selected=before.selected;}
 else{rects=rects.filter(r=>r.w*media.width>=3&&r.h*media.height>=3);selected=Math.min(selected,rects.length-1);commit(before);}
 renderDirty=true;list();drawOverlay();
}
overlay.onpointerup=()=>finish();overlay.onpointercancel=()=>finish(true);overlay.onlostpointercapture=()=>{if(drag)finish(true);};
function remove(){if(busy||drag||selected<0)return;const before=capture();rects.splice(selected,1);selected=Math.min(selected,rects.length-1);commit(before);drawOverlay();}
function duplicate(){if(busy||drag||selected<0||rects.length>=16)return;const before=capture(),r={...rects[selected]};r.x=clamp(r.x+12/media.width,0,1-r.w);r.y=clamp(r.y+12/media.height,0,1-r.h);rects.push(r);selected=rects.length-1;commit(before);}
for(const id of ['rectX','rectY','rectW','rectH']){
 $(id).onfocus=()=>{fieldStart=capture();};
 $(id).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$(id).blur();overlay.focus({preventScroll:true});}};
 $(id).onchange=()=>{
  if(!media||busy||selected<0)return;const value=Number($(id).value);if(!Number.isFinite(value))return inspector();
  const before=fieldStart||capture(),r=rects[selected],w=media.width,h=media.height;
  if(id==='rectX')r.x=clamp(Math.round(value)/w,0,1-r.w);
  if(id==='rectY')r.y=clamp(Math.round(value)/h,0,1-r.h);
  if(id==='rectW')r.w=clamp(Math.round(value)/w,3/w,1-r.x);
  if(id==='rectH')r.h=clamp(Math.round(value)/h,3/h,1-r.y);
  commit(before);fieldStart=capture();$(id).value=Math.round(r[{rectX:'x',rectY:'y',rectW:'w',rectH:'h'}[id]]*(id==='rectX'||id==='rectW'?w:h));renderDirty=true;
 };
}
async function exportMedia(){
 if(busy||!media||!rects.length)return;
 setBusy(true,'export');status('请选择保存位置…');$('savedBox').hidden=true;$('progress').hidden=false;$('progress').value=0;
 try{const signature=sig(),path=await invoke('export_media',{request:{rects}});
  if(path){savedSignature=signature;dirty=false;status('导出完成');$('savedBox').hidden=false;$('saved').value=path;$('saved').title=path;$('progress').value=100;}
  else{status('已取消导出，选区已保留。');$('progress').hidden=true;}
 }catch(e){status('导出失败：'+String(e),true);$('progress').hidden=true;}finally{setBusy(false,'export');}
}
$('open').onclick=$('emptyOpen').onclick=open;$('export').onclick=exportMedia;
$('undo').onclick=undo;$('redo').onclick=redo;$('remove').onclick=remove;$('duplicate').onclick=duplicate;
$('clear').onclick=()=>{if(busy||!rects.length)return;const before=capture();rects=[];selected=-1;commit(before);status('选区已清空，可撤销恢复。');};
$('drawTool').onclick=()=>setTool('draw');$('selectTool').onclick=()=>setTool('select');
$('compare').onclick=()=>{pinnedCompare=!pinnedCompare;comparison();};
function guides(){showGuides=!showGuides;$('guides').setAttribute('aria-pressed',showGuides);$('guides').textContent=showGuides?'显示选框':'选框已隐藏';drawOverlay();}
$('guides').onclick=guides;$('zoomIn').onclick=()=>setZoom(1.25);$('zoomOut').onclick=()=>setZoom(.8);$('fit').onclick=()=>fit(true);
$('saved').onclick=e=>e.target.select();
$('play').onclick=async()=>{if(!media?.video||busy)return;try{element.paused?await element.play():element.pause();updateTransport();}catch(e){status('无法播放：'+String(e),true);}};
$('mute').onclick=()=>{element.muted=!element.muted;$('mute').textContent=element.muted?'声音 关':'声音 开';$('mute').setAttribute('aria-pressed',element.muted);};
$('speed').onchange=e=>{if(media?.video)element.playbackRate=Number(e.target.value);};
$('seek').onpointerdown=()=>{seekDragging=true;};$('seek').onpointerup=$('seek').onpointercancel=()=>{seekDragging=false;};
$('seek').oninput=e=>{if(media?.video&&Number.isFinite(element.duration)){element.currentTime=Number(e.target.value)/1000*element.duration;updateTransport();renderDirty=true;}};
$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
window.addEventListener('keydown',e=>{
 if(document.querySelector('dialog[open]')||busy)return;
 const input=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable;
 if(input)return;const mod=e.ctrlKey||e.metaKey;
 if(mod&&e.code==='KeyO'){e.preventDefault();open();return;}
 if(mod&&e.code==='Enter'){e.preventDefault();exportMedia();return;}
 if(e.code==='Escape'){e.preventDefault();if(drag)finish(true);else{pinnedCompare=heldCompare=false;comparison();}return;}
 if(!media)return;
 if(e.code==='Space'){e.preventDefault();heldCompare=true;comparison();return;}
 if(mod&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?redo():undo();return;}
 if(mod&&e.code==='KeyY'){e.preventDefault();redo();return;}
 if(e.code==='Delete'||e.code==='Backspace'){e.preventDefault();remove();return;}
 if(!mod&&e.code==='KeyD')setTool('draw');if(!mod&&e.code==='KeyV')setTool('select');
 if(!mod&&e.code==='KeyF')fit(true);if(!mod&&e.code==='KeyH')guides();
 if(e.code.startsWith('Arrow')&&selected>=0&&!drag){
  e.preventDefault();const before=capture(),r=rects[selected],step=e.shiftKey?10:1;
  if(e.code==='ArrowLeft')r.x=clamp(r.x-step/media.width,0,1-r.w);if(e.code==='ArrowRight')r.x=clamp(r.x+step/media.width,0,1-r.w);
  if(e.code==='ArrowUp')r.y=clamp(r.y-step/media.height,0,1-r.h);if(e.code==='ArrowDown')r.y=clamp(r.y+step/media.height,0,1-r.h);
  commit(before);drawOverlay();
 }
});
window.addEventListener('keyup',e=>{if(e.code==='Space'){heldCompare=false;comparison();}});
window.addEventListener('blur',()=>{heldCompare=false;comparison();if(drag)finish(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)element?.pause?.();});
if(api)api.event.listen('export-progress',e=>{
 const {percent,message}=e.payload;status(message);$('progress').value=percent;$('busyProgress').value=percent;$('busyDetail').textContent=message+' · '+Math.round(percent)+'%';
});
new ResizeObserver(()=>fit()).observe($('stage'));
list();controls();loop();

function createRenderer(){

 const gl=canvas.getContext('webgl2',{alpha:false,preserveDrawingBuffer:true});

 if(!gl)throw new Error('需要支持 WebGL 2 的显卡驱动才能实时预览。');

 const vertex='#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p.x,-p.y,0,1);}';

 const fragment=`#version 300 es

 precision highp float;

 uniform sampler2D tex;uniform vec2 size;uniform vec4 boxes[16];uniform int count;in vec2 uv;out vec4 color;

 void main(){color=texture(tex,uv);vec2 q=uv*size;

 for(int i=0;i<16;i++){if(i>=count)break;vec4 b=boxes[i]*vec4(size,size);vec2 a=b.xy;vec2 z=a+b.zw-1.;

 if(q.x>a.x&&q.x<z.x&&q.y>a.y&&q.y<z.y){

 vec4 l=(texture(tex,vec2(a.x,q.y-1.)/size)+texture(tex,vec2(a.x,q.y)/size)+texture(tex,vec2(a.x,q.y+1.)/size))/3.;

 vec4 r=(texture(tex,vec2(z.x+1.,q.y-1.)/size)+texture(tex,vec2(z.x+1.,q.y)/size)+texture(tex,vec2(z.x+1.,q.y+1.)/size))/3.;

 vec4 t=(texture(tex,vec2(q.x-1.,a.y)/size)+texture(tex,vec2(q.x,a.y)/size)+texture(tex,vec2(q.x+1.,a.y)/size))/3.;

 vec4 d=(texture(tex,vec2(q.x-1.,z.y)/size)+texture(tex,vec2(q.x,z.y)/size)+texture(tex,vec2(q.x+1.,z.y)/size))/3.;

 vec2 dl=q-a,dr=z-q;vec4 wt=vec4(dr.x*dl.y*dr.y,dl.x*dl.y*dr.y,dl.x*dr.x*dr.y,dl.x*dr.x*dl.y);

 color=(l*wt.x+r*wt.y+t*wt.z+d*wt.w)/max(dot(wt,vec4(1)),.0001);

 }} }`;

 function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}

 const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));gl.useProgram(p);

 const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);

 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);

 return ()=>{if(!element||media.video&&element.readyState<2)return;gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(p);gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,element);const w=media.video?element.videoWidth:element.naturalWidth,h=media.video?element.videoHeight:element.naturalHeight;gl.uniform2f(gl.getUniformLocation(p,'size'),w,h);const boxes=new Float32Array(64);rects.forEach((r,i)=>boxes.set([r.x,r.y,r.w,r.h],i*4));gl.uniform4fv(gl.getUniformLocation(p,'boxes[0]'),boxes);gl.uniform1i(gl.getUniformLocation(p,'count'),compare?0:rects.length);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);};

}
