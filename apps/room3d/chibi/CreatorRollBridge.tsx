import React, { useEffect, useRef, useState } from 'react';
export interface RollResult { layers:Record<string,string>; image:string; state?:unknown }
export function CreatorRollBridge({ request, savedState, extraItems, editing=false, captureOnly=false, onReady, onResult, onError }: { request:number; savedState?:unknown; extraItems?:unknown[]; editing?:boolean; captureOnly?:boolean; onReady:()=>void; onResult:(r:RollResult)=>void; onError:(message:string)=>void }) {
    const frame=useRef<HTMLIFrameElement>(null),callbacks=useRef({onReady,onResult,onError});callbacks.current={onReady,onResult,onError};
    const [html,setHtml]=useState('');
    const active=useRef(0);
    useEffect(()=>{
        let cancelled=false;
        const origin=location.origin;
        const bridge=`<script>
        // This document is an isolated copy of the existing creator. Its functions,
        // palette and rendering remain the source of truth; no user draft is saved.
        let rollBusy=false;
        window.addEventListener('message',async e=>{
          if(e.source!==parent||e.origin!==${JSON.stringify(origin)}||e.data?.type!=='experiment-roll'||rollBusy)return;
          rollBusy=true;const id=e.data.id;
          try{
            if(e.data.extraItems)mergeExtraItems(e.data.extraItems);
            if(!e.data.captureOnly){
              if(e.data.savedState){if(!applyFullState(e.data.savedState))throw Error('无法还原形象');renderCharacter();}
              else randomizeAll();
            }
            await Promise.all(Object.values(imgCache).filter(x=>x instanceof Promise));
            await Promise.resolve();
            await Promise.all([...document.querySelectorAll('.character img')].map(img=>img.decode()));
            const layers={},whole=document.createElement('canvas');whole.width=whole.height=472;
            const wholeCtx=whole.getContext('2d');
            for(const layer of document.querySelectorAll('.character > .layer')){
              const canvas=document.createElement('canvas');canvas.width=canvas.height=472;const ctx=canvas.getContext('2d');
              for(const drawable of layer.querySelectorAll('img,canvas')){
                let opacity=1,node=drawable;
                while(node&&node!==layer){opacity*=Number(getComputedStyle(node).opacity);node=node.parentElement;}
                ctx.globalAlpha=opacity;ctx.drawImage(drawable,0,0,472,472);
              }
              const key=layer.id.replace('layer-','');layers[key]=canvas.toDataURL();
              wholeCtx.globalAlpha=Number(getComputedStyle(layer).opacity);wholeCtx.drawImage(canvas,0,0);
            }
            parent.postMessage({type:'experiment-roll-result',id,payload:{layers,image:whole.toDataURL(),state:JSON.parse(JSON.stringify(state))}},${JSON.stringify(origin)});
          }catch(error){parent.postMessage({type:'experiment-roll-error',id,message:String(error)},${JSON.stringify(origin)});}
          finally{rollBusy=false;}
        });
        fetch('parts/manifest.json').then(r=>{if(!r.ok)throw new Error('素材清单加载失败');return r.json();}).then(items=>{mergeExtraItems(items);parent.postMessage({type:'experiment-roll-ready'},${JSON.stringify(origin)});}).catch(e=>parent.postMessage({type:'experiment-roll-error',message:String(e)},${JSON.stringify(origin)}));
        </script>`;
        const base=new URL(`${import.meta.env.BASE_URL}like520/`,location.href).href;
        fetch(new URL('character_creator.html',base)).then(r=>{if(!r.ok)throw new Error('捏人器加载失败');return r.text();}).then(text=>{
            if(cancelled)return;
            // No changes to the production creator file; isolate its draft writes.
            setHtml(text.replace(/saveDraft\(\);/g,'/* preview: no draft writes */').replace(/<script\b[^>]*\bsrc=[^>]*>[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+base+'"><style>#btnSave{display:none!important}</style>').replace('</body>',bridge+'</body>'));
        }).catch(e=>{if(!cancelled)callbacks.current.onError(String(e));});
        const receive=(e:MessageEvent)=>{
            if(e.source!==frame.current?.contentWindow||e.origin!==origin)return;
            if(e.data?.type==='experiment-roll-ready')callbacks.current.onReady();
            if(e.data?.type==='experiment-roll-result'&&e.data.id===active.current)callbacks.current.onResult(e.data.payload);
            if(e.data?.type==='experiment-roll-error'&&(e.data.id===undefined||e.data.id===active.current))callbacks.current.onError(e.data.message);
        };
        window.addEventListener('message',receive);
        return()=>{cancelled=true;window.removeEventListener('message',receive);};
    },[]);
    useEffect(()=>{
        if(!request)return;
        active.current=request;
        frame.current?.contentWindow?.postMessage({type:'experiment-roll',id:request,savedState,extraItems,captureOnly},location.origin);
    },[request,savedState,extraItems,captureOnly]);
    return html?<iframe ref={frame} title="小人捏人器" aria-hidden={!editing} tabIndex={editing?0:-1} srcDoc={html} style={editing?{position:'fixed',inset:'60px 0 0',width:'100%',height:'calc(100dvh - 60px)',border:0,zIndex:30,background:'#fff8f0'}:{position:'fixed',left:-10000,top:0,width:472,height:472,border:0,pointerEvents:'none'}}/>:null;
}
