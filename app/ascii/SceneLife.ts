import { type Box, clamp } from "./koi/world";
import type { MotionSceneId } from "./scenes";
import { type Agent, type Joint, type Point, type Pulse, TAU, angleDelta, freePosition, makeChain, rand, repel, stepChain } from "./motion";
import { drawBranchTree, drawCar, drawHouse, drawTerrain, drawTree } from "./WorldArtifacts";
import { type ArtworkPlacement, layoutArtwork } from "./compositions";
import { EARTH_COLORS, landAt } from "./earthSurface";

type Pointer = Point & { active: boolean; speed: number };
type Frond = { nodes: Joint[]; root: Point; length: number; seed: number; owner: number };
const ROOTED: MotionSceneId[] = ["branch-tree", "trees", "kelp", "grass", "willow", "waves", "river", "aurora", "earth"];
const COLORS = { water: "#85a7ae", silver: "#bdc8c3", green: "#799763", gold: "#d19a50", pink: "#b39eb3", white: "#d2c8b7", ink: "#292923" };

/** Distinct physical-world subjects share the original character renderer and
 * keep multiple visible forms circulating through the space around the copy. */
export class SceneLife {
  time = 0;
  agents: Agent[] = [];
  private fronds: Frond[] = [];
  private tentacles: Joint[][][] = [];
  private pulses: Pulse[] = [];
  private leaves: (Point & { born: number; seed: number })[] = [];
  private width = 1;
  private height = 1;
  private boxes: Box[] = [];
  private pointer: Pointer = { x: -1000, y: -1000, active: false, speed: 0 };
  private spin = -.6;
  private spinSpeed = .055;
  private dragging = false;
  private draggingTime = -100;
  private inkAt = -100;
  private reduced = false;
  private anchor: {x:number;y:number;size:number} | null = null;

  constructor(readonly id: MotionSceneId, private density = 1, private placementOffset = 0, private placement?: ArtworkPlacement) {}
  get count() { return this.agents.length; }
  get particles() { return this.pulses.length + this.leaves.length; }

  resize(width: number, height: number, boxes: Box[]) {
    this.width = width; this.height = height; this.boxes = boxes;
    const small = width < 650;
    const base = clamp(Math.min(width, height) * .17, 62, 112);
    const populations: Record<MotionSceneId, number> = { "branch-tree":2, trees: small?2:3, houses: small?2:3, terrain: small?1:2, cars: small?3:4, shoal: small ? 6 : 9, rays: small ? 2 : 3, jellyfish: small?3:4, octopus: 2, birds: small ? 4 : 7, butterflies: small?3:5, dragonflies: small?3:4, hummingbirds: small?2:3, kelp: small?2:3, grass: small?2:3, willow: 2, waves: small?2:3, river: 2, aurora: 2, earth: 2 };
    const count = this.placement ? 1 : Math.max(1, Math.round(populations[this.id] * this.density));
    const occupied: {x:number;y:number;radius:number}[]=[];
    this.agents = Array.from({ length: count }, (_, i) => {
      let size = base;
      if (this.id === "shoal") size *= .42;
      if (this.id === "birds" || this.id === "butterflies" || this.id === "dragonflies") size *= .57;
      if (this.id === "hummingbirds") size *= .7;
      if (this.id === "jellyfish") size *= .5;
      if (this.id === "willow") size *= 1.1;
      if (this.id === "trees" || this.id === "houses") size *= .9;
      if (this.id === "cars") size *= .85;
      size *= .87 + (i%3)*.08;
      const radius=size*(ROOTED.includes(this.id)?1.05:1.2);
      const pos = freePosition(boxes, width, height, radius, this.id === "shoal" ? this.placementOffset : i+this.placementOffset, this.id === "shoal" ? [] : occupied);
      if (this.id === "shoal") { pos.x += Math.cos(i * 2.4) * 38; pos.y += Math.sin(i * 2.4) * 50; }
      occupied.push({...pos,radius});
      return { ...pos, size, vx: 8, vy: 0, angle: rand(-.8,.8), phase: rand(0, TAU), seed: i * 2.37 + rand(0, 1) };
    });
    if(this.placement){this.anchor=layoutArtwork(this.placement,width,height,boxes);Object.assign(this.agents[0],this.anchor);}
    this.fronds = []; this.tentacles = [];
    if (this.id === "kelp" || this.id === "grass" || this.id === "willow") this.agents.forEach((a,owner) => {
      const stems = this.id === "grass" ? (small ? 7 : 9) : this.id === "kelp" ? 5 : 9;
      for (let i = 0; i < stems; i++) {
        const q = stems > 1 ? i / (stems - 1) : .5;
        const root = this.id === "willow"
          ? { x: a.x + (q-.5)*a.size*1.35, y: a.y-a.size*.62 + Math.sin(q*Math.PI)*a.size*.15 }
          : { x: a.x + (q-.5)*a.size*(this.id === "grass" ? 1.9 : 1.45), y: a.y+a.size*.8 };
        const length = this.id === "grass" ? a.size*rand(.11,.18) : a.size*rand(.12,.18);
        const down = this.id === "willow";
        this.fronds.push({ root, length, seed: i*.8+owner*2, owner, nodes: makeChain(root.x, root.y, this.id === "grass" ? 9 : 12, length, down ? Math.PI/2 : -Math.PI/2) });
      }
    });
    if (this.id === "jellyfish" || this.id === "octopus") {
      this.tentacles = this.agents.map(a => Array.from({ length: this.id === "octopus" ? 8 : 6 }, (_,i) => {
        const q = i / (this.id === "octopus" ? 7 : 5);
        const root = { x:a.x+(q-.5)*a.size*.95, y:a.y+a.size*.28 };
        return makeChain(root.x, root.y, 15, a.size*.14, Math.PI/2+(q-.5)*1.1);
      }));
    }
    // Settle chains without speeding the independent flight clocks.
    for(let i=0;i<100;i++) this.stepRoots(1/60);
  }

