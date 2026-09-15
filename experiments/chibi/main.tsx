import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Puppet, type Motion } from './Puppet';
import type { Parts } from './Puppet';
import './style.css';
import { CreatorRollBridge, type RollResult } from './CreatorRollBridge';

function App() {
    const [parts, setParts] = useState<Parts>();
    const [image, setImage] = useState(''), [error, setError] = useState('');
    const [yaw, setYaw] = useState(18);
    const [flat, setFlat] = useState(false), [wire, setWire] = useState(false);
    const [motion, setMotion] = useState<Motion>('idle');
    const [playing, setPlaying] = useState(true);
    const [rollRequest, setRollRequest] = useState(0);
    const [rolling, setRolling] = useState(false);
    const [rollReady, setRollReady] = useState(false);
    const [bare, setBare] = useState(false);

    const requestRoll=()=>{setError('');setRolling(true);setRollRequest(v=>v+1);};
    const acceptRoll=async(result:RollResult)=>{
        try{
            const loaded:Parts={};
            await Promise.all(Object.entries(result.layers).map(async([key,url])=>{const img=new Image();img.src=url;await img.decode();loaded[key]=img;}));
            // Outer clothing is another original creator layer; keep it on the garment.
            if(loaded.outer){const c=document.createElement('canvas');c.width=c.height=472;const ctx=c.getContext('2d')!;ctx.drawImage(loaded.outfit,0,0);ctx.drawImage(loaded.outer,0,0);const img=new Image();img.src=c.toDataURL();await img.decode();loaded.outfit=img;}
            setParts(loaded);setImage(result.image);
        }catch(e){setError(String(e));}finally{setRolling(false);}
    };
    useEffect(()=>{
        if(!rolling)return;
        const timer=window.setTimeout(()=>{setRolling(false);setError('这次 Roll 等待太久，可以再试一次。');},20000);
        return()=>window.clearTimeout(timer);
    },[rolling,rollRequest]);    return <main><CreatorRollBridge request={rollRequest} onReady={()=>{setRollReady(true);requestRoll();}} onResult={acceptRoll} onError={message=>{setError(message);setRolling(false);}}/>
        <header><div className="eyebrow">KANATA / HAIR SHEETS</div><h1>再试一次，发片小人。</h1><p>前后一圈薄发片，包住圆墩墩的素体。</p></header>
        <section className="stage">{parts ? <><div className="model-layer" style={{ visibility: flat ? 'hidden' : 'visible' }}><Puppet parts={parts} yaw={yaw} motion={motion} wire={wire} playing={playing && !flat} appearance={bare ? 'skin' : 'outfit'} /></div>{flat && <img className="original" src={image} alt="原始分层 chibi 合成图" />}</> : <p>{error || '正在读取分层素材…'}</p>}</section>
        <footer>
            <div className="actions">{([['idle','站立'],['wave-cute','可爱挥手'],['wave-calm','冷静挥手'],['sleep','睡觉'],['angry','生气'],['walk','走路'],['dance','晃一晃']] as const).map(([key,label])=><button key={key} aria-pressed={motion===key} onClick={()=>{setMotion(key);setPlaying(true);setFlat(false);}}>{label}</button>)}<button onClick={()=>setPlaying(!playing)}>{playing?'暂停':'继续'}</button></div>
            <div className="controls"><label>转角 <input aria-label="转角" type="range" min="-180" max="180" value={yaw} onChange={e => setYaw(+e.target.value)} /><output>{yaw}°</output></label></div>
            <nav><button aria-pressed={bare} onClick={()=>setBare(!bare)}>{bare ? '穿回发片' : '看光头素体'}</button><button aria-pressed={flat} onClick={() => setFlat(!flat)}>{flat ? '返回立体' : '对照原图'}</button><button aria-pressed={wire} onClick={() => setWire(!wire)}>{wire ? '隐藏网格' : '显示网格'}</button><button disabled={!rollReady||rolling} onClick={requestRoll}>{rolling ? 'Roll 中…' : '🎲 Roll 一只'}</button><button onClick={() => { setYaw(0); }}>正面</button></nav>
            <p className="note">前发与后发使用同一圈曲面的前后两半，侧边对齐。发片没有厚度；保留原图透明轮廓。</p>
            {error && <p role="alert">{error}</p>}
        </footer>
    </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
