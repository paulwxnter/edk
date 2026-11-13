import { type Box, clamp } from "./koi/world";

export type Point = { x: number; y: number };
export type Joint = Point & { px: number; py: number };
export type Agent = Point & { vx: number; vy: number; angle: number; phase: number; size: number; seed: number };
export type Pulse = Point & { born: number };
export const TAU = Math.PI * 2;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function repel(boxes: Box[], x: number, y: number, margin: number): Point {
  let fx = 0, fy = 0;
  for (const b of boxes) {
    let dx = x - clamp(x, b.left, b.right), dy = y - clamp(y, b.top, b.bottom);
    let d = Math.hypot(dx, dy);
    if (d > margin) continue;
    if (d < .01) {
      const edges = [x - b.left, b.right - x, y - b.top, b.bottom - y];
      const edge = edges.indexOf(Math.min(...edges));
      dx = edge === 0 ? -1 : edge === 1 ? 1 : 0;
      dy = edge === 2 ? -1 : edge === 3 ? 1 : 0;
    }
    const length = Math.hypot(dx, dy) || 1;
    const pressure = (1 - d / margin) ** 2;
    fx += dx / length * pressure; fy += dy / length * pressure;
  }
  return { x: fx, y: fy };
}

export function isFree(boxes: Box[], x: number, y: number, radius: number) {
  return !boxes.some(b => x + radius > b.left && x - radius < b.right && y + radius > b.top && y - radius < b.bottom);
}

export function freePosition(boxes: Box[], width: number, height: number, radius: number, index: number, neighbors: {x:number;y:number;radius:number}[] = []): Point {
  const focus = boxes.filter(b => b.right-b.left < width*.95).sort((a,b) => (b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  const cx=focus?(focus.left+focus.right)/2:width/2,cy=focus?(focus.top+focus.bottom)/2:height/2;
  const left=focus?focus.left-radius-18:width*.25,right=focus?focus.right+radius+18:width*.75;
  const top=focus?focus.top-radius-18:height*.25,bottom=focus?focus.bottom+radius+18:height*.75;
  const offset=Math.min(135,height*.2);
  const sites = [[right,cy-offset],[left,cy+offset],[right,cy+offset],[left,cy-offset],[cx+radius*1.3,bottom],[cx-radius*1.3,top],[cx-radius*1.3,bottom],[cx+radius*1.3,top]];
  for (let i = 0; i < sites.length; i++) {
    const p = sites[(index + i) % sites.length];
    const x = clamp(p[0], radius+16, width-radius-16), y = clamp(p[1], radius+98, height-radius-20);
    if (isFree(boxes, x, y, radius) && neighbors.every(n=>Math.hypot(x-n.x,y-n.y)>(radius+n.radius)*.82)) return { x, y };
  }
  let best = { x: width * .8, y: height * .22 }, score = -Infinity;
  for (let i = 0; i < 80; i++) {
    const x = rand(radius+16, width-radius-16), y = rand(radius+98, height-radius-20);
    const distance = boxes.reduce((d,b) => Math.min(d, Math.hypot(x-clamp(x,b.left,b.right),y-clamp(y,b.top,b.bottom))), Infinity);
    // Prefer visible space near the copy, not the most distant screen edge.
    const crowding=neighbors.reduce((v,n)=>v+Math.max(0,(radius+n.radius)*.82-Math.hypot(x-n.x,y-n.y)),0);
    const candidateScore=Math.min(distance,radius+25)*4-Math.hypot(x-cx,y-cy)*.12-crowding*5;
    if (candidateScore > score) { score = candidateScore; best = { x,y }; }
  }
  return best;
}

export function makeChain(x: number, y: number, count: number, length: number, angle = Math.PI / 2): Joint[] {
  return Array.from({ length: count }, (_,i) => ({ x: x + Math.cos(angle)*length*i, y: y + Math.sin(angle)*length*i, px: x + Math.cos(angle)*length*i, py: y + Math.sin(angle)*length*i }));
}

/** A damped, constrained chain: actual lagging geometry, not a translated mask. */
export function stepChain(nodes: Joint[], root: Point, length: number, dt: number, time: number, seed: number, lift: number, wind: number, pointer: Point | null) {
  const step = dt * dt;
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i], x = n.x, y = n.y;
    let fx = Math.sin(time * .7 + i * .28 + seed) * 22 + wind;
    let fy = lift;
    if (pointer) { const dx = n.x-pointer.x, dy = n.y-pointer.y, d = Math.hypot(dx,dy)||1; if(d<110){fx+=dx/d*(110-d)*1.4;fy+=dy/d*(110-d)*1.4;} }
    n.x += (n.x-n.px)*.97 + fx*step; n.y += (n.y-n.py)*.97 + fy*step;
    n.px=x; n.py=y;
  }
  for (let pass=0;pass<3;pass++) {
    nodes[0].x=root.x;nodes[0].y=root.y;
    for(let i=1;i<nodes.length;i++) {
      const a=nodes[i-1],b=nodes[i],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
      const correction=(d-length)/d;
      if(i===1){b.x-=dx*correction;b.y-=dy*correction;}else{a.x+=dx*correction*.5;a.y+=dy*correction*.5;b.x-=dx*correction*.5;b.y-=dy*correction*.5;}
    }
  }
}
