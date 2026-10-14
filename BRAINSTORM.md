# Wander — game feel brainstorm

Making it addictive, relaxing, a pleasure, and more interactive.

Status: thinking only. Nothing here is built. Multiplayer is parked.

---

## 1. An honest read of where it is

Wander is a beautiful place with almost nothing to do in it.

The complete list of things a player can currently do: walk, run, jump, get in
the truck, get out of the truck, crash into a tree, mute the audio. That is five
verbs, and **not one of them changes the world**. You can drive for an hour and
leave the map in exactly the state you found it.

That is the whole problem, and it's worth being blunt about it, because it means
the fix is not "more polish". The landscape, the light, the haze, the audio —
those are doing their job. What's missing is the other half of the sentence: the
world is gorgeous *at* you, never *with* you.

Two consequences follow, and they're the two halves of Clyde's ask:

- **Not addictive** — there is nothing on the horizon worth steering toward, so
  a session ends when the novelty of the scenery does. Roughly five minutes.
- **Not interactive** — nothing responds, nothing accumulates, nothing remembers
  you were there.

Everything below is in service of those two, without ever reaching for the
levers that usually fix them in other games (threat, timers, scarcity), because
those would cost us the thing that's already working.

---

## 2. The design spine

Three commitments. Everything else is downstream of these, and anything that
contradicts one should be cut even if it's fun in isolation.

### The world is a pure function. Lean on it, don't fight it.

Terrain, biomes and props are `f(seed, x, z)`. Nothing is stored, and every
client generates a byte-identical world. That is not just an implementation
detail — it is a **design superpower that most open-world games would kill for**:

- Any amount of content can be placed by hashing coordinates. A thousand
  landmarks cost the same as one: zero bytes, zero streaming, zero load time.
- A coordinate is a shareable address. "Go to 41200, −8800" works for everyone,
  forever, with no server. Screenshots become links.
- The flip side: **anything the player changes has to be stored**, and storage
  is the only thing that isn't free. So player traces must be rationed and
  designed deliberately, not sprinkled everywhere.

### Reward noticing, not achieving.

The pleasure on offer is the pleasure of looking at something. A points economy
competes with that — the moment there's a number going up, the player optimises
and stops looking out of the window. So:

- Rewards are **sensory or memorial**: a view, a sound, an entry in a journal,
  an image you can keep.
- Progression is a **record of where you've been**, never a power curve.
- Nothing is ever gated behind a grind, because there's nothing to grind.

### Tension is allowed. Anxiety is not.

Relaxing does not mean inert — a game with no stakes at all is a screensaver.
The distinction that matters:

- **Good tension is self-imposed and optional**: weather closing in while you're
  still two ridges from the overlook you wanted to photograph. You chose that.
- **Bad tension is systemic and imposed**: a hunger bar, a timer, a fail state, a
  thing chasing you. Never.

The test for any mechanic: *if the player puts the phone down mid-session, does
anything bad happen?* If yes, cut it.

---

## 3. The three loops

### Moment to moment (seconds) — "this feels good"

Cresting a rise at speed and seeing the land open out. This mostly works
already, and the gap is **reactivity**: the truck moves *through* the world
rather than *interacting* with it. Grass doesn't part, wheels don't throw dust,
nothing startles. Section 4.2 is entirely about this, and it's the cheapest
pleasure-per-hour-of-work on the list.

### Session (10–30 min) — "one more ridge"

Needs a destination. The engine of a session is: **see something unexplained on
the horizon → decide to go → the drive → arrival pays off**. Wander currently
has an extraordinary setup for this and no payoff: the haze already resolves
distant shapes gradually over kilometres, which is *exactly* the mechanism a
curiosity hook needs. There is just nothing out there to resolve into.

Landmarks (4.1) are the single highest-value thing on this list for that reason.

### Day to day (weeks) — "I'll have another look tomorrow"

Needs something that is different tomorrow and can't be rushed today. Two cheap
ones: a **journal** that accumulates (4.6) and a **sky seeded by the real date**
(4.10). Neither can be grinded, both reward returning, both cost almost nothing.

---

## 4. Mechanisms

Named, concrete, with effort and a note on why it doesn't break the calm.

### 4.1 Landmarks — `M`

