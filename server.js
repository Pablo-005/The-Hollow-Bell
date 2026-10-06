
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const ROLE_DEFS = {
  alpha: {name:"The Alpha", faction:"Beasts", ability:"Mark of the Beast", desc:"Once per game, mark a player. Their next investigation reports HUMAN.", team:"beast"},
  howler: {name:"The Howler", faction:"Beasts", ability:"Howl", desc:"Once per game, reveal a set of three players to everyone; exactly one is a Beast.", team:"beast"},
  constable: {name:"The Constable", faction:"Village", ability:"Investigate", desc:"Each night, investigate one living player: HUMAN, BEAST, or UNKNOWN.", team:"village"},
  bellkeeper: {name:"The Bellkeeper", faction:"Village", ability:"Listen", desc:"Each night, learn whether one living player performed a night action.", team:"village"},
  undertaker: {name:"The Undertaker", faction:"Village", ability:"Examine", desc:"After a death, learn the victim's last night action.", team:"village"},
  confessor: {name:"The Confessor", faction:"Village", ability:"Confession", desc:"Once per game, force a player to answer whether they are a Beast. You receive a confidence hint.", team:"village"},
  raven: {name:"The Raven Keeper", faction:"Village", ability:"Whisper", desc:"Each night, send an anonymous short message to one living player.", team:"village"},
  gravedigger: {name:"The Gravedigger", faction:"Village", ability:"Open the Grave", desc:"Once per game, inspect one dead player's faction, role, last action, visitor, or cause of death.", team:"village"},
  penitent: {name:"The Penitent", faction:"Independent", ability:"False Conviction", desc:"Win if the village executes you.", team:"independent"},
  heretic: {name:"The Heretic", faction:"Independent", ability:"Two Trials", desc:"Win if exactly two players are executed by the village.", team:"independent"}
};

const ROLE_POOLS = {
  6:["alpha","constable","bellkeeper","undertaker","confessor","penitent"],
  7:["alpha","howler","constable","bellkeeper","undertaker","raven","penitent"],
  8:["alpha","howler","constable","bellkeeper","undertaker","confessor","raven","penitent"],
  9:["alpha","howler","constable","bellkeeper","undertaker","confessor","raven","gravedigger","penitent"],
  10:["alpha","howler","constable","bellkeeper","undertaker","confessor","raven","gravedigger","penitent","heretic"],
  11:["alpha","howler","constable","bellkeeper","undertaker","confessor","raven","gravedigger","penitent","heretic","constable"],
  12:["alpha","howler","constable","bellkeeper","undertaker","confessor","raven","gravedigger","penitent","heretic","undertaker","raven"]
};

function code(){ return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function alive(room){ return [...room.players.values()].filter(p=>p.alive); }
function publicState(room){
  return {
    phase:room.phase, day:room.day, endsAt:room.endsAt, hostId:room.hostId,
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,rolePublic:p.alive?null:ROLE_DEFS[p.role]?.name})),
    log:room.log.slice(-30), evidence:room.evidence.slice(-20),
    votes:room.phase==="vote" ? Object.fromEntries([...room.votes.entries()].map(([id,v])=>[id,v])) : {},
    winner:room.winner || null
  };
}
function emitRoom(room){
  io.to(room.code).emit("state", publicState(room));
  for (const p of room.players.values()) {
    io.to(p.id).emit("privateRole", p.role ? {
      role:p.role, roleName:ROLE_DEFS[p.role].name, faction:ROLE_DEFS[p.role].faction,
      ability:ROLE_DEFS[p.role].ability, desc:ROLE_DEFS[p.role].desc, objective:p.secretObjective
    } : null);
  }
}
function addLog(room, text){ room.log.push({t:Date.now(), text}); }
function shuffle(a){ return [...a].sort(()=>Math.random()-0.5); }

