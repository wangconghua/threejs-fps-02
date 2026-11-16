# DUSTLINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/wangconghua/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/wangconghua/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in three.js, Counter-Strike-style and fully original: five Vanguard defenders hold the desert freight yard **Ember Yard** against five Ember attackers carrying a charge. Win the round by eliminating the other team, or by planting / defusing the charge. Earn money each round and spend it in the buy menu — rifles, a DMR, a shotgun, an SMG, kevlar and frag grenades. Gunfire rewards stopping to aim: recoil and spread punish firing on the move, headshots deal 4× damage, and bots follow lane routes, hold angles, rotate to gunfire and react to what they see and hear.

Single-player against bots. Static files, no build step, no network request at runtime: three.js 0.187.0 is vendored, all sounds are synthesised with WebAudio, and the map, art and names are original.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Or serve `game/` with any static file server and open `index.html` in desktop Chrome. Click to play: `WASD` move, mouse look, click fire, right-click aim down sights, `R` reload, `Shift` walk slow, `Ctrl` crouch, `Space` jump, `B` buy menu, `G` throw a grenade, `E` hold to defuse the charge, `1`/`2` switch weapons, `M` mute.

First to 5 rounds takes the match (max 9 rounds). Screenshots in `screenshots/` are deterministic captures: `?shot=menu|mid|site|win&seed=N`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8max8wdd&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
