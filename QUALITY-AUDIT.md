# Wander — gameplay quality audit

Read-only pass. No code was changed to produce this; the three probes under
`tools/node/audit-*.mts` drive the real `Player`, the real world function and
the real landmark tables, and report what they find.

**The headline:** the game's core loop — see a shape on the horizon, steer
toward it, find out what it is — is sound in design and broken in practice,
because **almost nothing in the world is visible from far enough away to steer
toward.** Everything else in this document is smaller than that.

---

## How this was measured, and what it cannot see

Measured by playing: a simulated player walks and drives real terrain for
simulated hours. Numbers below are from those runs unless marked otherwise.

What this **cannot** judge, and where Clyde's eye is the only instrument:
feel of the controls, whether the audio is pleasant, whether a landmark looks
good, frame rate on the S25. Anything in those areas is flagged as such.

One confound to declare: the autopilot that steers a truck toward a target is
crude, and the truck's poor showing in §2 is partly mine. The walking numbers
have no such excuse.

---

## Findings, ranked by impact

### 1. You cannot see the world's contents — CRITICAL

A landmark needs roughly 4 px of height to register as a shape worth turning
toward, and about 12 px to be recognisable. At 1080p and a 70° field of view:

| Landmark | Height | Recognisable to | A dot to |
|---|---|---|---|
| Radio Mast | 34 m | 2.5 km | 7.5 km |
| Fire Lookout | 26 m | 1.9 km | 5.7 km |
| Stone Arch | 22 m | 1.6 km | 4.9 km |
| Windpump | 14 m | 1.0 km | 3.1 km |
| **Airstrip** | 9 m | **0.7 km** | 2.0 km |
| **Settlement** | ~7 m | **0.5 km** | 1.5 km |
| Standing Stones | 6 m | 0.4 km | 1.3 km |
| **Boat Landing** | 3 m | **0.2 km** | 0.7 km |
| Hot Spring | 1.5 m | 0.1 km | 0.3 km |

Landmarks sit a median **1.93 km** apart. So from a typical spot, **the only
things you could possibly see are the mast, the lookout and the arch** — three
of eighteen kinds. The other fifteen are found by walking over them.

Measured end to end: a player that steers at the nearest thing it could
plausibly see found **one landmark in ten minutes of walking**. Over three
different regions, five of six ten-minute runs found zero or one.

**What to do.** Three options, in increasing order of how much they change the
game:

- **Make the small things taller or add a marker to them.** A boat landing
  with a 9 m pole and a flag is visible at 700 m instead of 200. Cheap, and it
  is what real landings have.
- **Give a region a visible "tell".** Something 30–40 m that says *there is
  something in this valley* without saying what — a smoke column, a flock of
  birds circling, a track that gets more worn as it converges. Preserves the
  mystery and fixes the range problem.
- **Raise the density near where you already are.** Not globally — the empty
  country is the product — but a gentle bias so the next thing is more often
  within sight of the last.

### 2. The two best things in the game are the two rarest — CRITICAL

Clyde's two most enthusiastic messages were about an airstrip ("COOL!") and a
boat landing. These are, by a wide margin, the rarest landmarks:

| | One every |
|---|---|
| Airstrip | **66.5 km** |
| Boat Landing | **76.8 km** |
| Settlement | **62.7 km** |
| Stone Arch (commonest) | 15.8 km |

And they are the **gateways to the aircraft and the boat**. A player who never
finds an airstrip never flies. Given §1 — an airstrip is invisible past 700 m —
the expected time to a first flight is very large.

**What to do.** Raise airstrip and landing frequency to roughly the arch's
(one per ~16–20 km), or guarantee one within some radius of the spawn. The
anti-goals forbid markers you did not place, but they do not forbid the world
being more generous with its best content.

### 3. The rumour system is gated behind the things nobody finds — HIGH

Clyde, unprompted: *"I located something in the menu 'heard about today'
(COOL) that I can pin — I LOVE THAT, it drives discovery."*

Rumours come from exactly two sources: tuning a radio mast, or a hamlet's
noticeboard. Masts occur once per 17.2 km; settlements once per 62.7 km. So
the mechanic he singled out as the thing that drives discovery **cannot fire
until he has already solved the discovery problem by other means.**

A rumour points somewhere a median 20.5 km away, which is a good distance — it
is a journey, not an errand. The content is right. The tap is in the wrong
place.

**What to do.** Add a third source that is available from the first minute.
The truck radio is the obvious one — tune it while driving and pick up a
fragment. It fits the fiction, needs no new geometry, and turns the loop on
immediately.

### 4. Settlements are nearly unfindable, specifically — HIGH

One per **62.7 km**, 4–9 buildings, tallest around 7 m, so visible as a shape
at **500 m**. Only **8% have anything tall within 1.2 km** to spot them by.

This is the exact question Clyde asked: *"I still haven't located a
settlement, is there a way or trick?"* The honest answer measured out as: no,
there is no trick, and you are unlikely to find one by accident.