function setupRoles(room){
  const ids=[...room.players.keys()];
  const pool=(ROLE_POOLS[ids.length]||ROLE_POOLS[8]).slice();
  while(pool.length<ids.length) pool.push("constable");
  const roles=shuffle(pool).slice(0,ids.length);
  // Guarantee at least two beasts by converting a role if necessary.
  let beastCount=roles.filter(r=>ROLE_DEFS[r].team==="beast").length;
  while(beastCount<2){
    const i=roles.findIndex(r=>ROLE_DEFS[r].team!=="beast" && r!=="penitent");
    if(i<0) break;
    roles[i]="howler"; beastCount++;
  }
  ids.forEach((id,i)=>{
    const p=room.players.get(id); p.role=roles[i]; p.alive=true; p.used={}; p.secretObjective=secretObjective(p.role);
  });
}
function secretObjective(role){
  if(role==="penitent") return "Get yourself executed by the village.";
  if(role==="heretic") return "Cause exactly two village executions.";
  if(role==="alpha") return "Keep at least one Beast alive through the final trial.";
  if(role==="howler") return "Cause an innocent player to be executed.";
  return "Survive and help your faction complete its objective.";
}
function startNight(room){
  room.phase="night"; room.day++;
  room.endsAt=Date.now()+45000; room.nightActions=new Map();
  addLog(room,`Night ${room.day} falls. The bell rings once.`);
  emitRoom(room);
  setTimeout(()=>resolveNight(room),46000);
}
function resolveNight(room){
  if(room.phase!=="night") return;
  const actions=room.nightActions;
  const beasts=alive(room).filter(p=>ROLE_DEFS[p.role].team==="beast");

  // Resolve investigative actions privately before the public dawn report.
  for (const [actorId, a] of actions.entries()) {
    const actor=room.players.get(actorId);
    if (!actor || !actor.alive) continue;
    if (a.type==="investigate") {
      const target=room.players.get(a.target);
      if (!target) continue;
      let result = ROLE_DEFS[target.role].team==="beast" ? "BEAST" : "HUMAN";
      if (room.marked===target.id) result="HUMAN";
      if (["penitent","heretic"].includes(target.role)) result="UNKNOWN";
      io.to(actor.id).emit("privateMsg",{text:`Constable report: ${target.name} appears to be ${result}.`});
    }
    if (a.type==="listen") {
      const target=room.players.get(a.target);
      if (!target) continue;
      const active=actions.has(target.id);
      io.to(actor.id).emit("privateMsg",{text:`Bellkeeper report: ${target.name} was ${active?"ACTIVE":"QUIET"} during the night.`});
    }
  }

  const attacks=[...actions.values()].filter(a=>a.type==="attack").map(a=>a.target).filter(Boolean);
  let victimId=attacks.length?attacks[Math.floor(Math.random()*attacks.length)]:null;
  if(victimId && room.players.get(victimId)?.alive){
    room.players.get(victimId).alive=false;
    const victim=room.players.get(victimId);
    room.lastDeath={victim:victimId, role:victim.role, lastAction:actions.get(victimId)?.type||"none", visitor:null, cause:"werewolf attack"};
    room.evidence.push(`Night ${room.day}: an attack occurred at ${victim.name}'s home. Footprints lead toward the forest.`);
    addLog(room,`${victim.name} was found dead at dawn.`);
  } else {
    room.evidence.push(`Night ${room.day}: no body was found, but someone was active after midnight.`);
    addLog(room,"Dawn arrives. No body was found.");
  }
  checkEnd(room);
  if(!room.winner){ room.phase="day"; room.endsAt=Date.now()+60000; addLog(room,"Day begins. Discuss the evidence and decide whom to trust."); emitRoom(room); setTimeout(()=>startVote(room),61000); }
  else emitRoom(room);
}
function startVote(room){
  if(room.phase!=="day" || room.winner) return;
  room.phase="vote"; room.endsAt=Date.now()+30000; room.votes=new Map();
  addLog(room,"The Puritan Trial begins. Everyone votes for one living player.");
  emitRoom(room);
  setTimeout(()=>resolveVote(room),31000);
}
function resolveVote(room){
  if(room.phase!=="vote" || room.winner) return;
  const counts={}; for(const v of room.votes.values()) if(v) counts[v]=(counts[v]||0)+1;
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  if(!sorted.length){ addLog(room,"No conviction. The village hesitates."); startNight(room); return; }
  const top=sorted[0], tie=sorted[1]&&sorted[1][1]===top[1];
  if(tie){ addLog(room,"The vote is tied. No one is executed."); startNight(room); return; }
  const target=room.players.get(top[0]); if(target) target.alive=false;
  room.executions=(room.executions||0)+1;
  addLog(room,`${target.name} was convicted by the village.`);
  if(target.role==="penitent") room.winner={team:"Penitent",reason:"The Penitent was executed."};
  else if(target.role==="heretic" && room.executions===2) room.winner={team:"Heretic",reason:"Exactly two players were executed."};
  checkEnd(room);
  if(!room.winner) startNight(room); else emitRoom(room);
}
function checkEnd(room){
  const a=alive(room), beasts=a.filter(p=>ROLE_DEFS[p.role].team==="beast").length, non= a.length-beasts;
  if(beasts===0) room.winner={team:"Village",reason:"Every werewolf has been eliminated."};
  else if(beasts>=non) room.winner={team:"Beasts",reason:"The Beasts now equal or outnumber everyone else."};
  else if(a.length<=1) room.winner={team:"Beasts",reason:"The village can no longer stop the hunt."};
}