  setBounds(boxes: Box[]) {
    this.boxes = boxes;
    if(this.placement && this.agents.length){
      const pose=layoutArtwork(this.placement,this.width,this.height,boxes);
      if(!this.anchor||Math.abs(pose.x-this.anchor.x)>1||Math.abs(pose.y-this.anchor.y)>1||Math.abs(pose.size-this.anchor.size)>1){this.anchor=pose;Object.assign(this.agents[0],pose);}
    }
  }
  setReduced(value: boolean) { this.reduced = value; }
  move(pointer: Pointer) {
    this.pointer = pointer;
    if (this.id === "octopus" && pointer.speed > 1400 && Math.hypot(pointer.x-this.agents[0]?.x,pointer.y-this.agents[0]?.y)<180 && this.time-this.inkAt>4) this.inkAt=this.time;
  }
  drag(dx: number) { if(this.id === "earth"){this.spin+=dx*.008;this.spinSpeed=clamp(dx*.035,-.6,.6);this.dragging=true;this.draggingTime=this.time;} }
  release() { this.dragging=false; }
  click(x: number, y: number) {
    if(this.pulses.length>=3)this.pulses.shift();this.pulses.push({x,y,born:this.time});
    if(this.id==="willow") {this.leaves=this.leaves.slice(-2);for(let i=0;i<2;i++)this.leaves.push({x:this.agents[0].x+rand(-70,70),y:this.agents[0].y+rand(-60,10),born:this.time,seed:rand(0,TAU)});}
  }

  step(dt: number) {
    if(!Number.isFinite(dt)||dt<=0)return;
    this.time += dt;
    this.pulses = this.pulses.filter(p => this.time-p.born<5);
    this.leaves = this.leaves.filter(p => this.time-p.born<7);
    for(const l of this.leaves){l.x+=Math.sin(this.time+l.seed)*12*dt;l.y+=16*dt;}
    if(!ROOTED.includes(this.id)) this.stepAgents(dt);
    this.stepRoots(dt);
    if(this.id==="earth") {
      if(this.dragging && this.time-this.draggingTime>.15)this.dragging=false;
      if(!this.dragging){this.spinSpeed+=(.055-this.spinSpeed)*dt*.7;this.spin+=this.spinSpeed*dt;}
    }
  }