**What to do.** Pair every settlement with something tall — a mast, a water
tower, a church-like roof, a smoke column at dawn. The `COMPANIONS` table in
`world/landmarks.ts` already does exactly this for other kinds; settlements
are not in it.

### 5. The middle gradient is a crawl, and steep ground throws you — MEDIUM

Walking speed by gradient:

| Ground | Speed | Over 12 s |
|---|---|---|
| Flat (0–0.10) | 24.5 km/h | climbed 13 m |
| Gentle (0.10–0.25) | 20.6 km/h | climbed 5 m |
| **A climb (0.25–0.45)** | **6.6 km/h** | climbed 23 m |
| Steep (0.45–0.70) | 29.3 km/h | **descended 157 m** |
| A wall (0.70+) | 29.3 km/h | **descended 121 m** |

Two separate things. The middle band drops you to a quarter speed — a cliff in
the curve rather than a slope, and it is the gradient most hillsides actually
are. And above 0.45 you do not climb at all; you slide down fast.

**What to do.** Soften the 0.25–0.45 falloff so a hillside is a cost rather
than a wall, and decide deliberately what very steep ground should do.
Sliding is a legitimate answer — it is even fun — but it should read as
sliding, with the camera and audio saying so, rather than as the controls
failing.

### 6. The chopper never reaches its own top speed — MEDIUM

Full throttle for 40 seconds, flat ground:

| | Top speed | Reached 90% | Settled at |
|---|---|---|---|
| Plane | 540 km/h | 13.0 s | 556 km/h |
| Bike | 223 km/h | 2.7 s | 221 km/h |
| Truck | 173 km/h | 2.9 s | 180 km/h |
| **Chopper** | **151 km/h** | **never** | **118 km/h** |
| Van | 144 km/h | 3.7 s | 121 km/h |
| Tractor | 76 km/h | 1.9 s | 78 km/h |

The chopper tops out at 78% of its stated figure and the van at 84%. Either
the numbers are aspirational or something is bleeding speed. The others all
land within a few percent.

### 7. Everything on land is very fast — MEDIUM, and a judgement call

A truck at **180 km/h** crosses the median gap between landmarks in 38
seconds. A person runs at **24.5 km/h** — a world-class sprint, held forever,
now that RUN is always on.

This is not a bug; Clyde asked for both. But it interacts badly with §1: the
faster you move, the more of the world passes outside the ~500 m band in which
anything is visible. **Speed and visibility are the same problem seen twice.**
If the visibility work lands, this stops mattering. If it does not, slowing
down would help and would be the wrong fix.

### 8. Region names are coarse — LOW

27 distinct names across the sampled map, with the commonest ("The Broken
Crags") covering **12.6%** of it. One name in eight is the same name. For a
game whose journal is a list of places, that weakens the record.

---

## What I would do, in order

1. **Make the small landmarks visible** — a pole on a landing, a mast on a
   settlement, something tall at an airstrip. Biggest effect per line of code,
   and it unblocks findings 1, 2, 3 and 4 at once.
2. **Put a radio in the truck** so rumours start working in the first minute.
3. **Raise airstrip and landing frequency** to roughly one per 20 km.
4. **Pair settlements with something tall**, via the existing `COMPANIONS`
   table.
5. **Soften the 0.25–0.45 walking falloff** and make steep-ground sliding
   deliberate.
6. **Fix the chopper and van top speeds**, or correct the numbers.
7. **Widen the region name space** — more flavour words, or a second axis.
8. *(Only if 1–4 do not land)* reconsider land speeds.

Items 1–4 are one coherent piece of work: **make the world legible from a
distance.** I would do them together and judge the result before touching
anything else.

---

## Q: for Clyde

**Q1. Visibility — how far should "I can see something over there" reach?**
My recommendation: make everything visible as a shape from at least 1.5 km,
by giving the short things something tall. The alternative is to leave the
world sparse and lean harder on rumours and the compass. *I recommend the
first — the silhouette-on-the-horizon moment is the best thing the game has,
and most kinds currently cannot produce it.*

**Q2. Should the best content be rarer or commoner?** Airstrips and landings
are the rarest things in the world and the two you were most excited to find.
Rarity is part of why they landed — but at one per 66 km most players never
see one. *I recommend one per ~20 km: still special, actually reachable.*

**Q3. Should the truck have a radio?** It would make "heard about today" work
from the first minute instead of after you find a mast or a hamlet. *I
recommend yes.* The risk is that it makes rumours feel like a feed rather than
something overheard — I would keep it to one fragment per in-game day.

**Q4. What should very steep ground do?** Right now you cannot climb above a
0.45 gradient and you slide down fast, which reads as the controls failing. *I
recommend making it deliberate* — a scramble that visibly costs you, with the
camera and audio selling the slide — rather than either blocking it or
smoothing it away.

**Q5. Is 180 km/h the truck you want?** It is enormous fun and it is in
tension with seeing anything. *I recommend leaving it alone and fixing
visibility instead* — but if after that the world still feels like it is
flying past, the honest lever is the speed, not the scenery.