Hash a coarse grid (~1.5 km cells); some cells get a landmark, its type chosen
by biome, altitude and water proximity. Each has a **silhouette legible from
kilometres away**, so it reads through the haze as a question mark.

A starting set, each with a different reason to approach:

| Landmark | The hook | Arrival payoff |
|---|---|---|
| Fire lookout tower | Vertical line on a ridge | Climbable → the best vista in the region |
| Stone arch | Impossible shape | Drive *through* it |
| Shipwreck | Wrong object, wrong place | Shelter; salvage a cosmetic |
| Hot spring | Steam plume visible for miles | Sound + warmth; a camp spot |
| Radio mast | Blinking red light at night | Unlocks a radio station (4.7) |
| Lone tree on a bald ridge | Pure silhouette | Nothing. Just the view. Sometimes that's right |
| Abandoned truck | A peer that didn't make it | Cosmetic part for yours |
| Meteor crater | A hole in the terrain function | Rare minerals for the journal |

**Why it hooks:** it converts the existing haze-reveal into a 3–8 minute goal
with a payoff at the end. This is the classic loop and it works because it's
*self-selected* — you pick the shape you're curious about.

**Why it stays relaxing:** no markers on screen unless you pin one yourself, no
completion percentage, no "you have discovered 7/412". You find them or you
don't.

**Note:** a few landmarks should be deliberately unrewarding. If every one pays
out, approaching them becomes farming. The lone tree is the whole point.

### 4.2 Wake — the world reacting — `S`–`M`

The highest feel-per-effort on this list, by a distance.

- **Grass displacement** (`M`) — keep a short ring buffer of recent truck
  positions, pass it to the grass shader as a uniform array; blades within
  radius bend away from the wheels and spring back over ~2 s. The grass is
  already GPU-placed, so this is a shader change, not a system.
- **Wheel spray** (`S`) — instanced particles from the contact points, colour
  sampled from the terrain palette so it's automatically correct in every biome:
  ochre dust on steppe, powder on snow, water sheets at the shore, nothing on
  wet rock. Density by speed and surface.
- **Flushed birds** (`S`) — drive through tall grass and a handful of birds burst
  up and glide away. Pure theatre. Enormously effective.
- **Tracks** (`M`) — tyre tracks in snow and sand that persist for the session.
- **Cosmetic dents** (`S`) — crashes mark the bodywork. No damage model, no
  repair, no penalty. Just a record of your driving on the truck itself.

**Why it hooks:** it's the difference between a backdrop and a place. It also
rewards *speed and recklessness* with spectacle rather than punishment, which is
exactly the right incentive for a relaxing driving game.

### 4.3 Glassing & Pins — `S`

Hold a button to raise binoculars: ~5× zoom, a subtle hand-steadiness wobble, a
vignette. While glassing, any landmark in range shows a faint marker; tap to
**pin** it. A pinned thing becomes a soft chevron on the existing compass with a
distance readout. Two or three pins maximum.

**Why it hooks:** it turns *looking* into a verb, and converts "huh, what's that"
into a committed intention. It's the hinge between the moment-to-moment loop and
the session loop, and it's small.

**Why it stays relaxing:** the player creates every marker. The game never puts
one on screen uninvited.

### 4.4 Postcards — photo mode — `S`–`M`

Hide the HUD, free the camera within a short radius, scrub the time of day
(`[` / `]` already does this), export a PNG stamped with coordinates, biome and
in-game time.

**This is the best idea on the list for reasons specific to Wander.** Because the
world is a pure function, those coordinates are a **teleport link**:
`clydemarl.me/wander?at=41200,-8800`. A screenshot isn't a picture of the game,
it's an *address in it*. Someone sees Clyde's sunset, taps the link, and is
standing in the same spot under the same sky.

For a 136 KB browser game with no marketing budget, shareable images that link
back into themselves are the entire distribution strategy. It also gives players
a reason to stop and *compose* a view, which is the most relaxing thing a game
can ask someone to do.

### 4.5 Camp — `M`

Hold a button while stopped: the character gets out, lights a fire, the camera
settles into a slow orbit, ambience ducks, the fire takes over the mix. Options
to **rest until dawn / dusk**, with the sky running in time-lapse — nearly free,
since the sky is already analytic and driven by one scalar.

