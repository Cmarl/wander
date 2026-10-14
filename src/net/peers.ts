import * as THREE from "three";
import { makeCharacter, makeVehicle, type Character, type Vehicle } from "../game/models";
import { DynamicShadow } from "../world/shadows";
import { heightAt } from "../world/field";
import type { Net, Peer } from "./net";

/**
 * Remote players, drawn with the same models the local player uses.
 *
 * Only the nearest few get a body — each figure plus truck is a few dozen draw
 * calls, and sixteen of them would cost more than the landscape. Everyone else
 * is still tracked and still shows on the HUD count; they just aren't rendered
 * until you're near enough to make them out.
 */

const VISIBLE_LIMIT = 6;
const VISIBLE_RANGE = 420;

function nameSprite(text: string): THREE.Sprite {
  const pad = 12;
  const font = "600 30px ui-rounded, system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 48;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(10,14,20,0.55)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 14);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.userData.aspect = w / h;
  sprite.renderOrder = 30;
  return sprite;
}

interface Body {
  group: THREE.Group;
  character: Character;
  vehicle: Vehicle;
  shadow: DynamicShadow;
  label: THREE.Sprite;
}

export class PeerBodies {
  readonly group = new THREE.Group();
  private bodies = new Map<number, Body>();
  private scratch = { x: 0, y: 0, z: 0, h: 0 };

  remove(id: number) {
    const b = this.bodies.get(id);
    if (!b) return;
    this.group.remove(b.group);
    this.bodies.delete(id);
  }

  private create(peer: Peer): Body {
    const group = new THREE.Group();
    const character = makeCharacter();
    const vehicle = makeVehicle(peer.colour);
    const shadow = new DynamicShadow(1.5, 2.6);
    const label = nameSprite(peer.name);
    group.add(character.root, vehicle.root, shadow.mesh, label);
    this.group.add(group);
    const body: Body = { group, character, vehicle, shadow, label };
    this.bodies.set(peer.id, body);
    return body;
  }

  update(dt: number, net: Net, camera: THREE.Camera) {
    // Nearest-first, so the bodies we do draw are the ones you can actually see.
    const ranked: { peer: Peer; d2: number }[] = [];
    for (const peer of net.peers.values()) {
      const dx = peer.next.x - camera.position.x;
      const dz = peer.next.z - camera.position.z;
      ranked.push({ peer, d2: dx * dx + dz * dz });
    }
    ranked.sort((a, b) => a.d2 - b.d2);

    const keep = new Set<number>();
    for (let i = 0; i < ranked.length && keep.size < VISIBLE_LIMIT; i++) {
      if (ranked[i].d2 > VISIBLE_RANGE * VISIBLE_RANGE) break;
      keep.add(ranked[i].peer.id);
    }
    for (const id of [...this.bodies.keys()]) if (!keep.has(id)) this.remove(id);

    for (const { peer } of ranked) {
      if (!keep.has(peer.id)) continue;
      const body = this.bodies.get(peer.id) ?? this.create(peer);

      net.sample(peer, this.scratch);
      const { x, y, z, h } = this.scratch;
      const driving = peer.next.driving;

      body.character.root.visible = !driving;
      body.vehicle.root.visible = driving;

      if (driving) {
        body.vehicle.root.position.set(x, y, z);
        body.vehicle.root.rotation.set(0, h, 0);
        body.vehicle.animate(dt, peer.next.speed, 0);
      } else {
        body.character.root.position.set(x, y, z);
        body.character.root.rotation.set(0, h, 0);
        body.character.animate(dt, peer.next.speed, false);
      }

      const ground = heightAt(x, z);
      body.shadow.update(x, z, ground, h, Math.max(0, y - ground));

      // Constant on-screen size, so a distant name is still readable.
      const dist = camera.position.distanceTo(body.label.position.set(x, y + (driving ? 3.1 : 2.3), z));
      const s = THREE.MathUtils.clamp(dist * 0.035, 0.5, 6);
      body.label.scale.set(s * (body.label.userData.aspect as number), s, 1);
      body.label.visible = dist < VISIBLE_RANGE;
    }
  }
}
