# Spectacular finds

> *"I'm thinking we will want more spectacular things to find still. Almost like breath of the wild levels of amazing. abandond castle, single scyscraper you can walk up a winding staircase to the top, etc. real cool big finds that make the game rewarding. I still haven't located a settlement, is there a way or trick?"* — Clyde

Read-only. Nothing here is built.

---

## 0. The settlement question first, because it is measurable and the answer is not "look harder"

You cannot find settlements because **they are physically invisible until you are almost on top of one.**

A hamlet's tallest object is the water tower, about 11 m. Two independent limits hide it:

| | |
|---|---|
| **Angular size** — a 11 m tower is 3 screen pixels at **3.0 km**, and one pixel at 9 km | |
| **Haze** — `FogExp2` at the current density leaves 10% contrast at 15 km, 1.8% at 20 km, nothing at 24 km | |

So a settlement announces itself inside roughly **3 km**, on a grid whose nearest neighbour is a median **27 km**. You have to pass within a ninth of the spacing to ever see one. That is not rarity by design, that is a thing you find by accident or not at all.

Following tracks helps a little, but tracks fade at 1.5 km by design, so they are a hint underfoot rather than a route.

**Recommendation, and it is small:** give settlements one deliberately tall marker — a grain silo or a church spire at 35–45 m — drawn further out than the rest. At 40 m a marker is 3 px at 11 km and a clear shape at 5 km. That turns "I have never seen one" into "there is something over there", which is the whole game.

This matters beyond settlements, so it gets its own section.

---

## 1. The one rule: a spectacular find must be seen before it is reached

BotW's trick is not that the thing is big when you arrive. It is that you saw it an hour earlier from a hill and decided to go.

A surprise is a nice moment. **A destination is a session.** Everything below is designed around being visible from far enough away to become a plan.

The measurements that constrain this:

```
object height      screen pixels at 25 km
      30 m                1.0        (current landmarks — invisible)
      80 m                2.7
     150 m                5.0
     250 m                8.3
```

And the haze, which is the harder limit:

```
  5 km   0.78  clearly visible
 15 km   0.10  a silhouette
 20 km   0.02  barely a smudge
 24 km   0.003 gone
```

**Two things follow, and they are the real engineering content of this document:**

1. **Monuments must be 150 m+.** Below about 120 m nothing is visible far enough away to be a destination, however rare it is. This sets the scale of the whole list — these are an order of magnitude bigger than a fire lookout, not twice as big.

2. **Monuments need to cut the haze.** At the current fog density a 30 km silhouette is mathematically impossible — it would need roughly half the density. The honest options are (a) halve global fog, which changes the look of everything, or (b) render monuments with reduced fog so they hang on the horizon the way real distant mountains do while near country keeps its atmosphere. **I recommend (b)**, applied subtly — a monument should read as *far away*, not as cut out and pasted on.

Without this, every idea below is a thing you bump into.

---

## 2. Rarity: how special is special

Current spacing, for calibration:

| | grid | effective median spacing |
|---|---|---|
| Landmarks | 2.2 km | ~2.2 km |
| Steadings | on the landmark grid, 6.6% of places | ~5 km |
| Settlements | 16 km | ~27 km |
| Strays | 3.4 km | ~4.4 km |

**Monuments should be rarer than settlements by a wide margin.** My recommendation: a **110 km grid at ~35% occupancy**, giving a median nearest-monument of roughly **150–200 km**.

What that means in play:

- On foot or in the truck (48 m/s), you would cross one every few hours — genuinely rare.
- In the plane (150 m/s = 540 km/h), one every 20–25 minutes of flying. **The plane is the monument-hunting vehicle**, which is a good reason for the plane to exist and gives aviation a purpose beyond speed.
- One per *region* (48 km cells) would be far too common — you would meet several an hour on the ground and the word spectacular would stop applying.

**They should not be unique-per-world.** A thing you can only ever see once is a thing most players never see. Rarity plus visibility beats uniqueness: if a castle appears every ~170 km and you can see it from 25 km, it is effectively unique in any session, and two players in the same world can tell each other where one is.

---

## 3. The monuments

Ranked by impact per unit of effort, not by how cool they sound.

