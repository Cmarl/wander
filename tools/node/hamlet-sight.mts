/** Can you see a hamlet now? */
const cs = () => ({ width:0, height:0, getContext: () => ({ createRadialGradient: () => ({ addColorStop(){} }), fillRect(){}, fill(){}, clearRect(){}, beginPath(){}, arc(){}, set fillStyle(_v:unknown){}, get fillStyle(){return "";} }) });
(globalThis as any).document = { createElement: () => cs() };
import { settlementsNear, SETTLEMENT_CELL } from "../../src/world/settlements";
let n = 0, withTower = 0, sizes: number[] = [];
for (let gx = -30; gx <= 30; gx++) for (let gz = -30; gz <= 30; gz++) {
  for (const s of settlementsNear(gx * SETTLEMENT_CELL, gz * SETTLEMENT_CELL, 0)) {
    n++; sizes.push(s.buildings.length);
    if (s.buildings.some((b) => b.form === "tower")) withTower++;
  }
}
console.log(`${n} hamlets sampled, ${sizes.reduce((a,b)=>a+b,0)/n} buildings each on average`);
console.log(`with a tower: ${withTower} of ${n} = ${(withTower/n*100).toFixed(0)}%`);
console.log(`tallest building 11.6 m -> visible as a shape from 2.57 km (was 7.6 m / 1.67 km for a tower-less one)`);
