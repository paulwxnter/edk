import land from "../data/earth-land.json";

// Rasterize Natural Earth's land polygons once in longitude/latitude space.
// The sphere samples this texture, avoiding false polygons across the horizon.
let texture: Uint8Array | null = null;
function getTexture() {
  if(texture)return texture;
  texture=new Uint8Array(360*180);
  for(const ring of land) {
    const points=ring.map(([lon,lat])=>({x:lon+180,y:90-lat}));
    const low=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),high=Math.min(179,Math.ceil(Math.max(...points.map(p=>p.y))));
    for(let row=low;row<=high;row++) {
      const y=row+.5,crossings:number[]=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[j],b=points[i];
        if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))crossings.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
      }
      crossings.sort((a,b)=>a-b);
      for(let i=0;i+1<crossings.length;i+=2) {
        const from=Math.max(0,Math.ceil(crossings[i]-.5)),to=Math.min(359,Math.floor(crossings[i+1]-.5));
        for(let x=from;x<=to;x++)texture[row*360+x]=1;
      }
    }
  }
  return texture;
}
export function landAt(longitude:number,latitude:number) {
  const x=((Math.floor(longitude*180/Math.PI+180)%360)+360)%360;
  const y=Math.max(0,Math.min(179,Math.floor(90-latitude*180/Math.PI)));
  return getTexture()[y*360+x]===1;
}
const colors=(rgb:number[])=>Array.from({length:20},(_,i)=>`rgb(${rgb.map(v=>Math.round(v*(.33+i/19*.67))).join(",")})`);
export const EARTH_COLORS = { land:colors([151,171,119]),sea:colors([104,151,169]),cloud:colors([198,205,192]) };