| # | Find | Effort | Silhouette | Payoff | Why it earns the slot |
|---|---|---|---|---|---|
| 1 | **The Wind Farm** | S–M | Dozens of 180 m turbines, turning | Drive among them; the scale only lands from underneath | The spin code already exists on the windpump. Cheapest enormous thing available. |
| 2 | **The Lighthouse** | M | 60 m tower on a sea cliff | Climb to the lamp; **the beam sweeps at night and is visible for 30 km** | The single best beacon in the list. At night it is a navigation aid, not just a view. |
| 3 | **The Dam** | M | 200 m concrete wall plugging a valley | Walk the crest with the drop on one side and water on the other | Best silhouette per unit of work, and it finally gives the new water system something to be *about*. |
| 4 | **The Tower** | L | A single 180 m skyscraper alone on a plain | **Winding staircase to the roof**, floors you can walk out onto, the vista | Clyde asked for it by name, and the walkable-platform work landed last week. |
| 5 | **The Castle** | L | Curtain wall, keep, four corner towers on a crag | Courtyard, great hall interior, climbable keep, the wall walk | Clyde asked for it by name. The richest arrival on the list and the most work. |
| 6 | **The Radio Telescope** | M | A 120 m dish cradled in a bowl of hills | Stand in the dish; tune it for a rumour from much further away than a mast gives | Unmistakable, and it plugs straight into the rumour system with a longer reach. |
| 7 | **The Great Bridge** | M–L | A span across a gorge or a strait | **Drive across** — the only place wheels cross water | Now that water stops vehicles, a bridge is a genuine traversal gift, not scenery. |
| 8 | **The Crashed Airliner** | M | A broken fuselage ploughed into a hillside | Walk the cabin interior; the tail section separate, further up the slope | Eerie, human, and the shipwreck kit is most of the geometry already. |
| 9 | **The Statue** | S–M | A 70 m figure, half sunk or half finished | Climb to the shoulder | One large mesh. Cheap, and the silhouette asks a question nothing answers. |
| 10 | **The Cathedral Ruin** | M | Roofless nave, columns, a standing rose window | An interior open to the sky; light through the window at the right hour | A **conditional find**: the window only throws colour at a particular time of day. |
| 11 | **The Quarry** | M | A terraced pit with a flooded floor | Drive the terraces down; swim at the bottom | Negative space at scale, which nothing else here does. |

### The five worth detailing

**The Tower** — what Clyde actually asked for. A single skyscraper, 180 m, standing alone where there is no city, which is the whole hook. The payoff is the climb: a winding staircase around a central core, open floors every 4 m you can step out onto, and a roof you walk out onto at the top. The ascent should take a couple of minutes — long enough that the view at the top is *earned*, short enough that it is not a chore. **Critically it must be a real staircase**: 0.17 m risers, 0.28 m treads, 1.1 m wide. At 180 m that is roughly 1,050 steps, which is fine as instanced geometry and is the entire point — Clyde's "ladder for giants" note applies tenfold here. A spiral of giant slabs would wreck it.

**The Castle** — curtain wall with a gate you drive through, a courtyard, corner towers, and a keep you climb. Several of the interior and platform systems already exist (one-room interiors, walkable decks, the inside camera). The variation lever is condition: intact, part-ruined, or a shell with trees growing in the courtyard.

**The Dam** — 200 m of concrete across a valley, water held on one side, a sheer drop and a dry riverbed on the other. You walk or drive the crest. Spectacular for very little geometry — it is essentially one enormous curved slab plus detail — and it is the most legible shape in the list at distance.

**The Lighthouse** — on a cliff above the sea, which the shoreline placement already knows how to find. Climb the spiral to the lamp room. **The beam is the feature**: a slowly rotating shaft visible from 30 km at night, which makes it the only landmark that tells you where it is *after dark*. That is worth more than its height.

**The Wind Farm** — twenty to forty turbines at 180 m, turning at slightly different rates, spread over a few kilometres. Almost free: the windpump already spins per-instance with hashed rate and phase. The payoff is not an action, it is driving underneath something enormous and quiet.

---

## 4. Proportion, which is now a standing rule

From Clyde's directive, and from the fire lookout rebuild that proved it:

> **Size geometry off a person, and let the instance scale provide "bigger".**

A fixed-size detail on a scaling object is wrong at every scale but one. Concretely, for everything above:

| Element | Human-correct |
|---|---|
| Stair riser / tread | 0.17 m / 0.28 m |
| Staircase width | 1.0–1.2 m |
| Ladder rung spacing | 0.29 m |
| Doorway | 0.9 × 2.1 m |
| Railing height | 1.0–1.1 m |
| Floor-to-floor | 3.5–4.0 m |
| Window sill above floor | 0.9 m |

