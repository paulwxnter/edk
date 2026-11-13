import { type Agent, TAU } from "./motion";

function oval(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string,rotation=0){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,rotation,0,TAU);c.fill();}

/** Recognisable physical-world forms. Drawn as live geometry into the same
 * character-cell renderer, with independent details rather than animal motion. */
export function drawHouse(c:CanvasRenderingContext2D,a:Agent,time:number) {
  const s=a.size,depth=s*(.24+.045*Math.sin(time*.55+a.seed));
  const roof=["#c29773","#8da699","#a6a8bd"][Math.floor(a.seed)%3];
  c.save();c.rotate(Math.sin(time*.35+a.seed)*.018);
  c.fillStyle="#c9bea5";c.beginPath();c.moveTo(-s*.65,-s*.1);c.lineTo(s*.35,-s*.1);c.lineTo(s*.35,s*.45);c.lineTo(-s*.65,s*.45);c.closePath();c.fill();
  c.fillStyle="#9ca28e";c.beginPath();c.moveTo(s*.35,-s*.1);c.lineTo(s*.35+depth,-s*.28);c.lineTo(s*.35+depth,s*.27);c.lineTo(s*.35,s*.45);c.closePath();c.fill();
  c.fillStyle=roof;c.beginPath();c.moveTo(-s*.78,-s*.06);c.lineTo(-s*.16,-s*.55);c.lineTo(s*.5,-s*.06);c.closePath();c.fill();
  c.fillStyle="#807d75";c.beginPath();c.moveTo(-s*.16,-s*.55);c.lineTo(-s*.16+depth,-s*.73);c.lineTo(s*.5+depth,-s*.24);c.lineTo(s*.5,-s*.06);c.closePath();c.fill();
  c.fillStyle="#ac9b83";c.fillRect(s*.14,-s*.84,s*.12,s*.3);
  c.fillStyle="#64695f";c.fillRect(-s*.21,s*.15,s*.22,s*.3);
  for(const x of [-.48,.14]) {
    c.fillStyle="#687b79";c.fillRect(s*x,s*.08,s*.18,s*.2);
    c.fillStyle="#d7bb7a";c.fillRect(s*(x+.025),s*.1,s*.13,s*.15);
    c.strokeStyle="#879181";c.lineWidth=2;c.beginPath();c.moveTo(s*(x+.09),s*.09);c.lineTo(s*(x+.09),s*.27);c.stroke();
  }
  oval(c,-s*.16,-s*.27,s*.085,s*.085,"#ded3b8");
  for(let i=0;i<4;i++) {
    const age=(time*.42+i*.25+a.seed)%1;
    c.globalAlpha=(1-age)*.45;
    oval(c,s*.2+Math.sin(age*4+time*.45)*s*.08,-s*.86-age*s*.6,s*(.035+age*.065),s*(.05+age*.04),"#c1c5ba");
  }
  c.restore();
}

export function drawCar(c:CanvasRenderingContext2D,a:Agent,time:number) {
  const s=a.size,dir=Math.cos(a.angle)>=0?1:-1;
  c.save();c.scale(dir,1);c.translate(0,Math.sin(time*3+a.seed)*1.4);
  const paint=["#91afa5","#c1a67c","#b899a0","#96a5bd"][Math.floor(a.seed)%4];
  c.fillStyle=paint;c.beginPath();c.moveTo(-s*.92,s*.05);c.lineTo(-s*.81,-s*.18);c.lineTo(-s*.45,-s*.24);c.quadraticCurveTo(-s*.24,-s*.67,s*.06,-s*.61);c.lineTo(s*.38,-s*.24);c.lineTo(s*.88,-s*.15);c.quadraticCurveTo(s*1.02,-s*.06,s*.96,s*.2);c.lineTo(-s*.91,s*.2);c.closePath();c.fill();
  c.fillStyle="#485b61";c.beginPath();c.moveTo(-s*.37,-s*.27);c.quadraticCurveTo(-s*.18,-s*.57,s*.02,-s*.52);c.lineTo(s*.25,-s*.27);c.closePath();c.fill();
  c.strokeStyle="#b8c8c3";c.lineWidth=3;c.beginPath();c.moveTo(-s*.08,-s*.53);c.lineTo(-s*.08,-s*.27);c.stroke();
  c.fillStyle="#e2d0a0";c.fillRect(s*.8,-s*.1,s*.12,s*.08);c.fillStyle="#be8064";c.fillRect(-s*.91,-s*.04,s*.1,s*.08);
  c.strokeStyle="#6f817c";c.lineWidth=2;c.beginPath();c.moveTo(-s*.04,-s*.16);c.lineTo(-s*.04,s*.11);c.stroke();
  c.fillStyle="#c4c5b4";c.fillRect(s*.03,-s*.13,s*.1,s*.025);
  for(const x of [-.57,.58]) {
    oval(c,s*x,s*.2,s*.17,s*.17,"#5c665f");oval(c,s*x,s*.2,s*.095,s*.095,"#c5c9bb");
    const angle=-time*2.4-a.seed,r=s*.075,dx=Math.cos(angle)*r,dy=Math.sin(angle)*r;
    c.save();c.translate(s*x,s*.2);c.strokeStyle="#697b72";c.lineWidth=3;c.beginPath();c.moveTo(-dx,-dy);c.lineTo(dx,dy);c.moveTo(-dy,dx);c.lineTo(dy,-dx);c.stroke();c.restore();
  }
  c.restore();
}

