import { type Box, clamp } from "./koi/world";
import type { MotionSceneId } from "./scenes";

export type CompositionId = "home" | "manifesto" | "capabilities" | "notes" | "explore" | "atlas" | "place" | "vision" | "monitor" | "pricing";
export type ArtworkPlacement = { scene: MotionSceneId; anchor: "earth-right" | "tree-bottom-left" | "right" | "upper-right" | "at"; scale: number; /** Fractions of the canvas: centre x, centre y, and size relative to its shorter side. */ at?: { x: number; y: number; size: number } };
export const COMPOSITIONS: Record<CompositionId, ArtworkPlacement[]> = {
  home: [ { scene: "earth", anchor: "earth-right", scale: 1 }, { scene: "branch-tree", anchor: "tree-bottom-left", scale: 1 } ],
  manifesto: [{ scene: "aurora", anchor: "right", scale: .95 }],
  capabilities: [{ scene: "houses", anchor: "right", scale: 1.05 }],
  notes: [{ scene: "birds", anchor: "right", scale: .8 }],
  explore: [{ scene: "cars", anchor: "upper-right", scale: .78 }],
  atlas: [{ scene: "waves", anchor: "upper-right", scale: .9 }],
  place: [{ scene: "butterflies", anchor: "upper-right", scale: .65 }],
  vision: [{ scene: "cars", anchor: "upper-right", scale: .7 }],
  monitor: [{ scene: "waves", anchor: "upper-right", scale: .75 }],
  pricing: [{ scene: "birds", anchor: "upper-right", scale: .6 }],
};

/** Keep the editorial pair close to the copy on wide screens. When the side
 * gutters narrow, reserve the upper-right and lower-left spaces instead. */
export function layoutArtwork(placement: ArtworkPlacement, width: number, height: number, boxes: Box[]) {
  if (placement.at) return { x: placement.at.x * width, y: placement.at.y * height, size: placement.at.size * Math.min(width, height) * placement.scale };
  const main = boxes.filter(b => b.right-b.left < width*.96 && b.bottom > 120 && b.top < height-80)
    .sort((a,b) => (b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  const top = main?.top ?? height*.35, bottom = main?.bottom ?? height*.65;
  const left = main?.left ?? width*.28, right = main?.right ?? width*.72;
  const navBottom = Math.max(88,...boxes.filter(b=>b.top<40 && b.right-b.left>width*.8).map(b=>b.bottom));
  if(placement.anchor === "earth-right") {
    const side = width-right;
    if(side>=160) {
      const size=Math.min(164,(side-48)/2);
      return {x:right+24+size,y:clamp(height*.43,navBottom+size+12,height-size-35),size};
    }
    // Narrow screens: sit in the bottom-right corner, opposite the tree,
    // instead of crowding the header above the copy.
    const size=clamp((height-bottom-34)/2,34,62);
    return {x:width-size-22,y:height-size-24,size};
  }
  if(placement.anchor === "tree-bottom-left") {
    if(left>=160) {
      const size=Math.min(150,(left-45)/1.9);
      return {x:clamp(width*.18,size+22,left-size*.8-18),y:height-42,size};
    }
    const size=clamp((height-bottom-52)/1.9,55,105);
    return {x:Math.max(size*.9+18,width*.23),y:height-25,size};
  }
  if(placement.anchor === "upper-right") {
    const size=clamp(width*.065,32,88)*placement.scale;
    return {x:width-size*1.2-45,y:navBottom+size*.75+18,size};
  }
  const side=width-right;
  if(side>=160) {
    const size=Math.min(120,(side-55)/2)*placement.scale;
    return {x:right+(side*.52),y:height*.5,size};
  }
  const size=clamp((top-navBottom-30)/2,28,68)*placement.scale;
  return {x:width-size*1.3-28,y:Math.max(navBottom+size+10,top-size-18),size};
}