A 180 m tower is 45 floors. That number should come *out* of the floor height, not be chosen and then divided. Every monument should be checked the way the lookout now is: ten proportions, each against a range a human body actually needs.

---

## 5. The payoff, and the FOUND treatment

Arriving at a monument should not produce the same toast as spotting a hot spring.

- **A discovery event with weight.** Big type, a beat of held time, the name of the thing. This is the pending "bigger FOUND text" work — monuments are the reason it matters.
- **Its own sound.** Low, long, singular. Distinct from every other find.
- **A postcard prompt.** You reached something worth photographing; offer it.
- **A register entry that reads differently** — monuments listed apart from ordinary finds in the journal, because they are not the same category of thing.
- **A badge per monument type**, so the register slowly records which of the eleven you have met without ever showing you the eleven.

**One anti-goal:** no collection UI. Never show "4 of 11". The register may list what you found; it must never list what you have not.

---

## 6. How they tie into what exists

- **Regions** — monument type should be biased by region character. Lighthouses on coasts, dams in heights, wind farms on flats, castles on crags. The region fields already exist and already drive terrain.
- **Rumours** — the strongest existing hook. A mast should sometimes name a *monument* rather than a neighbouring landmark, with its real bearing and distance. That turns a rumour into an expedition and directly answers "is there a trick to finding things". The radio telescope does this at longer range.
- **Ways** — a track near a monument should be more likely, because people went there. Follow the track.
- **Postcards and `?at=`** — a monument coordinate is a shareable link. "Go to this" already works.
- **The map** — monuments should appear on the journal map once seen, as the only marker large enough to navigate by.
- **The plane** — monument hunting is the reason to fly. No change needed; it falls out of the rarity maths.

---

## 7. What I would build, in order

| # | Thing | Effort | Why now |
|---|---|---|---|
| 1 | **Far visibility** (reduced-haze monument layer + tall settlement marker) | M | Nothing below works without it, and it fixes the settlement complaint on its own. |
| 2 | **The Wind Farm** | S–M | Proves the rarity and visibility model with almost no new geometry. |
| 3 | **The Lighthouse** | M | Adds the night beacon, which is the best single payoff available. |
| 4 | **The Dam** | M | Biggest silhouette for the work; gives water a purpose. |
| 5 | **Discovery events** | M | Already queued; monuments are what it is for. |
| 6 | **The Tower** | L | What he asked for, once the staircase can be done properly. |
| 7 | **The Castle** | L | The richest, and the one most likely to need two passes. |

Steps 1–3 are the real milestone: at that point the horizon has things on it that you choose to go to.

---

## 8. Anti-goals

- **No monument is a dungeon.** No enemies, no puzzles, no locked anything. The reward for arriving is arriving.
- **No fail states, still.** A 180 m staircase must not be a place you fall off and lose something.
- **No fast travel to monuments.** Reaching one is the content.
- **Not too many kinds.** Eleven is already more than needed. Five done properly beats eleven done at lookout quality.
- **Never show what is missing.** No counters, no silhouettes of undiscovered things.

---

## Q: for Clyde

**Q1 — Rarity.** I recommend a 110 km grid giving one monument every ~150–200 km: hours apart on the ground, about 20 minutes apart by plane. Rarer than that and most sessions have none. **Recommend: 110 km.** Agree, or do you want them more common early on so you actually meet a few?

**Q2 — The haze.** Monuments cannot be seen from 25 km at the current fog density. I recommend giving *monuments only* reduced fog so they hang on the horizon, rather than thinning fog everywhere and changing how the whole world looks. **Recommend: monuments only.** Or would you rather the whole world got clearer?

**Q3 — Settlements.** My measured answer to your question is that they are invisible past ~3 km, and the fix is a tall far-drawn marker (silo or spire, 35–45 m) rather than making settlements more common. **Recommend: add the marker, leave the rarity alone.** Agree?

**Q4 — Where to start.** I would do visibility, then the wind farm, then the lighthouse — cheap things that prove the model — before the tower and the castle you actually asked for. **Recommend: that order.** Or would you rather I went straight at the Tower and accepted it taking longer?

**Q5 — Interiors.** The castle and the tower imply multi-level interiors, which is more than the current one-room system does. I would build the tower's staircase as stacked walkable platforms (the system that landed last week) rather than as true interior spaces. **Recommend: stacked platforms, no new interior tech.** Or is a proper explorable interior worth the extra work to you?
