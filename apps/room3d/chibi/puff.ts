/** Distance from an opaque pixel to the silhouette edge, in grid cells. */
export function silhouetteDepth(alpha:Uint8Array,width:number,height:number){
 const d=new Float32Array(alpha.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;d[i]=alpha[i]<64||x===0||y===0||x===width-1||y===height-1?0:width+height;}
 for(let y=1;y<height;y++)for(let x=1;x<width;x++){const i=y*width+x;d[i]=Math.min(d[i],d[i-1]+1,d[i-width]+1,d[i-width-1]+1.4142);}
 for(let y=height-2;y>=0;y--)for(let x=width-2;x>=0;x--){const i=y*width+x;d[i]=Math.min(d[i],d[i+1]+1,d[i+width]+1,d[i+width+1]+1.4142);}
 // The outermost opaque row joins at zero thickness. Each disconnected piece
 // gets its own maximum, so a little hair bun can be as plump as a large tail.
 const seen=new Uint8Array(alpha.length);
 for(let start=0;start<d.length;start++){if(seen[start]||alpha[start]<64)continue;const component=[start];seen[start]=1;let max=0;
  for(let k=0;k<component.length;k++){const i=component[k];max=Math.max(max,d[i]);const x=i%width,y=Math.floor(i/width);for(const n of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1])if(n>=0&&!seen[n]&&alpha[n]>=64){seen[n]=1;component.push(n);}}
  for(const i of component)d[i]=max>1?Math.sqrt(Math.max(0,(d[i]-1)/(max-1))):0;
 }
 return d;
}
