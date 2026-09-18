// Desktop Clear also supersamples 1× monitors. A device-pixel-ratio cap alone
// left those displays rendering the same number of pixels as Balanced.
export function roomPixelRatio(quality,deviceRatio,coarse=false){
 const dpr=Number.isFinite(deviceRatio)&&deviceRatio>0?deviceRatio:1;
 if(quality==='clear')return coarse?Math.min(dpr,1.5):1.5;
 return Math.min(dpr,quality==='balanced'?1:.75);
}
