// One shared beat clock for rigid-body hops, hand contact and the struck keys.
// The apex targets are reviewed in gamingActivities; no limb scaling or IK stretch.
export function rhythmFrame(activity,time){
 const beats=activity?.rhythm;if(!beats?.length)return null;
 const t=Math.max(0,time),beat=beats[Math.floor(t/1.5)%beats.length],phase=t%1.5;
 const smooth=(a,b,v)=>{const x=Math.max(0,Math.min(1,(v-a)/(b-a)));return x*x*(3-2*x);};
 const lift=phase<.62?smooth(.12,.56,phase):1-smooth(.68,1.24,phase);
 const crouch=phase<.12?Math.sin(phase/.12*Math.PI)*.035:0;
 const offset=beat.offset.map(v=>v*lift);offset[1]-=crouch;
 const reach=smooth(.10,.53,phase)*(1-smooth(.75,1.25,phase));
 const hands=beat.hands.map((p,i)=>{const rest=[i? .415:-.415,.51,.10];return p.map((v,k)=>rest[k]+(v-rest[k])*reach);});
 return {offset,hands,keys:phase>=.56&&phase<=.68?beat.keys:[],phase};
}
