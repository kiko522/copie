import {createHome,findPlace} from '../../apps/room3d/model.js';
export function bathroomHome(catalog){
 const home=createHome(catalog),r=home.rooms[0];r.name='奶油浴室';r.items=[];
 for(const [assetId,x,z]of [['bath_vanity',-2.9,-2.8],['bath_shower',2.8,-2.8],['bath_linen_cabinet',0,-2.8],['bath_towel_rack',-3.6,-.6],['bath_tub',-2.2,1.7],['bath_washer',3,.05],['bath_toilet',.8,2.6],['bath_hamper',3.3,2.7],['bath_cart',.8,-.6],['bath_stool',-.8,-.1],['bath_mat',-.8,.05]])r.items.push({id:assetId,assetId,x,y:.15,z,rotation:0,color:null,stored:false});
 for(const [id,parent]of [['bath_folded_towels','bath_washer'],['bath_detergent','bath_washer'],['bath_tray','bath_tub'],['bath_soap','bath_tray']]){const support=r.items.find(i=>i.id===parent),subset={...r,items:[support,...r.items.filter(i=>i.supportId===parent)]};r.items.push(findPlace(catalog.find(a=>a.id===id),subset,catalog,id));}
 return home;
}