**Why it hooks:** sessions need an ending that feels like a choice rather than a
quit. Camping is a *punctuation mark*. It's also the single most on-theme
feature available: the whole fantasy is overlanding, and overlanding is mostly
about where you stop.

Camping at a landmark should be slightly better than camping at random — a
different fire sound, a journal entry. Gentle incentive, no requirement.

### 4.6 Field Journal — `M`

Collecting *sightings*, not objects. Auto-stamps an entry when you reach a
landmark, enter a biome for the first time, crest 2,000 m, catch a rare sky, or
roll past a distance milestone. Each entry is a small generated thumbnail plus
coordinates and the real date.

**Why it hooks:** it's the day-to-day loop. It accumulates without being
grindable, and it's a *memory* rather than an inventory — re-reading it is the
pleasure, not completing it.

**Why it stays relaxing:** no completion count, no empty slots implying failure.
A journal with gaps is a journal, not a checklist.

### 4.7 Drift — generative music — `M`

A slow pad layer whose chord shifts every ~40 s, drawn from a mode chosen by
biome (open fourths and lydian brightness on the steppe, aeolian for tundra,
something warmer in forest). Sparse melodic motifs trigger on events: cresting a
ridge, sunrise, arriving somewhere. Low-pass it as speed rises so wind takes
over; duck it almost entirely at camp and let the fire carry.

The existing Web Audio engine already does everything needed. **Risk:** purely
procedural music drifts into aimless. Mitigate with a small hand-authored table
of chord progressions and motifs rather than fully random selection — the
structure should be authored, only the sequencing generative.

The radio masts (4.1) could unlock "stations" — really just different mood
presets — giving a reason to collect something that changes the feel rather than
the stats.

### 4.8 Mobile ergonomics — `S`–`M`

This is a mobile-first game and currently it's driven with two thumbs like a
desktop port.

- **One-thumb drive** — auto-throttle toggle ("cruise"), steer only. Transforms
  phone play.
- **Haptics** — `navigator.vibrate` on crash, surface change, landmark discovery.
  Nearly free, hugely felt.
- **Portrait support** — a phone game you can play one-handed on a sofa is a
  different product from one that demands landscape.
- Bigger safe areas; nothing important within a thumb's reach of the edges.

### 4.9 Wildlife — `L`

Herds that graze, lift their heads as you approach, and scatter. Deer on the
steppe, ibex on scree, seabirds at the shore, hares in scrub. Instanced, with
boids-lite flocking.

Expensive, which is why it's ranked below the others — but it is the thing that
most makes a world feel *inhabited* rather than *generated*, and it pairs with
glassing (4.3) beautifully: binoculars exist to watch animals.

### 4.10 Today's Sky — `S`

Seed cloud cover, haze density and rare events (aurora, blood sunset, sea fog)
from the **real calendar date**. Everyone sees the same sky today; tomorrow's is
different and cannot be rushed.

**Why it hooks:** a return reason that costs nothing, can't be grinded, and is
shared — "did you see it today" works because it's literally the same sky.

### 4.11 Odometer & cosmetics — `S`–`M`

Distance travelled is already tracked and displayed. Make it the spine of
progression: paint, roof cargo, light bars, a dog in the passenger seat, all
unlocked by kilometres and discoveries. **Purely cosmetic, never gating.**

**Why it hooks:** it accrues from simply playing, which respects a five-minute
session. Nothing is ever locked behind an activity you don't enjoy.

### 4.12 Small toys — `S` each

Underrated. "Pleasure" is often just this.

Headlights (the truck already has an unused light bar) · horn · skipping stones
at the shore · a cairn you can add a stone to · wipers in rain · a kicked
football in the bed of the truck.

---

## 5. What I'd build, in order

Ordered so each stage makes the previous one better. The sequence is:
**a reason to go → pleasure in going → choosing where → capturing it → stopping
→ remembering → mood → reach.**

