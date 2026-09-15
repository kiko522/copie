import React, { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { buildBody, loadBody } from './FbxBody';

export type Parts = Record<string, HTMLImageElement>;
export type Motion = 'idle' | 'wave' | 'wave-cute' | 'wave-calm' | 'sleep' | 'angry' | 'walk' | 'dance';

export function Puppet({ parts, yaw, motion, wire, playing, appearance = 'outfit' }: { parts: Parts; yaw: number; motion: Motion; wire: boolean; playing: boolean; appearance?: 'skin' | 'hair' | 'outfit' }) {
    const [source, setSource] = useState<T.Group>();
    const [loadError, setLoadError] = useState('');
    useEffect(() => { let cancelled=false; let loaded:T.Group|undefined; const release=()=>loaded?.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}}); loadBody().then(m=>{loaded=m;if(cancelled)release();else setSource(m);}).catch(e=>{if(!cancelled)setLoadError(String(e));});return()=>{cancelled=true;release();}; }, []);
    const host = useRef<HTMLDivElement>(null), controls = useRef({ yaw, motion, wire, playing });
    controls.current = { yaw, motion, wire, playing };
    const [error, setError] = useState('');
    useEffect(() => {
        if (!source) return;
        const element = host.current!;
        let renderer: T.WebGLRenderer | undefined, rig: ReturnType<typeof buildBody> | undefined;
        let observer: ResizeObserver | undefined, frame = 0;
        const extra: Array<{ dispose(): void }> = [];
        setError('');
        try {
            rig = buildBody(source, parts, appearance);
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = T.PCFSoftShadowMap;
            element.appendChild(renderer.domElement);
            const scene = new T.Scene(); scene.add(rig.root);
            // Broad neutral fill keeps the chibi's painted shading readable,
            // with just enough directional light to describe the rounded form.
            scene.add(new T.AmbientLight('#ffffff', .65));
            scene.add(new T.HemisphereLight('#ffffff', '#ede6df', 1.9));
            const light = new T.DirectionalLight('#fff8ef', .65); light.position.set(-3, 5, 5); light.castShadow = true;
            light.shadow.mapSize.set(1024, 1024); light.shadow.normalBias = .025; light.shadow.radius = 4; scene.add(light);
            const fill = new T.DirectionalLight('#f1f4ff', .35); fill.position.set(3, 2, -4); scene.add(fill);
            const floorGeo = new T.CircleGeometry(1.8, 64), floorMat = new T.MeshStandardMaterial({ color: '#ddd5c7', roughness: 1 });
            extra.push(floorGeo, floorMat);
            const floor = new T.Mesh(floorGeo, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = .015; floor.receiveShadow = true; scene.add(floor);
            const camera = new T.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, .1, 30);
            const resize = () => {
                const w = element.clientWidth, h = element.clientHeight; if (!w || !h) return;
                renderer!.setSize(w, h);
                const aspect=w/h, halfHeight=Math.max(1.48,1.22/aspect);
                camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;
                camera.top=halfHeight;camera.bottom=-halfHeight;
                // Match the original art vertically: front hair must not appear
                // longer simply because it sits nearer a tilted perspective camera.
                camera.position.set(0, 1.10, 6); camera.lookAt(0, 1.10, 0); camera.updateProjectionMatrix();
            };
            observer = new ResizeObserver(resize); observer.observe(element); resize();
            let time = 0, previous = 0, lastWire = false, lastMotion=controls.current.motion;
            const render = (stamp: number) => {
                frame = requestAnimationFrame(render);
                const dt = previous ? Math.min((stamp - previous) / 1000, .05) : 0; previous = stamp;
                if (document.hidden) return;
                const c = controls.current, r = rig!;
                if(c.motion!==lastMotion){time=0;lastMotion=c.motion;}
                if (c.playing) time += dt;
                r.root.rotation.y = c.yaw * Math.PI / 180;
                r.animate(time, c.motion);
                if (c.wire !== lastWire) { r.root.traverse(o => { if (o instanceof T.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.wireframe = c.wire; }); }); lastWire = c.wire; }
                renderer!.render(scene, camera);
            };
            frame = requestAnimationFrame(render);
        } catch (e) { setError(`无法显示 3D：${String(e)}`); }
        return () => { cancelAnimationFrame(frame); observer?.disconnect(); rig?.resources.forEach(r => r.dispose()); extra.forEach(r => r.dispose()); renderer?.domElement.remove(); renderer?.dispose(); };
    }, [source, parts, appearance]);
    return <div ref={host} className="puppet">{(error || loadError) && <p role="alert">{error || loadError}</p>}{!source && !loadError && <p>正在加载你的 FBX 素体…</p>}</div>;
}