  private stepAgents(dt: number) {
    const t=this.time, pulse=this.pulses[this.pulses.length-1];
    if(this.anchor){
      const a=this.agents[0],bird=this.id==="birds"||this.id==="butterflies";
      a.x=this.anchor.x+Math.sin(t*.3+a.seed)*(bird?25:5);a.y=this.anchor.y+Math.sin(t*.47+a.seed)*(bird?9:2);
      a.angle=Math.sin(t*.3)*.2;a.phase+=dt*(this.id==="birds"?3.5:2.2);return;
    }
    const center=this.agents.reduce((p,a)=>({x:p.x+a.x/this.agents.length,y:p.y+a.y/this.agents.length}),{x:0,y:0});
    for(const a of this.agents) {
      let speed=this.id==="cars"?27:this.id==="houses"||this.id==="terrain"?10:this.id==="birds"?28:this.id==="shoal"?23:this.id==="rays"?18:this.id==="octopus"?8:15;
      let fx=Math.cos(a.angle+Math.sin(t*.23+a.seed)*.7),fy=Math.sin(a.angle+Math.sin(t*.23+a.seed)*.7);
      if(this.id==="jellyfish") {fx=Math.sin(t*.25+a.seed)*.35;fy=-.6-(.5+.5*Math.sin(t*1.6+a.phase))*.6;speed=8;}
      if(this.id==="birds"||this.id==="shoal") {
        const dx=center.x-a.x,dy=center.y-a.y,d=Math.hypot(dx,dy)||1;
        fx+=dx/d*.45;fy+=dy/d*.45;
        for(const b of this.agents){if(a===b)continue;const x=a.x-b.x,y=a.y-b.y,l=Math.hypot(x,y)||1;if(l<a.size*1.8){fx+=x/l*(1-l/(a.size*1.8))*2;fy+=y/l*(1-l/(a.size*1.8))*2;}}
      }
      if(this.id!=="birds"&&this.id!=="shoal")for(const b of this.agents){
        if(a===b)continue;const dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy)||1,space=(a.size+b.size)*(this.id==="houses"?1.35:1.05);
        if(d<space){const strength=1-d/space;fx+=dx/d*strength*3.5;fy+=dy/d*strength*3.5;const push=this.id==="houses"?35:20;a.x+=dx/d*strength*push*dt;a.y+=dy/d*strength*push*dt;}
      }
      if(pulse && !["birds","jellyfish"].includes(this.id)) {
        const x=pulse.x-a.x,y=pulse.y-a.y,d=Math.hypot(x,y)||1;
        fx+=x/d*1.3;fy+=y/d*1.3;
        if(this.id==="butterflies"&&d<80)speed*=.15;
        if(this.id==="hummingbirds"&&d<100)speed*=.05;
      }
      if(this.id==="dragonflies"||this.id==="hummingbirds") {
        const cycle=(t+a.seed*4)%6;
        speed*=cycle<.7?4:.12;
        if(cycle>=.7){fx=Math.cos(t*2+a.seed)*.1;fy=Math.sin(t*2.3+a.seed)*.1;}
      }
      if(this.pointer.active) {
        const x=a.x-this.pointer.x,y=a.y-this.pointer.y,d=Math.hypot(x,y)||1;
        if(d<150){const scare=this.pointer.speed>900?3:1;const attraction=this.id==="octopus"?-.3:1;fx+=x/d*(1-d/150)*scare*attraction;fy+=y/d*(1-d/150)*scare*attraction;}
      }
      const force=repel(this.boxes,a.x,a.y,a.size*.95+22);
      fx+=force.x*5;fy+=force.y*5;
      const edge=a.size*1.3+28;
      if(a.x<edge)fx+=4*(1-a.x/edge);if(a.x>this.width-edge)fx-=4*(1-(this.width-a.x)/edge);
      if(a.y<90+edge*.55)fy+=3;if(a.y>this.height-edge*.8)fy-=3;
      const desired=Math.atan2(fy,fx);
      a.angle+=angleDelta(a.angle,desired)*Math.min(1,dt*(this.id==="dragonflies"?4:1.1));
      a.vx+=(Math.cos(a.angle)*speed-a.vx)*dt*1.5;a.vy+=(Math.sin(a.angle)*speed-a.vy)*dt*1.5;
      // Extra outward drift acts on the whole body before it can enter the copy.
      a.x+=(a.vx+force.x*35)*dt;a.y+=(a.vy+force.y*35)*dt;
      a.x=clamp(a.x,a.size*1.12+16,this.width-a.size*1.12-16);
      a.y=clamp(a.y,98+a.size*.6,this.height-a.size*.95-18);
      a.phase+=dt*(this.id==="dragonflies"?12:this.id==="hummingbirds"?16:this.id==="birds"?3.5:2.2);
    }
  }

  private stepRoots(dt: number) {
    const p=this.pointer.active?this.pointer:null;
    for(const f of this.fronds) {
      let wind=Math.sin(this.time*.48+f.seed*.3)*28;
      for(const pulse of this.pulses){const age=this.time-pulse.born,d=Math.hypot(pulse.x-f.root.x,pulse.y-f.root.y);wind+=Math.sin(age*3-d*.02)*Math.exp(-age*.7)*90;}
      stepChain(f.nodes,f.root,f.length,dt,this.time,f.seed,this.id==="willow"?40:-55,wind,p);
    }
    this.tentacles.forEach((chains,ai)=>{
      const a=this.agents[ai];if(!a)return;
      chains.forEach((nodes,j)=>{
        const q=j/(chains.length-1),pulse=Math.sin(this.time*1.6+a.phase)*.14+1;
        const root={x:a.x+(q-.5)*a.size*(this.id==="octopus"?.95:1.5*pulse),y:a.y+a.size*.25};
        let wind=Math.sin(this.time*.7+j*.8)*32;
        const target=this.pulses[this.pulses.length-1];
        if(this.id==="octopus"&&target&&j===3)wind+=(target.x-root.x)*.65;
        stepChain(nodes,root,a.size*.14,dt,this.time,j+a.seed,32,wind,null);
      });
    });
  }

  draw(c: CanvasRenderingContext2D) {
    c.save();c.lineCap="round";c.lineJoin="round";
    const t=this.time;
    if(this.id==="kelp"||this.id==="grass"||this.id==="willow")this.drawPlants(c);
    else if(this.id==="waves")for(const a of this.agents)this.drawWaves(c,a);
    else if(this.id==="river")for(const a of this.agents)this.drawRiver(c,a);
    else if(this.id==="aurora")for(const a of this.agents)this.drawAurora(c,a);
    else if(this.id==="earth")for(const a of this.agents)this.drawEarth(c,a);
    else for(let i=0;i<this.agents.length;i++) {
      const a=this.agents[i];c.save();
      if(this.id==="jellyfish"||this.id==="octopus")this.drawTentacles(c,a,i);
      c.translate(a.x,a.y);
      if(this.id==="branch-tree")drawBranchTree(c,a,t,this.disturbance(a.x,a.y)*.03);
      if(this.id==="houses")drawHouse(c,a,t);
      if(this.id==="terrain")drawTerrain(c,a,t);
      if(this.id==="cars")drawCar(c,a,t);
      if(this.id==="trees")drawTree(c,a,t,i,this.disturbance(a.x,a.y)*.04);
      if(this.id==="shoal") {c.rotate(a.angle);this.drawFish(c,a);}
      if(this.id==="rays") {c.rotate(a.angle+Math.PI/2);this.drawRay(c,a);}
      if(this.id==="jellyfish")this.drawBell(c,a);
      if(this.id==="octopus")this.drawOctopus(c,a);
      if(this.id==="birds") {c.rotate(a.angle+Math.PI/2);this.drawBird(c,a);}
      if(this.id==="butterflies") {c.rotate(Math.sin(t*.8+a.seed)*.18);this.drawButterfly(c,a);}
      if(this.id==="dragonflies") {c.rotate(a.angle+Math.PI/2);this.drawDragonfly(c,a);}
      if(this.id==="hummingbirds")this.drawHummingbird(c,a);
      c.restore();
    }
    this.drawPulses(c);c.restore();
  }

  private ellipse(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string,angle=0){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,angle,0,TAU);c.fill();}

  private drawFish(c:CanvasRenderingContext2D,a:Agent) {
    const L=a.size, wave=(s:number)=>Math.sin(a.phase-s*4)*L*.09*s*s;
    c.fillStyle=COLORS.silver;c.beginPath();
    for(let i=0;i<=12;i++){const s=i/12,x=L*.6-s*L,w=Math.sin(Math.PI*Math.min(1,s*1.2))*.17*L*(1-s*.65);const y=wave(s)-w;i?c.lineTo(x,y):c.moveTo(x,y);}
    for(let i=12;i>=0;i--){const s=i/12,x=L*.6-s*L,w=Math.sin(Math.PI*Math.min(1,s*1.2))*.17*L*(1-s*.65);c.lineTo(x,wave(s)+w);}c.fill();
    c.fillStyle=COLORS.water;c.beginPath();c.moveTo(-L*.35,wave(1));c.lineTo(-L*.7,wave(1)-L*.17);c.quadraticCurveTo(-L*.56,wave(1),-L*.7,wave(1)+L*.17);c.closePath();c.fill();
    this.ellipse(c,L*.37,-L*.055,L*.035,L*.035,COLORS.ink);
  }

  private drawRay(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size,w=Math.sin(a.phase)*s*.22;
    const gradient=c.createLinearGradient(-s,-s*.3,s,s*.6);gradient.addColorStop(0,"#c2c7c5");gradient.addColorStop(1,"#687f8b");
    c.fillStyle=gradient;c.beginPath();c.moveTo(0,-s*.48);
    c.bezierCurveTo(-s*.26,-s*.35,-s*.7,-s*.47+w,-s*1.12,-s*.25+w);
    c.bezierCurveTo(-s*.67,s*.19-w*.3,-s*.3,s*.52,0,s*.32);
    c.bezierCurveTo(s*.3,s*.52,s*.67,s*.19+w*.3,s*1.12,-s*.25-w);
    c.bezierCurveTo(s*.7,-s*.47-w,s*.26,-s*.35,0,-s*.48);c.fill();
    c.strokeStyle="#8d9ca4";c.lineWidth=3.5;c.beginPath();c.moveTo(0,s*.22);c.bezierCurveTo(Math.sin(a.phase*.6)*s*.2,s*.6,Math.sin(a.phase*.7)*s*.2,s*.9,Math.sin(a.phase*.8)*s*.3,s*1.2);c.stroke();
    this.ellipse(c,-s*.1,-s*.27,3,3,COLORS.ink);this.ellipse(c,s*.1,-s*.27,3,3,COLORS.ink);
  }

  private drawTentacles(c:CanvasRenderingContext2D,a:Agent,index:number) {
    const color=this.id==="octopus"?"#b68a72":"#b8a4bd";
    for(const nodes of this.tentacles[index]||[]) for(let i=1;i<nodes.length;i++) {
      c.strokeStyle=color;c.lineWidth=this.id==="octopus"?Math.max(2,a.size*.16*(1-i/nodes.length)):Math.max(3.5,6*(1-i/nodes.length*.5));
      c.globalAlpha=.85;c.beginPath();c.moveTo(nodes[i-1].x,nodes[i-1].y);c.lineTo(nodes[i].x,nodes[i].y);c.stroke();
    }c.globalAlpha=1;
  }

  private drawBell(c:CanvasRenderingContext2D,a:Agent) {
    const pulse=.88+.12*Math.sin(this.time*1.6+a.phase),s=a.size;
    c.scale(pulse,1.15-pulse*.2);
    const g=c.createLinearGradient(0,-s,0,s*.4);g.addColorStop(0,"#c9b8c9");g.addColorStop(1,"#887b9c");c.fillStyle=g;
    c.beginPath();c.moveTo(-s*.85,s*.2);c.bezierCurveTo(-s*.9,-s*.85,s*.9,-s*.85,s*.85,s*.2);c.quadraticCurveTo(0,s*.44,-s*.85,s*.2);c.fill();
    c.strokeStyle="#d6c3d3";c.lineWidth=4;c.beginPath();c.ellipse(0,s*.2,s*.82,s*.1,0,0,TAU);c.stroke();
  }

  private drawOctopus(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size*.43,pulse=1+Math.sin(this.time*1.2)*.045;
    this.ellipse(c,0,-s*.2,s*.7*pulse,s,"#c49a7b");
    this.ellipse(c,-s*.35,s*.23,s*.13,s*.16,COLORS.white);this.ellipse(c,s*.35,s*.23,s*.13,s*.16,COLORS.white);
    this.ellipse(c,-s*.35,s*.25,s*.06,s*.1,COLORS.ink);this.ellipse(c,s*.35,s*.25,s*.06,s*.1,COLORS.ink);
    const inkAge=this.time-this.inkAt;
    if(inkAge<3){c.globalAlpha=(1-inkAge/3)*.4;this.ellipse(c,0,s,15+inkAge*20,20+inkAge*25,"#55575b");c.globalAlpha=1;}
  }

  private drawBird(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size,flap=Math.sin(a.phase),span=.72+.28*Math.cos(a.phase);
    c.fillStyle=COLORS.white;c.beginPath();c.moveTo(0,-s*.24);c.quadraticCurveTo(-s*.3,-s*.21-flap*s*.18,-s*span,-s*.5-flap*s*.35);c.quadraticCurveTo(-s*.54,s*.04,0,s*.17);c.quadraticCurveTo(s*.54,s*.04,s*span,-s*.5+flap*s*.35);c.quadraticCurveTo(s*.3,-s*.21+flap*s*.18,0,-s*.24);c.fill();
    this.ellipse(c,0,-s*.18,s*.08,s*.3,"#b7b6ad");c.beginPath();c.moveTo(-s*.04,s*.1);c.lineTo(-s*.19,s*.47);c.lineTo(0,s*.34);c.lineTo(s*.19,s*.47);c.lineTo(s*.04,s*.1);c.fill();
  }

  private drawButterfly(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size,hinge=.18+.82*(.5+.5*Math.cos(a.phase));
    for(const side of [-1,1]) {
      c.save();c.scale(side*hinge,1);this.ellipse(c,s*.38,-s*.2,s*.4,s*.52,"#423d32",-.35);this.ellipse(c,s*.38,-s*.2,s*.31,s*.4,"#ca8e46",-.35);this.ellipse(c,s*.3,s*.32,s*.31,s*.3,"#423d32",.2);this.ellipse(c,s*.3,s*.32,s*.22,s*.21,"#be9958",.2);
      for(let i=0;i<4;i++)this.ellipse(c,s*(.28+i*.085),-s*(.5-i*.08),s*.027,s*.035,COLORS.white);c.restore();
    }
    this.ellipse(c,0,0,4,s*.43,"#807558");c.strokeStyle="#b5a381";c.lineWidth=2;c.beginPath();c.moveTo(0,-s*.32);c.lineTo(-8,-s*.57);c.moveTo(0,-s*.32);c.lineTo(8,-s*.57);c.stroke();
  }

  private drawDragonfly(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size,w=Math.sin(a.phase)*.13;
    for(const side of [-1,1]){this.ellipse(c,side*s*.42,-s*.12,s*.47,s*.085,"#b1c9be",side*(-.27+w));this.ellipse(c,side*s*.38,s*.07,s*.4,s*.075,"#8daaa0",side*(.25-w));}
    this.ellipse(c,0,s*.09,4,s*.62,"#77968a");this.ellipse(c,0,-s*.54,8,7,"#9caf94");
  }

  private drawHummingbird(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size,flap=Math.sin(a.phase),dir=Math.cos(a.angle)>0?1:-1;c.scale(dir,1);
    this.ellipse(c,-s*.1,0,s*.3,s*.14,"#7e9f87",-.2);this.ellipse(c,s*.17,-s*.12,s*.13,s*.13,"#a9b99a");
    c.strokeStyle="#b4bca4";c.lineWidth=3;c.beginPath();c.moveTo(s*.24,-s*.13);c.lineTo(s*.65,-s*.2);c.stroke();
    c.globalAlpha=.6;this.ellipse(c,-s*.15,-s*.22,s*.4,s*.09,"#c2c5b5",-.8+flap*.7);this.ellipse(c,-s*.1,-s*.27,s*.36,s*.07,"#a9b8a8",-1.15-flap*.6);c.globalAlpha=1;
    c.fillStyle="#718b7d";c.beginPath();c.moveTo(-s*.3,s*.02);c.lineTo(-s*.66,s*.28);c.lineTo(-s*.43,-s*.07);c.fill();this.ellipse(c,s*.2,-s*.15,2.8,2.8,COLORS.ink);
  }

  private drawPlants(c:CanvasRenderingContext2D) {
    if(this.id==="willow") this.agents.forEach((a,owner) => {
      c.strokeStyle="#8e795b";c.lineWidth=8;c.beginPath();c.moveTo(a.x+a.size*.23,a.y+a.size*.9);c.bezierCurveTo(a.x+a.size*.2,a.y+a.size*.1,a.x-a.size*.2,a.y-a.size*.6,a.x-a.size*.6,a.y-a.size*.64);c.stroke();
      c.lineWidth=4;for(const f of this.fronds.filter(f=>f.owner===owner)){c.beginPath();c.moveTo(a.x+a.size*.14,a.y+a.size*.1);c.quadraticCurveTo(a.x,a.y-a.size*.7,f.root.x,f.root.y);c.stroke();}
    });
    for(const f of this.fronds) {
      c.strokeStyle=this.id==="willow"?"#8b9c73":this.id==="kelp"?"#718d63":"#8f9b73";c.lineWidth=3.5;
      c.beginPath();f.nodes.forEach((n,i)=>i?c.lineTo(n.x,n.y):c.moveTo(n.x,n.y));c.stroke();
      if(this.id!=="grass")for(let i=2;i<f.nodes.length;i++){const n=f.nodes[i],prev=f.nodes[i-1],angle=Math.atan2(n.y-prev.y,n.x-prev.x),side=i%2?1:-1;this.ellipse(c,n.x+Math.cos(angle+side)*8,n.y+Math.sin(angle+side)*8,this.id==="kelp"?13:8,this.id==="kelp"?4.5:2.7,"#8a9f70",angle+side*.7);}
    }
    for(const l of this.leaves){c.save();c.translate(l.x,l.y);c.rotate(this.time+l.seed);this.ellipse(c,0,0,8,3,"#a3a16c");c.restore();}
  }

  private disturbance(x:number,y:number) {let v=0;for(const p of this.pulses){const age=this.time-p.born,d=Math.hypot(x-p.x,y-p.y);v+=Math.sin(d*.04-age*3)*Math.exp(-age*.65)*18;}return v;}

  private drawWaves(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size*1.35;
    for(let row=0;row<6;row++) {
      c.beginPath();const points:Point[]=[];
      for(let i=0;i<=45;i++){const q=i/45,x=a.x+(q-.5)*s*2,y=a.y+(row-2.5)*15+Math.sin(q*7-this.time*.65+row*.6)*14+Math.sin(q*14+this.time*.35)*6+this.disturbance(x,a.y)*.45;points.push({x,y});i?c.lineTo(x,y):c.moveTo(x,y);}
      const fade=c.createLinearGradient(a.x-s,0,a.x+s,0);fade.addColorStop(0,"#35484300");fade.addColorStop(.22,row%2?"#7d9b9a":"#9fb4ae");fade.addColorStop(.8,row%2?"#7d9b9a":"#9fb4ae");fade.addColorStop(1,"#35484300");c.strokeStyle=fade;c.lineWidth=4+row*.8;c.stroke();
      c.strokeStyle="#c3cbc1";c.lineWidth=2;c.globalAlpha=.42;c.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i%8<3)c.lineTo(p.x,p.y-3);else c.moveTo(p.x,p.y-3);}c.stroke();c.globalAlpha=1;
    }
  }

  private riverPoint(a:Agent,q:number,branch:number):Point {const s=a.size;return{x:a.x+Math.sin(q*6+this.time*.1)*s*.35+Math.sin(q*13+branch)*s*.08+Math.sin(q*Math.PI)*branch*s*.3,y:a.y+(q-.5)*s*2.4};}
  private drawRiver(c:CanvasRenderingContext2D,a:Agent) {
    for(const branch of [-1,0,1]){c.strokeStyle=branch===0?"#88a9aa":"#6e979d";c.lineWidth=branch===0?14:7;c.beginPath();for(let i=0;i<=60;i++){const p=this.riverPoint(a,i/60,branch);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();
      for(let i=0;i<13;i++){const q=(i/13+this.time*.055)%1,p=this.riverPoint(a,q,branch);this.ellipse(c,p.x,p.y,2.5,5,"#c1cebf",Math.sin(q*6)*.3);}
    }
    for(const pulse of this.pulses){const q=(this.time-pulse.born)*.2;if(q>1)continue;for(const branch of [-1,0,1]){const p=this.riverPoint(a,q,branch);this.ellipse(c,p.x,p.y,7,4,"#cfcead");}}
  }

  private drawAurora(c:CanvasRenderingContext2D,a:Agent) {
    const s=a.size*1.45;
    for(let layer=0;layer<3;layer++) {
      for(let i=0;i<65;i++) {
        const q=i/64,x=a.x+(q-.5)*s*2;
        const pointer=this.pointer.active?Math.exp(-Math.abs(x-this.pointer.x)/80)*Math.sin(this.time)*14:0;
        const y=a.y+Math.sin(q*7+this.time*.32+layer*.5)*27+Math.sin(q*15-this.time*.5)*9+layer*16+pointer+this.disturbance(x,a.y)*.3;
        const height=35+Math.sin(q*10+this.time*.3)*16;
        const alpha=Math.sin(q*Math.PI)*(.28+.2*Math.sin(q*13-this.time+layer));
        const g=c.createLinearGradient(x,y-height,x,y+10);g.addColorStop(0,"#8aabaf00");g.addColorStop(.75,layer===1?"#b0a1bc":"#8fbea7");g.addColorStop(1,"#58787c00");c.globalAlpha=Math.max(0,alpha);c.strokeStyle=g;c.lineWidth=5;c.beginPath();c.moveTo(x,y-height);c.lineTo(x,y+10);c.stroke();
      }
    }c.globalAlpha=1;
  }

  private drawEarth(c:CanvasRenderingContext2D,a:Agent) {
    const r=a.size,step=Math.max(4,r/30),spin=this.spin+a.seed*.12;
    c.save();c.beginPath();c.arc(a.x,a.y,r,0,TAU);c.clip();
    for(let y=-r;y<r;y+=step)for(let x=-r;x<r;x+=step) {
      const nx=(x+step*.5)/r,ny=(y+step*.5)/r,d=nx*nx+ny*ny;
      if(d>=1)continue;
      const nz=Math.sqrt(1-d),latitude=Math.asin(-ny),longitude=Math.atan2(nx,nz)-spin;
      const isLand=landAt(longitude,latitude);
      const light=Math.max(0,-nx*.48-ny*.3+nz*.82);
      const shade=Math.min(19,Math.floor((.08+.92*light)*19));
      const cloud=Math.sin(longitude*3+latitude*5+this.time*.035)+Math.cos(longitude*8-latitude*3-this.time*.025)>1.72;
      c.fillStyle=cloud?EARTH_COLORS.cloud[shade]:isLand?EARTH_COLORS.land[shade]:EARTH_COLORS.sea[shade];
      c.fillRect(a.x+x,a.y+y,step+.4,step+.4);
    }
    c.restore();
  }

  private drawPulses(c:CanvasRenderingContext2D) {
    if(this.reduced)return;
    for(const p of this.pulses){const age=this.time-p.born;if(age>3)continue;c.save();c.globalAlpha=(1-age/3)*.32;c.strokeStyle="#c0b996";c.lineWidth=2;c.setLineDash([3,10]);c.beginPath();c.ellipse(p.x,p.y,8+age*30,5+age*20,0,0,TAU);c.stroke();c.restore();}
  }
}