io.on("connection",socket=>{
  socket.on("create",({name})=>{
    const n=String(name||"Player").trim().slice(0,18);
    const c=code(); const room={code:c,hostId:socket.id,players:new Map(),phase:"lobby",day:0,endsAt:0,log:[],evidence:[],votes:new Map(),executions:0};
    room.players.set(socket.id,{id:socket.id,name:n,alive:true,role:null,used:{}});
    rooms.set(c,room); socket.join(c); socket.data.room=c; socket.emit("room",c); emitRoom(room);
  });
  socket.on("join",({code,name})=>{
    const room=rooms.get(String(code||"").toUpperCase()); if(!room) return socket.emit("errorMsg","Room not found.");
    if(room.phase!=="lobby") return socket.emit("errorMsg","That game has already started.");
    if(room.players.size>=12) return socket.emit("errorMsg","Room is full.");
    const n=String(name||"Player").trim().slice(0,18);
    room.players.set(socket.id,{id:socket.id,name:n,alive:true,role:null,used:{}});
    socket.join(room.code); socket.data.room=room.code; socket.emit("room",room.code); addLog(room,`${n} joined the settlement.`); emitRoom(room);
  });
  socket.on("start",()=>{
    const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.id||room.players.size<2) return;
    setupRoles(room); room.phase="night"; room.day=1; room.endsAt=Date.now()+45000; room.nightActions=new Map();
    addLog(room,"The settlement is sealed. The first night begins."); emitRoom(room);
    setTimeout(()=>resolveNight(room),46000);
  });
  socket.on("action",(a)=>{
    const room=rooms.get(socket.data.room), p=room?.players.get(socket.id); if(!room||!p||!p.alive) return;
    if(room.phase==="night"){
      if(a.type==="attack" && ROLE_DEFS[p.role].team==="beast") room.nightActions.set(socket.id,{type:"attack",target:a.target});
      else if(a.type==="investigate" && p.role==="constable") room.nightActions.set(socket.id,{type:"investigate",target:a.target});
      else if(a.type==="listen" && p.role==="bellkeeper") room.nightActions.set(socket.id,{type:"listen",target:a.target});
      else if(a.type==="whisper" && p.role==="raven" && !p.used.whisper) { p.used.whisper=true; const target=room.players.get(a.target); if(target) io.to(target.id).emit("privateMsg",{text:`A raven whispers: ${String(a.message||"").slice(0,120)}`}); addLog(room,`${p.name}'s raven disappears into the night.`); }
      else if(a.type==="mark" && p.role==="alpha" && !p.used.mark){ p.used.mark=true; room.marked=a.target; addLog(room,`${p.name} has left a mysterious mark.`); }
      else if(a.type==="howl" && p.role==="howler" && !p.used.howl){
        p.used.howl=true; const candidates=shuffle(alive(room)).slice(0,3); const names=candidates.map(x=>x.name).join(", ");
        addLog(room,`THE HOWL: The Beast is among ${names}.`);
      }
    }
    emitRoom(room);
  });
  socket.on("vote",({target})=>{
    const room=rooms.get(socket.data.room), p=room?.players.get(socket.id); if(!room||room.phase!=="vote"||!p?.alive) return;
    room.votes.set(socket.id,target); emitRoom(room);
  });
  socket.on("chat",({text})=>{
    const room=rooms.get(socket.data.room), p=room?.players.get(socket.id); if(!room||!p) return;
    const msg=String(text||"").trim().slice(0,240); if(!msg) return;
    io.to(room.code).emit("chat",{name:p.name,text:msg});
  });
  socket.on("disconnect",()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    const p=room.players.get(socket.id); if(p) addLog(room,`${p.name} disconnected.`);
    room.players.delete(socket.id);
    if(room.hostId===socket.id) room.hostId=room.players.keys().next().value;
    if(room.players.size===0) rooms.delete(room.code); else emitRoom(room);
  });
});

app.get("/health",(req,res)=>res.json({ok:true,rooms:rooms.size}));
server.listen(PORT,()=>console.log(`The Hollow Bell running on port ${PORT}`));
