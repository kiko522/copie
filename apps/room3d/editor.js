import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {findResidentSpot} from './model.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createHome,validateHome,addRoom,findPlace,placementError,clone,PALETTE,STEP,furnitureType,TYPE_LABELS,snapToSupport,moveFurniture} from './model.js';

const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=new Set(['lavender','purple','pink','blush','peri','rug']);
export async function mountHomeEditor(host,{assetBase,initialState,onChange,onBack,storageKey,signal}={}){
 host.classList.add('home3d');host.innerHTML='<div class="h3-stage"></div><div class="h3-ui"></div><div class="h3-loading">正在把家具搬进来…</div>';
 let destroyed=false,state,catalog,kit,selected=null,panel=null,overview=false,edit=false,message='',error=false,undo=[],redo=[],saved=true;
 let objects=[],animated=[],elapsed=0,manual=false,frame=0,drag=null,pointerDown=null,lastTick=performance.now(),lastDraw=0,dirty=true;
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const touch=matchMedia('(pointer:coarse)').matches;
 const qualities={eco:{label:'省电',ratio:.75,fps:30,shadows:false,motion:false,details:1},balanced:{label:'均衡',ratio:1,fps:30,shadows:true,motion:true,details:2},clear:{label:'清晰',ratio:1.5,fps:touch?30:60,shadows:true,motion:true,details:touch?2:4}};
 let quality='eco';try{const saved=localStorage.getItem('sully-home3d-quality');if(qualities[saved])quality=saved}catch{}
 let detailBudget=qualities[quality].details,frameInterval=1000/qualities[quality].fps,orbitMode=false,inTick=false;
 function wake(){if(!destroyed&&!document.hidden&&!frame&&!inTick&&state)frame=requestAnimationFrame(tick)}
 const materialCache=new Map(),usedMaterials=new Set();
 let renderedFrames=0,category='all';
 const stage=host.querySelector('.h3-stage'),ui=host.querySelector('.h3-ui');
 const abort=new AbortController();
 const scene=new THREE.Scene();scene.background=new THREE.Color('#e8dde7');
 let renderer;
 try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){host.querySelector('.h3-loading').textContent='这台设备暂时无法打开 3D 小屋，可返回 2D 小屋。';throw e}
 renderer.setPixelRatio(Math.min(devicePixelRatio,qualities[quality].ratio));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.VSMShadowMap;renderer.shadowMap.autoUpdate=false;stage.append(renderer.domElement);
 const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,200);camera.position.set(9,10,12);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;controls.target.set(0,2,0);
 controls.addEventListener('change',()=>{dirty=true;wake()});
 controls.minPolarAngle=.5;controls.maxPolarAngle=1.2;controls.minZoom=.6;controls.maxZoom=2.8;
 const hemi=new THREE.HemisphereLight('#ece9ff','#c3a1a7',1.8);scene.add(hemi);
 const key=new THREE.DirectionalLight('#fff1df',2.2);key.position.set(-3,8,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.radius=14;key.shadow.blurSamples=12;key.shadow.normalBias=.035;
 Object.assign(key.shadow.camera,{left:-5,right:5,top:6,bottom:-5,near:.5,far:25});scene.add(key);
 const fill=new THREE.DirectionalLight('#dddfff',1);fill.position.set(5,5,-3);scene.add(fill);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.ShadowMaterial({color:'#8b779b',opacity:.12}));ground.rotation.x=-Math.PI/2;ground.position.y=-.47;ground.receiveShadow=true;scene.add(ground);
 const content=new THREE.Group();scene.add(content);
 const resident=new THREE.Group();scene.add(resident);
 let visitor=null,visitorMotion='idle',visitorStart=0,visitorUntil=0;
 const motions=[['idle','站好'],['wave-cute','可爱挥手'],['wave-calm','冷静挥手'],['sleep','睡觉'],['angry','生气'],['dance','晃一晃']];
 function placeVisitor(){
  resident.visible=!!visitor&&!overview;
  if(!visitor||!state)return;
  // Reserve the entire head footprint, and prefer open floor near the viewer.
  const spot=findResidentSpot(current(),catalog);
  if(spot)resident.position.fromArray(spot);
  resident.visible=!!spot&&!overview;
 }
 function setVisitor(next){
  visitor?.dispose();visitor=next;resident.clear();visitorMotion='idle';visitorStart=elapsed;visitorUntil=0;
  if(visitor){resident.add(visitor.root);visitor.animate(0,'idle');}
  if(state){placeVisitor();dirty=true;wake();renderUI();}
 }
 const selection=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:4},()=>new THREE.Vector3())),new THREE.LineBasicMaterial({color:0x9d80bd,transparent:true,opacity:.6,depthTest:false}));
 selection.setFromObject=o=>{const b=new THREE.Box3().setFromObject(o),p=selection.geometry.attributes.position,y=b.min.y+.025;[[b.min.x,b.min.z],[b.max.x,b.min.z],[b.max.x,b.max.z],[b.min.x,b.max.z]].forEach(([x,z],i)=>p.setXYZ(i,x,y,z));p.needsUpdate=true;selection.geometry.computeBoundingSphere()};selection.renderOrder=9;selection.visible=false;scene.add(selection);
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(),hit=new THREE.Vector3();
 const templates=new Map(),thumbs=new Map();
 // Selection-only inverted hulls reuse the asset geometry; no full-screen bloom pass.
 const outlineMaterials=[new THREE.ShaderMaterial({side:THREE.BackSide,transparent:true,depthWrite:false,uniforms:{width:{value:.06},tint:{value:new THREE.Color('#c4a7ff')},alpha:{value:.28}},vertexShader:'uniform float width; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*width,1.0);}',fragmentShader:'uniform vec3 tint; uniform float alpha; void main(){gl_FragColor=vec4(tint,alpha);}'}),new THREE.ShaderMaterial({side:THREE.BackSide,transparent:true,depthWrite:false,uniforms:{width:{value:.025},tint:{value:new THREE.Color('#fff2bd')},alpha:{value:.95}},vertexShader:'uniform float width; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*width,1.0);}',fragmentShader:'uniform vec3 tint; uniform float alpha; void main(){gl_FragColor=vec4(tint,alpha);} '})];
 let outlinedObject=null,outlineGroup=null;
 function clearOutline(){outlineGroup?.removeFromParent();outlineGroup=null;outlinedObject=null}
 function outlineObject(obj){
  if(outlinedObject===obj)return;clearOutline();if(!obj)return;
  outlineGroup=new THREE.Group();
  for(const material of outlineMaterials){const copy=obj.clone(true);copy.position.set(0,0,0);copy.rotation.set(0,0,0);copy.scale.set(1,1,1);copy.traverse(o=>{if(o.isMesh){o.material=material;o.castShadow=false;o.receiveShadow=false;o.raycast=()=>{};o.renderOrder=2}});outlineGroup.add(copy)}
  obj.add(outlineGroup);outlinedObject=obj;
 }
 const grid=new THREE.Mesh(new THREE.PlaneGeometry(6,5.1),new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{tint:{value:new THREE.Color('#b3a0ce')}},vertexShader:'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv; uniform vec3 tint; void main(){vec2 p=(vUv-.5)*vec2(6.,5.1)/.4; vec2 d=abs(fract(p-.5)-.5)/max(fwidth(p),vec2(.001));float line=1.-min(min(d.x,d.y),1.);vec2 q=p*2.;vec2 e=abs(fract(q-.5)-.5)/max(fwidth(q),vec2(.001));float minor=1.-min(min(e.x,e.y),1.);gl_FragColor=vec4(tint,max(line*.34,minor*.09));}' }));grid.rotation.x=-Math.PI/2;grid.position.y=.166;grid.visible=false;grid.renderOrder=3;scene.add(grid);
 const footprint=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:'#8ccea2',transparent:true,opacity:.23,depthWrite:false,depthTest:false}));footprint.rotation.x=-Math.PI/2;footprint.visible=false;footprint.renderOrder=4;scene.add(footprint);
 function placementGuide(obj,valid=true){
  const active=!!drag&&edit&&!overview,kind=item()?asset(item().assetId).surface:'';
  grid.visible=active&&['floor','rug'].includes(kind);footprint.visible=active&&['floor','rug','tabletop'].includes(kind);
  const tint=valid?'#80c99a':'#ef8c99';footprint.material.color.set(tint);selection.material.color.set(active?tint:'#b69be3');
  if(footprint.visible&&obj){const b=new THREE.Box3().setFromObject(obj);footprint.position.set((b.min.x+b.max.x)/2,kind==='tabletop'?obj.position.y+.012:.18,(b.min.z+b.max.z)/2);footprint.scale.set(b.max.x-b.min.x,b.max.z-b.min.z,1)}
 }
 const distantGeometry=new THREE.BoxGeometry(1,1,1);
 const distantMaterials=new Map();
 function distantShell(color){
  let material=distantMaterials.get(color);
  if(!material){material=new THREE.MeshStandardMaterial({color,roughness:.85});distantMaterials.set(color,material)}
  const root=new THREE.Group();
  for(const [x,y,z,w,h,d] of [[0,-.15,0,6.3,.35,5.4],[0,2.3,-2.6,6.3,4.6,.2],[-3.05,2.3,0,.2,4.6,5.4],[3.05,.5,-1.8,.2,1,1.6]]){
   const mesh=new THREE.Mesh(distantGeometry,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);root.add(mesh);
  }
  return root;
 }
 let size={w:1,h:1};
 const current=()=>state.rooms.find(r=>r.id===state.activeRoomId);
 const item=()=>current()?.items.find(i=>i.id===selected);
 const asset=id=>catalog.find(a=>a.id===id);
 function notify(text,bad=false){message=text;error=bad;renderUI()}
 function persist(){
  saved=true;
  try{if(storageKey)localStorage.setItem(storageKey,JSON.stringify(state));const result=onChange?.(clone(state));if(result?.catch)result.catch(()=>{saved=false;notify('保存失败，当前布置仍保留在画面中，可导出备份',true)});}catch{saved=false;message='保存失败，请导出备份';error=true}
 }
 function commit(mutator){
  const before=clone(state);message='';error=false;
  try{mutator();undo.push(before);if(undo.length>40)undo.shift();redo=[];persist();rebuild();renderUI();}catch(e){state=before;notify(e.message,true)}
 }
 function applyColor(root,color,wall=false,id=''){
  root.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];
   o.castShadow=mats.every(m=>!m.transparent);o.receiveShadow=true;
   o.material=mats.map(m=>{
    const primary=['table','chair','desk','bookcase','tank'].includes(id)?['woodLight','cream']:['plant','small_plant','trailing_plant'].includes(id)?['cream','lavender']:[];
    const paint=wall?((m.name==='cream'&&o.userData.wallPart!=='floor')?color.wall:colors.has(m.name)?color.trim:color.floor&&['wood','woodLight','cream'].includes(m.name)&&o.userData.wallPart==='floor'?color.floor:''):color&&(colors.has(m.name)||primary.includes(m.name))?color:'';
    const key=m.uuid+'/'+paint;usedMaterials.add(key);let c=materialCache.get(key);
    if(!c){c=m.clone();if(paint)c.color.set(paint);if(c.transparent)c.depthWrite=false;materialCache.set(key,c)}
    return c});if(o.material.length===1)o.material=o.material[0];
  });
 }
 function instance(id,color,wall){const template=templates.get(id);if(!template)throw Error('缺少家具模型：'+id);const obj=template.clone(true);applyColor(obj,color,wall,id);return obj}
 function clearContent(){clearOutline();content.traverse(o=>{if(o.isMesh){if(o.geometry.userData.owned)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.userData.owned)m.dispose()}});content.clear();objects=[];animated=[]}
 let lastViewKey='';
 function rebuild(){
  clearContent();usedMaterials.clear();dirty=true;key.castShadow=!overview&&qualities[quality].shadows;renderer.shadowMap.enabled=key.castShadow;renderer.shadowMap.needsUpdate=true;const active=current();
  const detailed=new Set([...state.rooms].sort((a,b)=>(Math.abs(a.x-active.x)+Math.abs(a.z-active.z)+Math.abs(a.level-active.level))-(Math.abs(b.x-active.x)+Math.abs(b.z-active.z)+Math.abs(b.level-active.level))).slice(0,detailBudget).map(r=>r.id));
  for(const r of state.rooms){
   if(!overview&&r.id!==active.id)continue;
   const room=new THREE.Group();room.userData.roomId=r.id;
   if(overview)room.position.set((r.x-active.x)*6.48,(r.level)*5.08,(r.z-active.z)*5.6);
   const shell=overview&&!detailed.has(r.id)?distantShell(r.trim||r.wall):instance('shell',{wall:r.wall,trim:r.trim||'',floor:r.floor||''},true);shell.userData.roomId=r.id;room.add(shell);
   // Keep the room cutaway readable. The overview shows the actual stacked shells;
   // focusing a room removes upper-floor occlusion without deleting any furniture.
   for(const i of r.items){if(i.stored||overview&&!detailed.has(r.id))continue;const obj=instance(i.assetId,i.color,false);obj.position.set(i.x,i.y,i.z);obj.rotation.y=i.rotation*Math.PI/180;obj.userData.itemId=i.id;obj.userData.roomId=r.id;room.add(obj);objects.push(obj);
    obj.traverse(o=>{if(o.userData.animated) animated.push({o,y:o.position.y,phase:o.userData.phase||0,speed:o.userData.floatSpeed||.6,amplitude:o.userData.floatAmplitude||.02});});
   }
   content.add(room);
  }
  if(overview){
   // Small cream connectors distinguish adjacency from disconnected thumbnails.
   for(const r of state.rooms)for(const d of [[1,0],[0,1]]){
    if(!state.rooms.some(n=>n.level===r.level&&n.x===r.x+d[0]&&n.z===r.z+d[1]))continue;
    const b=new THREE.Mesh(new THREE.BoxGeometry(d[0]?.34:.7,.1,d[1]?.34:.7),new THREE.MeshStandardMaterial({color:'#fff0da',roughness:.8}));
    b.material.userData.owned=true;b.geometry.userData.owned=true;b.userData.connector=true;b.position.set((r.x-active.x)*6.48+d[0]*3.24,r.level*5.08+.05,(r.z-active.z)*5.6+d[1]*2.8);content.add(b);
   }
  }
  for(const [key,m] of materialCache)if(!usedMaterials.has(key)){m.dispose();materialCache.delete(key)}
  placeVisitor();
  const viewKey=overview+'-'+state.activeRoomId+'-'+state.rooms.length;resize(viewKey!==lastViewKey);lastViewKey=viewKey;updateSelection();
 }
 function updateSelection(){dirty=true;wake();const obj=objects.find(o=>o.userData.itemId===selected);selection.visible=!!obj&&edit&&!overview;outlineObject(selection.visible?obj:null);if(obj)selection.setFromObject(obj);placementGuide(obj)}
 function resize(fit=false){
  dirty=true;wake();size={w:stage.clientWidth||1,h:stage.clientHeight||1};const ratio=size.w/size.h;
  const box=new THREE.Box3().setFromObject(content),extent=box.isEmpty()?new THREE.Vector3(6.4,4.9,5.5):box.getSize(new THREE.Vector3());
  let span=overview?Math.max(extent.x*.9+extent.z*.7,extent.y*1.25+extent.z*.5)+2:10.1;
  const height=Math.max(span,span/ratio);camera.left=-height*ratio/2;camera.right=height*ratio/2;camera.top=height/2;camera.bottom=-height/2;
  camera.setViewOffset(size.w,size.h,0,Math.round(size.h*.045),size.w,size.h);
  if(fit){const center=overview?box.getCenter(new THREE.Vector3()):new THREE.Vector3(0,2,0);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(9,8,12).multiplyScalar(overview?Math.max(1,extent.length()/12):1));camera.far=Math.max(200,extent.length()*4+50);camera.zoom=1;}
  camera.updateProjectionMatrix();renderer.setSize(size.w,size.h);controls.update();
 }
 function selectedPanel(){
  const i=item();if(!i||i.stored)return '';const a=asset(i.assetId);
  return `<div class="h3-object-title"><strong>${esc(a.name)}</strong><button data-action="deselect" aria-label="取消选中">×</button></div><div class="h3-object-actions"><button data-action="rotate" ${['left','back'].includes(a.surface)?'disabled':''}>↻ 旋转</button><button data-action="palette">◉ 换色</button><button data-action="copy">＋ 复制</button><button data-action="store">▱ 收纳</button>${['left','back','ceiling'].includes(a.surface)?'<button data-action="height" data-dy=".2">↑</button><button data-action="height" data-dy="-.2">↓</button>':''}</div>${panel==='palette'?`<div class="h3-swatches">${PALETTE.map(c=>`<button aria-label="换色 ${c}" style="background:${c}" data-action="color" data-value="${c}"></button>`).join('')}<button data-action="color" data-value="">原色</button></div>`:''}`;
 }
 function renderUI(){if(!state)return;
  const r=current(),levels=[...new Set(state.rooms.map(r=>r.level))].sort((a,b)=>b-a);
  let sheet='';
  if(panel==='furniture'||panel==='storage'){
   const list=panel==='storage'?state.rooms.flatMap(room=>room.items.filter(i=>i.stored&&!i.supportId)).map(i=>({...asset(i.assetId),storedId:i.id})):catalog.filter(a=>a.id!=='shell'&&(category==='all'||furnitureType(a)===category));
   sheet=`<header><h2>${panel==='storage'?'收纳箱':'家具架'}</h2><button data-action="close">×</button></header><div class="h3-categories">${panel==='furniture'?Object.entries(TYPE_LABELS).map(([key,label])=>`<button data-action="category" data-value="${key}" aria-pressed="${category===key}">${label}</button>`).join(''):''}</div><div class="h3-assets">${list.map(a=>`<button class="h3-asset" data-action="${a.storedId?'restore':'add-item'}" data-id="${a.storedId||a.id}">${thumbs.has(a.id)?`<img alt="" src="${thumbs.get(a.id)}">`:'<span>◇</span>'}${esc(a.name)}</button>`).join('')}</div>${!list.length?'<p>这里暂时没有家具。</p>':''}`;
  }else if(panel==='selected'||panel==='palette')sheet='';
  else if(panel==='rooms')sheet=`<header><h2>房间与楼层</h2><button data-action="close">×</button></header><div class="h3-roomlist">${state.rooms.map(n=>`<button data-action="room" data-id="${n.id}"><span>${esc(n.name)}</span><small>${n.level+1}F · ${n.x}, ${n.z}</small></button>`).join('')}</div>`;
  else if(panel==='expand')sheet=`<header><h2>从${esc(r.name)}扩建</h2><button data-action="close">×</button></header><div class="h3-expand">${[['back','后方'],['up','楼上'],['front','前方'],['left','左边'],['down','楼下'],['right','右边']].map(([dir,label])=>`<button data-action="expand" data-direction="${dir}" ${dir==='down'&&r.level===0?'disabled':''}>＋ ${label}</button>`).join('')}</div><p>已有房间的位置会直接进入。新房间先留空，慢慢布置。</p>`;
  else if(panel==='room-style')sheet=`<header><h2>这间房的样子</h2><button data-action="close">×</button></header><input class="h3-rename" aria-label="房间名字" maxlength="40" value="${esc(r.name)}"><div class="h3-actions"><button data-action="rename">保存名字</button><button data-action="export">导出布置</button><button data-action="import">导入布置</button></div><p>墙面颜色</p><div class="h3-swatches">${['#FFF2E3',...PALETTE.slice(0,5)].map(c=>`<button aria-label="墙色 ${c}" style="background:${c}" data-action="wall" data-value="${c}"></button>`).join('')}</div>`;
  if(panel==='room-style')sheet+=`<p>整屋配色（墙面、边框和地板）</p><div class="h3-actions">${['奶油紫','草莓奶','鼠尾草','云朵蓝'].map((label,i)=>`<button data-action="house-theme" data-value="${i}">${label}</button>`).join('')}</div>${[['trim','边框与底座'],['floor','地板']].map(([part,label])=>`<p>${label}</p><div class="h3-swatches">${PALETTE.map(c=>`<button aria-label="${label} ${c}" style="background:${c}" data-action="house-color" data-part="${part}" data-value="${c}"></button>`).join('')}</div>`).join('')}`;
  if(panel==='quality')sheet=`<header><h2>画质与耗电</h2><button data-action="close">×</button></header><p>只影响这台设备，自动记住选择。</p><div class="h3-actions">${Object.entries(qualities).map(([id,q])=>`<button data-action="quality" data-value="${id}" aria-pressed="${quality===id}">${q.label} · ${q.ratio}×</button>`).join('')}</div><p>${quality==='eco'?'低分辨率，关闭阴影与水母动画；静止时停止绘制。':quality==='balanced'?'标准分辨率，柔和阴影与轻微水母动画，最高 30 帧。':'高分辨率，保留阴影和动画，耗电相对较高。'}</p><p>当前绘制尺寸 ${Math.floor(size.w*renderer.getPixelRatio())} × ${Math.floor(size.h*renderer.getPixelRatio())}。所有档位在页面隐藏时停止绘制。</p>`;
  if(panel==='chibi')sheet=`<header><h2>陪小人待一会儿</h2><button data-action="close">×</button></header><div class="h3-actions">${motions.map(([id,label])=>`<button data-action="chibi-motion" data-value="${id}" aria-pressed="${visitorMotion===id}">${label}</button>`).join('')}</div><p>${resident.visible?'小手只轻轻挥，不会拉长。省电时动作播放一小会儿便停下。':'房间没有足够空地，请先收起一件落地家具。'}</p>`;
  ui.innerHTML=`<div class="h3-top">${onBack?'<button class="h3-pill" data-action="back">2D 小屋</button>':''}<div class="h3-title"><strong>${esc(overview?'我的小小世界':r.name)}</strong><small>${r.level+1}F · ${state.rooms.length} 间房 · ${saved?'布置已保存':'尚未保存'}</small></div><button class="h3-pill" data-active="${overview}" data-action="overview">${overview?'回房间':'总览'}</button><button class="h3-pill" data-active="${edit}" data-action="edit">${edit?'完成':'布置'}</button></div><div class="h3-floor">${levels.map(l=>`<button data-active="${l===r.level}" data-action="floor" data-level="${l}">${l+1}F</button>`).join('')}</div><div class="h3-camera-tools"><button data-action="zoom" data-factor="1.2" aria-label="放大">＋</button><button data-action="zoom" data-factor=".833333" aria-label="缩小">−</button><button data-action="turn-view" data-angle="-.785398" aria-label="视角向左">↶</button><button data-action="turn-view" data-angle=".785398" aria-label="视角向右">↷</button></div>${edit?`<div class="h3-history"><button data-action="undo" aria-label="撤销" ${undo.length?'':'disabled'}>↶ 撤销</button><button data-action="redo" aria-label="重做" ${redo.length?'':'disabled'}>↷ 重做</button></div>`:''}${edit&&selected&&!sheet?`<section class="h3-object-bar">${selectedPanel()}</section>`:''}${sheet?`<section class="h3-sheet">${sheet}</section>`:''}<div class="h3-status" ${sheet||selected&&!error?'style="display:none"':''}><span class="${error?'error':''}">${esc(message||(overview?'点一间房，进去看看':edit?'点选后拖动家具 · 空白处转视角 · 双指缩放':'拖动看看小屋，点「布置」开始装扮'))}</span></div><nav class="h3-dock">${[...(visitor?[['chibi','♡','小人']]:[]),['furniture','♧','家具'],['storage','▱','收纳'],['expand','＋','扩建'],['rooms','⌂','房间'],['room-style','◌','装扮'],['quality','◇','画质']].map(([id,icon,label])=>`<button data-action="panel" data-panel="${id}" data-active="${panel===id}"><b>${icon}</b>${label}</button>`).join('')}</nav>`;
 }
 function changeItem(patch){const i=item();if(!i)return;commit(()=>{moveFurniture(current(),i.id,patch,catalog);message='已放好';error=false})}
 function select(id){selected=id;panel='selected';edit=true;overview=false;controls.enabled=true;updateSelection();renderUI()}
 function action(e){const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const d=b.dataset;
  if(d.action==='panel'&&d.panel==='chibi'){panel=panel==='chibi'?null:'chibi';edit=false;overview=false;selected=null;rebuild();renderUI();return}
  if(d.action==='chibi-motion'&&visitor){visitorMotion=d.value;visitorStart=elapsed;visitorUntil=elapsed+4.4;visitor.animate(reducedMotion?1:0,visitorMotion);dirty=true;wake();renderUI();return}
  if(d.action==='orbit'){orbitMode=!orbitMode;controls.enabled=true;renderUI();return}
  if(d.action==='turn-view'){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),Number(d.angle));camera.position.copy(controls.target).add(offset);controls.update();dirty=true;wake();return}
  if(d.action==='quality'){quality=d.value;if(!qualities[quality])quality='eco';const q=qualities[quality];detailBudget=q.details;frameInterval=1000/q.fps;renderer.setPixelRatio(Math.min(devicePixelRatio,q.ratio));try{localStorage.setItem('sully-home3d-quality',quality)}catch{}rebuild();renderUI();return}
  if(d.action==='house-color'){commit(()=>{current()[d.part]=d.value});return}
  if(d.action==='house-theme'){commit(()=>{const themes=[['#FFF2E3','#A99BE8','#D7B28A'],['#FFF8F2','#F2B8D5','#E6C9B1'],['#F3F6EE','#A5B99A','#D7B28A'],['#FFF8F2','#91C9F4','#DAD3DE']];const t=themes[Number(d.value)];[current().wall,current().trim,current().floor]=t});return}
  if(d.action==='category'){category=d.value;renderUI();return}
  if(d.action==='back'){onBack?.();return}
  if(d.action==='close'){panel=null;renderUI();return}
  if(d.action==='edit'){edit=!edit;selected=null;panel=null;controls.enabled=true;updateSelection();renderUI();return}
  if(d.action==='overview'){overview=!overview;edit=false;panel=null;selected=null;controls.enabled=true;rebuild();renderUI();return}
  if(d.action==='panel'){panel=panel===d.panel?null:d.panel;if(['furniture','storage'].includes(panel)){edit=true;overview=false;controls.enabled=true;rebuild()}renderUI();return}
  if(d.action==='deselect'){selected=null;panel=null;updateSelection();renderUI();return}
  if(d.action==='palette'){panel=panel==='palette'?'selected':'palette';renderUI();return}
  if(d.action==='zoom'){camera.zoom=Math.max(.6,Math.min(2.8,camera.zoom*Number(d.factor)));camera.updateProjectionMatrix();dirty=true;wake();return}
  if(d.action==='redo'){if(redo.length){undo.push(clone(state));state=redo.pop();selected=null;panel=null;persist();rebuild();renderUI()}return}
  if(d.action==='undo'){if(undo.length){redo.push(clone(state));state=undo.pop();selected=null;panel=null;persist();rebuild();renderUI()}return}
  if(d.action==='room'||d.action==='floor'){const r=d.action==='room'?state.rooms.find(r=>r.id===d.id):state.rooms.find(r=>r.level===Number(d.level));if(r){state.activeRoomId=r.id;overview=false;selected=null;panel=null;persist();rebuild();renderUI()}return}
  if(d.action==='expand'){commit(()=>{addRoom(state,d.direction);panel=null;selected=null;edit=true;overview=false;controls.enabled=true;message='新空间，留给新的生活';error=false});return}
  if(d.action==='add-item'||d.action==='restore'){commit(()=>{
   if(d.action==='add-item'){
    if(current().items.length>=100)throw Error('每间房最多保存 100 件家具');
    const added=findPlace(asset(d.id),current(),catalog);current().items.push(added);selected=added.id;
   }else{
    const owner=state.rooms.find(r=>r.items.some(i=>i.id===d.id&&i.stored));if(!owner)throw Error('收纳箱里没有这件家具');
    if(owner!==current()&&current().items.length>=100)throw Error('每间房最多保存 100 件家具');
    const stored=owner.items.find(i=>i.id===d.id),next=findPlace(asset(stored.assetId),current(),catalog,stored.id);
    const group=owner.items.filter(i=>i.id===stored.id||i.supportId===stored.id);
    if(owner!==current()&&current().items.length+group.length>100)throw Error('每间房最多保存 100 件家具');
    owner.items=owner.items.filter(i=>!group.includes(i));
    for(const i of group)i.stored=false;
    current().items.push(...group);moveFurniture(current(),stored.id,{...next,color:stored.color},catalog);selected=next.id;
   }
   panel='selected';message='拖动试试新的位置';error=false;
  });return}
  if(d.action==='copy'){const original=item();if(original)commit(()=>{if(current().items.length>=100)throw Error('每间房最多保存 100 件家具');const added=findPlace(asset(original.assetId),current(),catalog);added.color=original.color;current().items.push(added);selected=added.id});return}
  if(d.action==='nudge'){const i=item();if(i){const a=asset(i.assetId);changeItem({x:i.x+(a.surface==='left'?0:Number(d.dx)),z:i.z+(a.surface==='back'?0:Number(d.dz))})}return}
  if(d.action==='rotate'){if(item())changeItem({rotation:(item().rotation+90)%360});return}
  if(d.action==='height'){if(item())changeItem({y:Math.max(.15,Math.min(4.5,item().y+Number(d.dy)))});return}
  if(d.action==='color'){commit(()=>{if(item())item().color=d.value||null});return}
  if(d.action==='store'){commit(()=>{const i=item();if(i){for(const member of current().items)if(member.id===i.id||member.supportId===i.id)member.stored=true;if(i.supportId)i.supportId=null}selected=null;panel=null;message='已放进收纳箱，台面上的物件会一起收好';error=false});return}
  if(d.action==='wall'){commit(()=>{current().wall=d.value});return}
  if(d.action==='rename'){const name=ui.querySelector('.h3-rename').value.trim();if(name)commit(()=>{current().name=name});return}
  if(d.action==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='我的小屋.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
  if(d.action==='import'){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const f=input.files?.[0];if(!f)return;if(f.size>1024*1024)throw Error('布置文件过大');const incoming=validateHome(JSON.parse(await f.text()),catalog);commit(()=>{state=incoming;selected=null;panel=null;message='布置已导入，可撤销回到刚才的房间'})}catch(e){notify(e.message,true)}};input.click();}
 }
 ui.addEventListener('click',action,{signal:abort.signal});
 function coordinates(e){const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera)}
 function pointerSupport(next){
  if(asset(next.assetId).surface!=='tabletop')return next;
  for(const parent of current().items){const surface=asset(parent.assetId).support;if(parent.stored||!surface)continue;
   const height=parent.y+surface.height,point=new THREE.Vector3();
   if(!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),point))continue;
   const candidate=snapToSupport({...next,x:Math.round((point.x+drag.offset.x)/.05)*.05,z:Math.round((point.z+drag.offset.z)/.05)*.05},current(),catalog);
   if(candidate.supportId===parent.id)return candidate;
  }
  return snapToSupport(next,current(),catalog);
 }
 function pick(e){coordinates(e);const hits=raycaster.intersectObjects(content.children,true);for(const hit of hits){let o=hit.object;while(o&&!o.userData.itemId&&!o.userData.roomId)o=o.parent;if(o)return o}return null}
 const activePointers=new Set();let multiGesture=false;
 controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
 function down(e){
  activePointers.add(e.pointerId);
  if(activePointers.size>1){multiGesture=true;if(drag){drag=null;rebuild()}pointerDown=null;controls.enableRotate=true;return}
  if(e.button!==0)return;const picked=pick(e);pointerDown={x:e.clientX,y:e.clientY,picked};
  if(overview||!edit||!picked?.userData.itemId||picked.userData.itemId!==selected)return;
  controls.enableRotate=false;const i=item(),a=asset(i.assetId);drag={id:e.pointerId,start:clone(i),candidate:clone(i),valid:true};
  const normal=a.surface==='back'?new THREE.Vector3(0,0,1):a.surface==='left'?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
  plane.setFromNormalAndCoplanarPoint(normal,new THREE.Vector3(i.x,i.y,i.z));raycaster.ray.intersectPlane(plane,hit);drag.offset=new THREE.Vector3(i.x,i.y,i.z).sub(hit);
 }
 function move(e){if(!drag||drag.id!==e.pointerId||multiGesture)return;if(pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<5)return;coordinates(e);if(!raycaster.ray.intersectPlane(plane,hit))return;const p=hit.clone().add(drag.offset),a=asset(drag.start.assetId);let next={...drag.start};if(a.surface==='back'){next.x=Math.round(p.x/STEP)*STEP;next.y=Math.round(p.y/STEP)*STEP}else if(a.surface==='left'){next.z=Math.round(p.z/STEP)*STEP;next.y=Math.round(p.y/STEP)*STEP}else{next.x=Math.round(p.x/STEP)*STEP;next.z=Math.round(p.z/STEP)*STEP}next=pointerSupport(next);drag.candidate=next;let why='';const preview=clone(current());try{moveFurniture(preview,next.id,next,catalog)}catch(e){why=e.message}drag.valid=!why;message=why||'松手放下';error=!!why;const obj=objects.find(o=>o.userData.itemId===next.id);obj.position.set(next.x,next.y,next.z);for(const child of preview.items.filter(i=>i.supportId===next.id)){const mesh=objects.find(o=>o.userData.itemId===child.id);if(mesh){mesh.position.set(child.x,child.y,child.z);mesh.rotation.y=child.rotation*Math.PI/180}}selection.setFromObject(obj);placementGuide(obj,!why);dirty=true;wake();}
 function up(e){
  activePointers.delete(e.pointerId);controls.enableRotate=true;
  if(multiGesture){if(!activePointers.size)multiGesture=false;pointerDown=null;return}
  if(drag&&drag.id===e.pointerId){const final=drag;drag=null;placementGuide(null);dirty=true;wake();selection.material.color.set('#9d80bd');
   if(e.type==='pointercancel'||!final.valid){rebuild();notify(e.type==='pointercancel'?'已取消移动':message,true)}
   else if(JSON.stringify(final.start)!==JSON.stringify(final.candidate))changeItem(final.candidate);
   pointerDown=null;return;
  }
  if(e.type!=='pointercancel'&&pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<8){const p=pointerDown.picked;
   if(overview&&p?.userData.roomId){state.activeRoomId=p.userData.roomId;overview=false;persist();rebuild();renderUI()}
   else if(edit&&p?.userData.itemId)select(p.userData.itemId);
   else if(edit){selected=null;panel=null;updateSelection();renderUI()}
  }pointerDown=null;
 }
 for(const [name,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up]])renderer.domElement.addEventListener(name,fn,{signal:abort.signal,capture:true});
 function keydown(e){if(e.target instanceof HTMLInputElement)return;if(e.key==='Escape'){panel=null;selected=null;updateSelection();renderUI()}if(e.key==='f'){if(document.fullscreenElement)document.exitFullscreen();else host.requestFullscreen?.()}if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();ui.querySelector('[data-action="'+(e.shiftKey||e.key.toLowerCase()==='y'?'redo':'undo')+'"]')?.click()}if(edit&&item()){const deltas={ArrowLeft:[-.2,0],ArrowRight:[.2,0],ArrowUp:[0,-.2],ArrowDown:[0,.2]};if(deltas[e.key]){e.preventDefault();const [x,z]=deltas[e.key],a=asset(item().assetId);changeItem({x:item().x+(a.surface==='left'?0:x),z:item().z+(a.surface==='back'?0:z)})}}}
 host.tabIndex=0;host.addEventListener('keydown',keydown,{signal:abort.signal});
 const observer=new ResizeObserver(()=>resize());observer.observe(stage);
 function tick(now=performance.now()){
  frame=0;if(destroyed||document.hidden)return;inTick=true;const dt=Math.min(.05,(now-lastTick)/1000);lastTick=now;
  let settling=false;if(!manual&&!document.hidden)elapsed+=dt;
  if(!document.hidden&&now-lastDraw>=frameInterval-.5){
   const breathing=animated.length&&!overview&&!reducedMotion&&qualities[quality].motion;
   if(breathing)for(const a of animated)a.o.position.y=a.y+Math.sin(elapsed*a.speed+a.phase)*a.amplitude;
   const acting=visitor&&resident.visible&&!edit&&!reducedMotion&&(qualities[quality].motion||elapsed<visitorUntil);
   if(acting)visitor.animate(elapsed-visitorStart,visitorMotion);
   settling=controls.update();if(dirty||breathing||acting||drag){renderer.render(scene,camera);renderedFrames++;dirty=false;lastDraw=now}
  }
  inTick=false;if(settling||dirty||drag||animated.length&&!overview&&!reducedMotion&&qualities[quality].motion||visitor&&resident.visible&&!edit&&!reducedMotion&&(qualities[quality].motion||elapsed<visitorUntil))wake();
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0}else{dirty=true;lastTick=performance.now();wake()}},{signal:abort.signal});
 function dispose(){if(destroyed&&!kit)return;visitor?.dispose();visitor=null;resident.clear();destroyed=true;abort.abort();observer.disconnect();cancelAnimationFrame(frame);controls.dispose();clearContent();for(const m of materialCache.values())m.dispose();materialCache.clear();kit?.scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose()}}});distantGeometry.dispose();for(const m of distantMaterials.values())m.dispose();distantMaterials.clear();key.shadow.dispose();grid.geometry.dispose();grid.material.dispose();footprint.geometry.dispose();footprint.material.dispose();for(const material of outlineMaterials)material.dispose();ground.geometry.dispose();ground.material.dispose();selection.geometry.dispose();selection.material.dispose();renderer.dispose();host.innerHTML='';host.classList.remove('home3d');}
 signal?.addEventListener('abort',dispose,{once:true});
 try{
  [catalog,kit]=await Promise.all([fetch(new URL('catalog.json',assetBase),{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('家具目录加载失败');return r.json()}),fetch(new URL('kit.glb',assetBase),{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('家具模型加载失败');return r.arrayBuffer()}).then(data=>new GLTFLoader().parseAsync(data,assetBase))]);
  if(destroyed){dispose();return {dispose}}
  for(const root of kit.scene.children)if(root.userData.assetId)templates.set(root.userData.assetId,root);
  let incoming=initialState;
  if(!incoming&&storageKey){const text=localStorage.getItem(storageKey);if(text)incoming=JSON.parse(text)}
  state=incoming?validateHome(incoming,catalog):createHome(catalog);if(!incoming||incoming.assetVersion!==2)persist();
  host.querySelector('.h3-loading').remove();rebuild();renderUI();tick();
  // Photographs of the actual asset geometries, generated once and reused in the shelf.
  const ts=new THREE.Scene();ts.background=new THREE.Color('#f1e8ee');ts.add(new THREE.HemisphereLight('#fff7f0','#aca1b9',2.5));const tl=new THREE.DirectionalLight('#fff5e7',3);tl.position.set(3,6,4);ts.add(tl);
  const tc=new THREE.OrthographicCamera(-2,2,2,-2,.1,100);const target=new THREE.WebGLRenderTarget(128,100);const pixels=new Uint8Array(128*100*4);const canvas=document.createElement('canvas');canvas.width=128;canvas.height=100;const ctx=canvas.getContext('2d');
  for(const a of catalog.filter(a=>a.id!=='shell')){const obj=templates.get(a.id)?.clone(true);if(!obj)continue;ts.add(obj);const b=new THREE.Box3().setFromObject(obj),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3());const h=Math.max(s.x,s.y,s.z)*1.3+.1;tc.left=-h*.64;tc.right=h*.64;tc.top=h/2;tc.bottom=-h/2;tc.position.copy(c).add(new THREE.Vector3(6,5,8));tc.lookAt(c);tc.updateProjectionMatrix();renderer.setRenderTarget(target);renderer.render(ts,tc);renderer.readRenderTargetPixels(target,0,0,128,100,pixels);const image=ctx.createImageData(128,100);for(let y=0;y<100;y++)image.data.set(pixels.subarray((99-y)*512,(100-y)*512),y*512);ctx.putImageData(image,0,0);thumbs.set(a.id,canvas.toDataURL());ts.remove(obj)}
  renderer.setRenderTarget(null);target.dispose();dirty=true;wake();renderUI();
 }catch(e){if(destroyed)return {dispose};dispose();host.innerHTML=`<div class="h3-loading"><span>${esc(e.message)}</span><button>重新加载</button></div>`;host.querySelector('button').onclick=()=>location.reload();throw e}
 return {dispose,setVisitor,getState:()=>clone(state),inspect:()=>({ready:true,chibiVisible:resident.visible,chibiMotion:visitorMotion,chibiPosition:resident.position.toArray(),outlineVisible:!!outlineGroup,gridVisible:grid.visible,footprintVisible:footprint.visible,placementValid:drag?.valid??null,quality,pixelRatio:renderer.getPixelRatio(),cameraPosition:camera.position.toArray(),zoom:camera.zoom,undoCount:undo.length,redoCount:redo.length,orbitMode,overview,edit,selected,rooms:state.rooms,activeRoomId:state.activeRoomId,panel,message,saved,assets:catalog.map(a=>a.id),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,materials:materialCache.size,renderedFrames,frameCap:1000/frameInterval,detailRooms:overview?Math.min(detailBudget,state.rooms.length):1}),advanceTime:ms=>{manual=true;elapsed+=ms/1000;for(const a of animated)a.o.position.y=a.y+Math.sin(elapsed*a.speed+a.phase)*a.amplitude;renderer.render(scene,camera)},select,projectItem:id=>{const o=objects.find(o=>o.userData.itemId===id);if(!o)return null;const p=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camera);return {x:(p.x+1)*size.w/2,y:(1-p.y)*size.h/2}}};
}
