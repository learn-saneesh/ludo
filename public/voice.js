// Voice chat: WebRTC mesh between the humans in a room, signaled over the
// game WebSocket ({t:'rtc', to, data} relayed by the server with `from`).
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let sendFn = () => {};
let onChange = () => {};
let mySeat = null;
let joined = false;
let micOn = true;
let stream = null;
const peers = new Map(); // seat -> { pc, audio }

export function setupVoice(send, changed) {
  sendFn = send;
  onChange = changed;
  window.addEventListener('beforeunload', leaveVoice);
}

export function setVoiceSeat(seat) {
  mySeat = seat;
}

export function voiceState() {
  return { joined, micOn, peers: [...peers.keys()], supported: !!navigator.mediaDevices?.getUserMedia };
}

export async function joinVoice() {
  if (joined) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  joined = true;
  micOn = true;
  sendFn({ t: 'rtc', to: null, data: { type: 'join' } });
  onChange();
}

export function leaveVoice() {
  if (!joined) return;
  sendFn({ t: 'rtc', to: null, data: { type: 'leave' } });
  for (const seat of [...peers.keys()]) closePeer(seat);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  joined = false;
  onChange();
}

export function toggleMic() {
  micOn = !micOn;
  stream?.getAudioTracks().forEach((t) => { t.enabled = micOn; });
  onChange();
  return micOn;
}

export async function handleRtc(from, data) {
  if (!joined) return;
  switch (data.type) {
    case 'join':
      // Greet the newcomer; the lower seat makes the offer to avoid glare.
      sendFn({ t: 'rtc', to: from, data: { type: 'hello' } });
      if (mySeat < from) makeOffer(from);
      break;
    case 'hello':
      if (mySeat < from && !peers.has(from)) makeOffer(from);
      break;
    case 'offer': {
      const pc = pcFor(from);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendFn({ t: 'rtc', to: from, data: { type: 'answer', sdp: pc.localDescription } });
      break;
    }
    case 'answer':
      await peers.get(from)?.pc.setRemoteDescription(data.sdp);
      break;
    case 'ice':
      await peers.get(from)?.pc.addIceCandidate(data.candidate).catch(() => {});
      break;
    case 'leave':
      closePeer(from);
      break;
  }
}

async function makeOffer(seat) {
  const pc = pcFor(seat);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendFn({ t: 'rtc', to: seat, data: { type: 'offer', sdp: pc.localDescription } });
}

function pcFor(seat) {
  if (peers.has(seat)) return peers.get(seat).pc;
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const audio = new Audio();
  audio.autoplay = true;
  peers.set(seat, { pc, audio });

  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };
  pc.onicecandidate = (e) => {
    if (e.candidate) sendFn({ t: 'rtc', to: seat, data: { type: 'ice', candidate: e.candidate } });
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(seat);
    else onChange();
  };
  onChange();
  return pc;
}

function closePeer(seat) {
  const peer = peers.get(seat);
  if (!peer) return;
  peer.pc.close();
  peer.audio.srcObject = null;
  peers.delete(seat);
  onChange();
}
