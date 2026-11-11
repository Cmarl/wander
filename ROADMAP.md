# Wander — things deferred on purpose

Not a backlog of everything; just the decisions where "not now" was the answer
and the reasoning is worth keeping.

## Native app

Clyde, 2026-10-15: *"Maybe we need to build it native once we get the game
tighter"* — raised alongside the phone-landscape work, where browser chrome
was eating about a fifth of the screen.

**Not now, and the web version has not run out of road yet.** Fullscreen plus
the landscape layout recovers most of what native would buy on screen real
estate. The queue still has engine audio, skydive, landmark actions, discovery
events and gamepad in it, and all of those are worth more than a wrapper.

When it is time, in order of least to most work:

- **Add to Home Screen** — already possible. The standalone meta tags are set,
  so installing it from the browser menu already drops the chrome on Android
  and iOS. This is free and worth telling Clyde about before anything else.
- **TWA (Trusted Web Activity)** — the same bundle in a Play Store shell. No
  code changes, real app icon, no chrome. The obvious first step if he wants
  it on a home screen as an app.
- **Capacitor** — the same bundle plus native APIs if we ever need them
  (gamepad rumble, file system, background audio).
- **A real native port** — only if the web platform becomes the limit, which
  it is not. The game is one 700 KB bundle of generated geometry and audio;
  nothing in it is fighting the browser.

The thing that would actually change this calculus is sustained performance on
a mid-range phone, not features.

## Boats and docks

Half of the water request. Needs a floating vehicle class, shoreline
placement, and a dock structure. The spec already carries a `floats` flag and
the waterline check already defers to it, so a boat crosses water the moment
the class exists.

## The landmark proportions pass

The fire lookout was rebuilt to human scale and measured. The other fourteen
kinds have not been. The mast and the windpump are the likely next offenders —
both tall things sized by eye.

## More monuments

Five kinds shipped: the tower, the castle, the lighthouse, the wind farm and
the colossus. The brainstorm listed eleven. Left out on purpose:

- **The dam** and **the great bridge** need the terrain to cooperate — a
  valley to plug, a strait to span — and finding one by hashing is a search
  problem of its own. Worth doing; not the same afternoon.
- **Interiors.** Every monument is climbed on the outside or through an open
  frame, because the chase camera has nowhere to go inside a closed stair.
  A keep you walk into needs an inside camera first.
- **Sight lines.** Measured: the nearest monument is in line of sight from
  about one random spot in four (`tools/node/monument-sight.mts`). The country
  is hilly and that is most of the reason. The radio and the binoculars cover
  the rest, but if it still feels like they are hidden, the lever is siting
  them higher or making them taller, not making them commoner.
