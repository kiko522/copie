import * as T from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { Parts, Motion } from './types';
import {defaultHairLayer,type HairSettings} from './types';
import { clothingCanvas } from './partSurfaces';
import referenceUrl from './reference.fbx?url';

export async function loadBody() { return new FBXLoader().loadAsync(referenceUrl); }

export function buildBody(source: T.Group, parts: Parts, appearance: 'skin' | 'hair' | 'outfit', hair?:HairSettings) {
    const headDepth=.82;
    const resources: Array<{ dispose(): void }> = [];
    const keep = <V extends { dispose(): void }>(v: V): V => { resources.push(v); return v; };
    const average = (img: HTMLImageElement) => {
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, 32, 32);
        const d = ctx.getImageData(0, 0, 32, 32).data; let r=0,g=0,b=0,n=0;
        for(let i=0;i<d.length;i+=4) if(d[i+3]>180){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
        return n ? `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})` : '#b6a9aa';
    };
    const skin=average(parts.skin);
    const frontScalp=keep(new T.MeshStandardMaterial({color:average(parts.fronthair),roughness:1}));
    const rearScalp=keep(new T.MeshStandardMaterial({color:average(parts.back1||parts.back2||parts.fronthair),roughness:1}));
    // Match the actual face/body material boundary (model y=.60) in the original
    // 472px canvas. Split spatially, so several rolled decorations can land on
    // different surfaces without classifying the whole decor layer as one item.
    const decorBoundary=424-.60/2*336;
    const decorLayer=(face:boolean)=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=472;
        const ctx=canvas.getContext('2d')!;
        ctx.beginPath();ctx.rect(0,face?0:decorBoundary,472,face?decorBoundary:472-decorBoundary);ctx.clip();
        if(parts.decor)ctx.drawImage(parts.decor,0,0,472,472);
        return canvas;
    };
    const faceDecor=decorLayer(true),bodyDecor=decorLayer(false);
    const makeTexture=(keys:string[],fill?:string,eyes:'original'|'sleep'|'squeeze'='original')=>{
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=472;
        const ctx=canvas.getContext('2d')!;
        if(fill){ctx.fillStyle=fill;ctx.fillRect(0,0,472,472);}
        keys.forEach(k=>{
            const drawable=k==='faceDecor'?faceDecor:parts[k];
            if(!drawable)return;
            ctx.save();
            // Lift the facial cluster by 8 creator pixels and gently compact it.
            // Garments/hair retain their original registration against the body.
            if(k==='eyes'||k==='mouth'||k==='facemark')ctx.setTransform(.97,0,0,.96,237*.03,268*.04-8);
            if(k==='eyes'&&eyes==='squeeze'){
                ctx.strokeStyle='#514747';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';
                // Draw > on the left and < on the right in the original eye area.
                for(const [x,direction] of [[177,1],[297,-1]]){
                    ctx.beginPath();ctx.moveTo(x-direction*18,252);ctx.lineTo(x+direction*18,270);ctx.lineTo(x-direction*18,288);ctx.stroke();
                }
            }else if(k==='eyes'&&eyes==='sleep'){
                ctx.strokeStyle='#514747';ctx.lineWidth=6;ctx.lineCap='round';
                for(const x of [177,297]){ctx.beginPath();ctx.moveTo(x-25,270);ctx.quadraticCurveTo(x,288,x+25,270);ctx.stroke();}
            }else ctx.drawImage(drawable,0,0,472,472);
            ctx.restore();
        });
        const texture=keep(new T.CanvasTexture(canvas));texture.colorSpace=T.SRGBColorSpace;return texture;
    };
    const garmentMap=(rear:boolean)=>{
        const canvas=clothingCanvas(parts.outfit,skin,rear);
        // Body decorations overlay the front garment; do not smear their colors
        // across the back when extending the garment's original edge colors.
        if(!rear)canvas.getContext('2d')!.drawImage(bodyDecor,0,0);
        const map=keep(new T.CanvasTexture(canvas));map.colorSpace=T.SRGBColorSpace;return map;
    };
    const frontCloth=keep(new T.MeshStandardMaterial({map:appearance==='outfit'?garmentMap(false):makeTexture([],skin),roughness:1}));
    const faceKeys=appearance==='outfit'?['facemark','eyes','mouth','outfit','faceDecor']:['facemark','eyes','mouth','faceDecor'];
    const front=keep(new T.MeshStandardMaterial({map:makeTexture(faceKeys,skin),roughness:1}));
    const awakeMap=front.map;
    const asleepMap=makeTexture(faceKeys,skin,'sleep');
    const cuteMap=makeTexture(faceKeys,skin,'squeeze');
    const back=keep(new T.MeshStandardMaterial({color:skin,roughness:1}));
    const backCloth=keep(new T.MeshStandardMaterial({map:appearance==='outfit'?garmentMap(true):makeTexture([],skin),roughness:1}));
    const root=new T.Group(), body=new T.Group();root.add(body);
    const hairPivot=new T.Group();hairPivot.position.y=.64;body.add(hairPivot);
    source.updateMatrixWorld(true);
    const bounds=new T.Box3().setFromObject(source), center=bounds.getCenter(new T.Vector3());
    const scale=2/bounds.getSize(new T.Vector3()).y;
    const surfaces:T.Mesh[]=[];
    const hands:Array<{mesh:T.Mesh; side:number}>=[];
    const deformers:Array<{geometry:T.BufferGeometry; rest:Float32Array; smoothNormals:()=>void}>=[];
    source.traverse(o=>{
        if(!(o instanceof T.Mesh))return;
        let geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);
        geo.translate(-center.x,-bounds.min.y,-center.z);geo.scale(scale,scale,scale);
        if(geo.index){const expanded=geo.toNonIndexed();geo.dispose();geo=expanded;}
        keep(geo);
        const p=geo.getAttribute('position');const uv=new Float32Array(p.count*2);
        // FBX triangle corners are duplicated. Average normals by rest position
        // without welding away material/UV seams or changing the body silhouette.
        const shared=new Map<string,number[]>();
        for(let i=0;i<p.count;i++){
            const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*100000)).join(',');
            const group=shared.get(key);if(group)group.push(i);else shared.set(key,[i]);
        }
        const smoothNormals=()=>{
            geo.computeVertexNormals();const normals=geo.getAttribute('normal');
            for(const ids of shared.values()){
                let x=0,y=0,z=0;for(const i of ids){x+=normals.getX(i);y+=normals.getY(i);z+=normals.getZ(i);}
                const length=Math.hypot(x,y,z)||1;for(const i of ids)normals.setXYZ(i,x/length,y/length,z/length);
            }
            normals.needsUpdate=true;
        };
        smoothNormals();
        for(let i=0;i<p.count;i++){
            uv[i*2]=(237+p.getX(i)/1.875*325)/472;
            uv[i*2+1]=1-(424-p.getY(i)/2*336)/472;
        }
        geo.setAttribute('uv',new T.BufferAttribute(uv,2));geo.clearGroups();
        for(let i=0;i<p.count;i+=3){
            const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
            const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
            const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
            // Tint the existing scalp only. Keep the protruding ears and the
            // forward facial surface skin-colored; bare comparison stays unpainted.
            const ear=Math.abs(x)>.81&&y>.86&&y<1.23&&Math.abs(z)<.25;
            const scalp=appearance!=='skin'&&!ear&&y>.72&&(z<0||y>1.72||(Math.abs(x)>.55&&z<.38));
            geo.addGroup(i,3,scalp?(z>0?4:5):y<.60?(z>0?3:2):(z>0?0:1));
        }
        // Reduce only head depth, keeping frontal proportions and original UVs.
        // Blend at the neck so the body and short hands retain their dimensions.
        for(let i=0;i<p.count;i++){
            const weight=T.MathUtils.smoothstep(p.getY(i),.62,.84);
            p.setZ(i,p.getZ(i)*(1-(1-headDepth)*weight));
        }
        p.needsUpdate=true;smoothNormals();
        const mesh=new T.Mesh(geo,[front,back,backCloth,frontCloth,frontScalp,rearScalp]);mesh.castShadow=true;body.add(mesh);surfaces.push(mesh);
        // Separate original hand triangles so gestures are rigid transforms:
        // no vertex displacement can elongate the little hand or its sleeve.
        const groups=geo.groups.map((g:{start:number;count:number;materialIndex?:number})=>({...g}));
        const buckets=[[],[],[]] as number[][];
        for(let i=0;i<p.count;i+=3){
            const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
            buckets[Math.abs(x)>.415&&y>.36&&y<.65?(x>0?2:1):0].push(i);
        }
        const subset=(g:T.BufferGeometry,triangles:number[])=>{
            const indices:number[]=[];g.clearGroups();
            triangles.forEach(i=>{g.addGroup(indices.length,3,groups[i/3].materialIndex);indices.push(i,i+1,i+2);});g.setIndex(indices);
        };
        for(const side of [-1,1]){
            const handGeo=keep(geo.clone());subset(handGeo,buckets[side>0?2:1]);
            handGeo.translate(-side*.415,-.51,0);
            const hand=new T.Mesh(handGeo,mesh.material);hand.position.set(side*.415,.51,0);body.add(hand);hands.push({mesh:hand,side});
        }
        subset(geo,buckets[0]);
        deformers.push({geometry:geo,rest:Float32Array.from(p.array),smoothNormals});
    });
    body.updateMatrixWorld(true);
    if(appearance!=='skin'){
        // Front and rear are two halves of one shared, zero-thickness surface.
        // Both use identical seam positions at +/- PI/2; only their texture differs.
        const ringHalf=(keys:string[],rear:boolean,settings=defaultHairLayer,full=false)=>{
            const geometry=keep(new T.PlaneGeometry(1,1,64,80));
            const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
            for(let i=0;i<p.count;i++){
                const u=uv.getX(i),v=uv.getY(i);
                const sourceY=(1-v)*472;
                const theta=(u-.5)*(full?Math.PI*2:Math.PI);
                // Same 472px registration as skin/clothes: never fit the opaque
                // hair bounds to the full sheet, which would lengthen short styles.
                const y=Math.min(2.20,(424-sourceY)/336*2);
                const crown=Math.sqrt(Math.max(0,1-Math.max(0,(y-1.25)/.95)**2));
                const x=.99*crown*Math.sin(theta);
                const z=(rear?-1:1)*.86*headDepth*crown*Math.cos(theta);
                p.setXYZ(i,x*settings.width*(1+settings.distance),2.2+(y-2.2)*settings.length+settings.offsetY,z*(1+settings.distance));
                // Project original coordinates onto the shared ring so the central
                // bangs keep their 2D width instead of stretching with arc length.
                uv.setXY(i,full?u:(237+x/1.875*325)/472,v);
            }
            geometry.computeVertexNormals();
            const material=keep(new T.MeshStandardMaterial({map:makeTexture(keys),alphaTest:.2,side:T.DoubleSide,roughness:1}));
            const sheet=new T.Mesh(geometry,material);sheet.name=rear?'rear-hair-sheet':'front-hair-sheet';sheet.position.y=-.64;hairPivot.add(sheet);
        };
        for(const [key,rear,index] of [['back2',true,0],['back1',true,1],['earhair',false,0],['fronthair',false,1]] as const){
            const settings=hair?.layers[key]??defaultHairLayer;
            ringHalf([key],rear,{...settings,distance:settings.distance+index*.002});
        }
        for(const layer of hair?.extras??[]){
            if(parts[layer.source])ringHalf([layer.source],false,layer,true);
        }
        // Continue the adjacent painted colors, not the average of the entire
        // hairstyle. Vertex colors carry only a soft color field, never stretched
        // strands or highlights from the original texture.
        const colorField=(keys:string[])=>{
            const c=document.createElement('canvas');c.width=c.height=118;
            const ctx=c.getContext('2d')!;for(const key of keys)if(parts[key])ctx.drawImage(parts[key],0,0,118,118);
            const pixels=ctx.getImageData(0,0,118,118).data;
            const opaque:Array<{x:number;y:number;color:T.Color}>=[];
            for(let y=0;y<118;y++)for(let x=0;x<118;x++){
                const i=(y*118+x)*4;if(pixels[i+3]<200)continue;
                opaque.push({x,y,color:new T.Color().setRGB(pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255,T.SRGBColorSpace)});
            }
            return (x:number,y:number)=>{
                const px=(237+x/1.875*325)/4,py=(424-y/2*336)/4;
                let nearest=Infinity,anchor:typeof opaque[number]|undefined;
                for(const point of opaque){const d=(point.x-px)**2+(point.y-py)**2;if(d<nearest){nearest=d;anchor=point;}}
                if(!anchor)return new T.Color(average(parts.fronthair));
                // A nearest opaque pixel can be the dark painted outline. Take
                // a small opaque neighborhood instead of extending that line
                // across the entire side of the head.
                const color=new T.Color(0,0,0);let weight=0;
                for(const point of opaque){const d=(point.x-anchor.x)**2+(point.y-anchor.y)**2;if(d>16)continue;const w=1/(1+d);color.r+=point.color.r*w;color.g+=point.color.g*w;color.b+=point.color.b*w;weight+=w;}
                return weight?color.multiplyScalar(1/weight):anchor.color.clone();
            };
        };
        const frontColor=colorField(['earhair','fronthair']),rearColor=colorField(['back2','back1']);
        const joinMaterial=keep(new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:1}));
        const finishUnderlay=(geometry:T.BufferGeometry,name:string)=>{
            const p=geometry.getAttribute('position'),colors:number[]=[],normals:number[]=[];
            for(let i=0;i<p.count;i++){
                const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
                const radius=Math.sqrt(Math.max(0,1-Math.max(0,(y-1.25)/.95)**2));
                // Sample the actual front/back boundaries of the side patch.
                // Sampling its outermost x in the middle picks a different dark
                // strand (or outline), producing a stripe on asymmetric styles.
                const sidePatch=name.startsWith('plain-hair-gap');
                const sampleX=sidePatch?Math.sign(x)*.984*radius*Math.cos(.56):x;
                const angle=Math.atan2(z/(.854*headDepth),Math.abs(x)/.984);
                const blend=sidePatch?T.MathUtils.smoothstep(angle,-.56,.56):T.MathUtils.smoothstep(z,-.24,.24);
                const color=rearColor(sampleX,y).lerp(frontColor(sampleX,y),blend);colors.push(color.r,color.g,color.b);
                const normal=new T.Vector3(x/(.984*.984),Math.max(0,y-1.25)/(.95*.95),z/(.854*headDepth)**2).normalize();
                normals.push(normal.x,normal.y,normal.z);
            }
            geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
            geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.deleteAttribute('uv');
            const join=new T.Mesh(geometry,joinMaterial);join.name=name;join.position.y=-.64;hairPivot.add(join);
        };
        for(const side of [-1,1]){
            const geometry=keep(new T.PlaneGeometry(1,1,36,80));
            const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
            for(let i=0;i<p.count;i++){
                const theta=Math.PI/2+(uv.getX(i)-.5)*1.12;
                const y=.78+uv.getY(i)*1.42;
                const crown=Math.sqrt(Math.max(0,1-Math.max(0,(y-1.25)/.95)**2));
                p.setXYZ(i,side*.984*crown*Math.sin(theta),y,.854*headDepth*crown*Math.cos(theta));
            }
            const original=geometry.index!,indices:number[]=[];
            for(let i=0;i<original.count;i+=3){
                const ids=[original.getX(i),original.getX(i+1),original.getX(i+2)];
                const y=ids.reduce((sum,k)=>sum+p.getY(k),0)/3,z=ids.reduce((sum,k)=>sum+p.getZ(k),0)/3;
                if(((y-1.045)/.175)**2+(z/(.205*headDepth))**2<1)continue;
                indices.push(...ids);
            }
            geometry.setIndex(indices);finishUnderlay(geometry,`plain-hair-gap-${side}`);
        }
        // A shallow, closed crown sheet sits just under both hair halves. The
        // shared apex removes the old minimum-radius tube and its open top.
        const crown=keep(new T.SphereGeometry(1,64,18,0,Math.PI*2,0,Math.acos((1.94-1.25)/.947)));
        crown.scale(.982,.947,.852*headDepth);crown.translate(0,1.25,0);
        finishUnderlay(crown,'plain-hair-crown');
    }
    const smooth=(a:number,b:number,v:number)=>T.MathUtils.smoothstep(v,a,b);
    const animate=(time:number,motion:Motion)=>{
        const cute=motion==='wave-cute',calm=motion==='wave-calm'||motion==='wave';
        const sleeping=motion==='sleep',angry=motion==='angry';
        const enter=smooth(0,.35,time);
        const beat=time%2.2;
        // Squash -> airborne -> soft landing, with a rest between little hops.
        const jump=cute?Math.max(0,Math.sin(Math.min(1,Math.max(0,(beat-.18)/.75))*Math.PI))*.24:0;
        const crouch=cute&&beat<.18?Math.sin(beat/.18*Math.PI)*.045:0;
        const headTilt=cute?(-.10+Math.sin(time*3)*.035)*enter:sleeping?.055:angry?Math.sin(time*15)*.022:motion==='dance'?Math.sin(time*3)*.055:Math.sin(time*1.8)*.008;
        body.position.set(sleeping?.94:0,sleeping?.98+Math.sin(time*1.8)*.012:jump-crouch,0);
        body.rotation.set(0,0,sleeping?Math.PI/2-.10:angry?Math.sin(time*14)*.025:motion==='dance'?Math.sin(time*3)*.045:0);
        body.scale.set(1,sleeping?1+Math.sin(time*1.8)*.012:1,1);
        hairPivot.rotation.z=headTilt;
        const faceMap=sleeping?asleepMap:cute?cuteMap:awakeMap;if(front.map!==faceMap){front.map=faceMap;front.needsUpdate=true;}
        for(const {mesh,side} of hands){
            const waving=(cute||calm)&&side>0;
            const swing=Math.sin(time*(cute?7:5));
            mesh.position.set(side*.415,.51,0);
            mesh.rotation.set(0,0,0);
            if(waving){mesh.rotation.z=(.20+swing*.24)*enter;mesh.position.y+=(cute?.055:.025)*enter;mesh.position.z=.025*enter;}
            else if(angry){mesh.rotation.z=side*(.18+Math.sin(time*13)*.08);mesh.position.y+=.02;}
            else if(motion==='walk'||motion==='dance')mesh.rotation.x=Math.sin(time*4+side)*.16;
        }
        for(const {geometry,rest,smoothNormals} of deformers){
            const p=geometry.getAttribute('position');
            for(let i=0;i<p.count;i++){
                const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],side=Math.sign(x);
                let nx=x,ny=y,nz=z;
                if(motion==='walk')nz+=Math.sin(time*4+side*Math.PI/2)*.055*(1-smooth(.12,.30,y));
                if(angry&&side<0)ny+=Math.max(0,Math.sin(time*7))*.05*(1-smooth(.12,.30,y));
                const headWeight=smooth(.62,.84,y),ha=headTilt*headWeight;
                const hx=nx,hy=ny-.64;
                nx=hx*Math.cos(ha)-hy*Math.sin(ha);ny=.64+hx*Math.sin(ha)+hy*Math.cos(ha);
                p.setXYZ(i,nx,ny,nz);
            }
            p.needsUpdate=true;smoothNormals();
        }
    };    return {root,resources,animate};
}