| # | Thing | Effort | Why this one now |
|---|---|---|---|
| 1 | **Landmarks** (4.1) | M | Nothing else matters while there's no reason to steer anywhere. Unlocks the session loop single-handedly. |
| 2 | **Wake** (4.2) | S–M | Cheapest felt improvement available. Makes the driving between landmarks worth the time. |
| 3 | **Glassing & Pins** (4.3) | S | Small, and it's the hinge that turns a distant shape into a decision. Needs 1 to exist. |
| 4 | **Postcards** (4.4) | S–M | The share loop, and it's uniquely powerful here because coordinates are addresses. Also the distribution strategy. |
| 5 | **Camp** (4.5) | M | Gives sessions an ending. The most on-theme and most relaxing feature on the list. |
| 6 | **Field Journal** (4.6) | M | Converts a good session into a reason to come back. Needs 1 and 5 to have content. |
| 7 | **Drift** (4.7) | M | The jump from "tech demo" to "a place". Deferred only because it's invisible without somewhere to go. |
| 8 | **Mobile ergonomics** (4.8) | S–M | Could justifiably be #1 on a mobile-first game. Here because it widens the door rather than furnishing the room. |

Then: Today's Sky, odometer cosmetics, small toys, wildlife.

**Stages 1–4 are the real milestone.** That combination is a complete, shippable
game: you see something, you decide to go, the drive is a pleasure, you arrive,
you photograph it, you send the link to someone. Everything after that is depth.

---

## 6. Anti-goals

Worth writing down, because every one of these is a standard answer to "make it
more addictive" and every one would wreck what's already working.

- **No quest markers you didn't place.** The player chooses what's interesting.
- **No XP, levels, or numbers going up** beyond the odometer.
- **No timers, no fail states, no death.** Putting the phone down mid-session
  must never cost anything.
- **No enemies.** Not even passive ones.
- **No daily-login streaks.** Obligation is the opposite of relaxing — "today's
  sky is different" is a *reason* to return; a broken streak is a punishment.
- **No loud UI.** The HUD is good because it's nearly absent. Protect that.
- **Don't fill the silence.** Empty country between landmarks is the product, not
  dead air. Resist the urge to put something in every valley.

---

## 7. The bridge back to multiplayer

Not now, but worth designing toward, because it's cheap and it fits.

The expensive part of multiplayer is world state — and Wander has none. A few
kilobytes per world could store **player traces**: cairns people built,
signposts they carved, camp spots, the wrecks of trucks that rolled. You'd
rarely meet anyone, but you'd constantly find evidence that someone was here.
That's the Death Stranding move, it costs almost nothing on the free tier, and
it's a far better fit for a calm game than live co-op.

Design implication for now: when building cairns, camps and tracks, **store them
as a list of coordinates from day one**, even in local storage. That makes them
shareable later for free.

---

## Q:

**Q: How long is a target session?** This sets landmark density and therefore the
whole pacing. A mountain is currently ~20 minutes away by truck, which is a
desktop-evening number, not a phone number.
*Recommendation: design for 10–15 minutes — roughly one landmark every 2–3 km,
3–5 minutes of driving between them. Tune the truck's speed to that, not the
other way round.*

**Q: Any soft pressure at all, or zero?** Fuel and cold were in the original
sketch. They add texture and planning, and they are the single most likely thing
to turn "relaxing" into "chores".
*Recommendation: zero by default. Build the calm version first, and if it feels
weightless later, add an optional "Expedition" toggle rather than changing the
default.*

**Q: Do we break the zero-asset rule for music?** Everything is synthesised today
and the whole game is 136 KB. A few minutes of recorded music would be 1–3 MB —
roughly 20× the current download, though still small in absolute terms.
*Recommendation: stay fully procedural for the first pass. The constraint is
genuinely part of the charm, and generative music keyed to biome and time of day
is more interesting than a loop. Revisit only if it feels thin in practice.*

**Q: Should discovery sync across devices?** Journal and unlocks in `localStorage`
means starting over on your phone. Cloud save means accounts, auth and a real
cost.
*Recommendation: local only for now, but make the save a small JSON blob with an
export/import — a copyable code is 95% of the benefit for 2% of the work, and it
keeps hosting at $0.*

**Q: Solo-first, or design everything for shared traces from the start?** This
changes landmark design — whether a cairn is yours or everyone's.
*Recommendation: solo-first, but store every player-made mark as coordinates
from day one (section 7), so turning traces on later is a server change rather
than a rewrite.*