export function drawTree(c:CanvasRenderingContext2D,a:Agent,time:number,index:number,gust:number) {
  const s=a.size,wind=Math.sin(time*.72+a.seed)*s*.055+gust*s*.04;
  c.save();
  c.strokeStyle="#aa916b";c.lineWidth=s*.095;c.beginPath();c.moveTo(0,s*.8);c.bezierCurveTo(0,s*.26,wind,-s*.2,wind*1.6,-s*.62);c.stroke();
  if(index%2===0){
    for(let i=3;i>=0;i--) {
      const y=-s*.73+i*s*.26,w=s*(.26+i*.16),shift=wind*(1.7-i*.3);
      c.fillStyle=i%2?"#8ca474":"#a3b681";c.beginPath();c.moveTo(shift,y-s*.16);c.bezierCurveTo(shift-w*.2,y+s*.1,shift-w*.7,y+s*.24,shift-w,y+s*.35);c.quadraticCurveTo(shift,y+s*.46,shift+w,y+s*.35);c.bezierCurveTo(shift+w*.7,y+s*.24,shift+w*.2,y+s*.1,shift,y-s*.16);c.fill();
    }
  }else{
    c.lineWidth=s*.045;
    for(const side of [-1,1]){c.beginPath();c.moveTo(0,s*.15);c.quadraticCurveTo(wind,-s*.15,side*s*.36+wind,-s*.38);c.stroke();}
    oval(c,-s*.38+wind,-s*.34,s*.37,s*.36,"#8eab76",-.2);
    oval(c,s*.32+wind*1.5,-s*.45,s*.4,s*.36,"#a8b987",.2);
    oval(c,wind*1.7,-s*.71,s*.36,s*.4,"#a1b983",.05);
    oval(c,wind,-s*.22,s*.4,s*.32,"#91aa72");
  }
  c.restore();
}

/** Open, articulated limbs keep the tree legible as character work. Parent
 * branches carry their children, so the canopy flexes instead of sliding. */
export function drawBranchTree(c:CanvasRenderingContext2D,a:Agent,time:number,gust=0) {
  const s=a.size,wind=Math.sin(time*.62)*.055+Math.sin(time*.27+1)*.025+gust*.025;
  c.save();c.lineCap="round";
  function limb(x:number,y:number,length:number,angle:number,depth:number,seed:number) {
    const bend=wind*(1+(3-depth)*.3)+Math.sin(time*.8+seed)*.018;
    const heading=angle+bend,tx=x+Math.cos(heading)*length,ty=y+Math.sin(heading)*length;
    c.strokeStyle=depth>1?"#ad9874":"#9ea17e";
    c.lineWidth=Math.max(2.5,s*.055*Math.pow(.63,3-depth));
    c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+Math.cos(angle)*length*.5+wind*length*.5,y+Math.sin(angle)*length*.5,tx,ty);c.stroke();
    if(depth>0) {
      limb(tx,ty,length*.68,heading-.43,depth-1,seed+1.7);
      limb(tx,ty,length*.62,heading+.5,depth-1,seed+3.1);
    } else {
      oval(c,tx+4,ty-2,s*.042,s*.018,"#a9b681",heading-.4);
      oval(c,tx-4,ty+2,s*.034,s*.016,"#90a879",heading+.5);
    }
  }
  const bend=wind*s*.25;
  c.strokeStyle="#b19b76";c.lineWidth=s*.075;c.beginPath();c.moveTo(0,0);c.bezierCurveTo(-s*.07,-s*.35,bend,-s*.73,bend,-s*.98);c.stroke();
  limb(-s*.015,-s*.54,s*.39,-2.35,3,.7);
  limb(bend*.5,-s*.74,s*.39,-.88,3,2.3);
  limb(bend,-s*.97,s*.34,-1.65,3,4.1);
  c.lineWidth=3;c.beginPath();c.moveTo(-s*.11,1);c.quadraticCurveTo(0,-4,s*.12,1);c.stroke();
  c.restore();
}
