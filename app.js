/*
  TabStream - minimal two-person tab sharing demo.
  Before use, paste your Supabase project URL and anon/publishable key below.
  Create a Supabase project and enable Realtime on the project.
*/
const SUPABASE_URL = "https://apeypusuvcxzplkpiepz.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_Bd2oP-jSmRlgVQB-MNbdmA_hAQN_VCC";

const $ = (id) => document.getElementById(id);
const createButton = $("createButton");
const joinButton = $("joinButton");
const createStatus = $("createStatus");
const joinStatus = $("joinStatus");
const roomCodeInput = $("roomCode");
const roomSection = $("roomSection");
const roomCodeDisplay = $("roomCodeDisplay");
const connectionStatus = $("connectionStatus");
const remoteVideo = $("remoteVideo");
const stopShareButton = $("stopShareButton");
const leaveButton = $("leaveButton");
const chatMessages = $("chatMessages");
const chatForm = $("chatForm");
const chatInput = $("chatInput");

let supabase = null;
let channel = null;
let peer = null;
let localStream = null;
let role = null;
let roomCode = null;
let leaving = false;
let offerStarted = false;
let viewerWaiting = false;
let pendingCandidates = [];

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setStatus(message) {
  connectionStatus.textContent = message;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, n => chars[n % chars.length]).join("");
}

function initSupabase() {
  if (supabase) return true;
  if (SUPABASE_URL.includes("PASTE_") || SUPABASE_ANON_KEY.includes("PASTE_")) {
    alert("First open app.js and add your Supabase project URL and anon/publishable key.");
    return false;
  }
  if (!window.supabase?.createClient) {
    alert("Supabase library did not load. Check your internet connection.");
    return false;
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

function showRoom(code) {
  roomCode = code;
  roomCodeDisplay.textContent = code;
  roomSection.hidden = false;
  chatMessages.replaceChildren();
}

function addChatMessage(name, message) {
  const line = document.createElement("p");
  const who = document.createElement("strong");
  who.textContent = name + ": ";
  const body = document.createElement("span");
  body.textContent = message;
  line.append(who, body);
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function broadcast(type, payload = {}) {
  if (!channel) return;
  const result = await channel.send({
    type: "broadcast",
    event: type,
    payload
  });
  if (result !== "ok") console.warn("Broadcast result:", result);
}

function createPeer() {
  if (peer) peer.close();
  peer = new RTCPeerConnection(rtcConfig);
  pendingCandidates = [];

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      broadcast("ice-candidate", {
        candidate: event.candidate.toJSON(),
        sender: role
      });
    }
  };

  peer.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch(() => {});
      setStatus("Connected. Receiving the stream.");
    }
  };

  peer.onconnectionstatechange = () => {
    if (!peer) return;
    if (peer.connectionState === "connected") setStatus("Connected.");
    else if (peer.connectionState === "failed") {
      setStatus("Connection failed. This network may require a TURN relay.");
    } else if (peer.connectionState === "disconnected") {
      setStatus("Connection interrupted.");
    } else if (peer.connectionState === "closed") {
      setStatus("Connection closed.");
    }
  };

  if (role === "host" && localStream) {
    for (const track of localStream.getTracks()) {
      peer.addTrack(track, localStream);
    }
  }
}


async function startHostOffer() {
  if (role !== "host" || offerStarted || !peer || !localStream || !viewerWaiting) return;
  offerStarted = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await broadcast("offer", { description: peer.localDescription });
    setStatus("Offer sent. Connecting viewer...");
  } catch (error) {
    console.error(error);
    setStatus("Could not start connection: " + error.message);
  }
}

async function handleSignal(event, payload) {
  if (!payload) return;

  if (event === "viewer-ready" && role === "host") {
    viewerWaiting = true;
    await startHostOffer();
  }

  if (event === "offer" && role === "viewer") {
    try {
      if (!peer) createPeer();
      await peer.setRemoteDescription(payload.description);
      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(candidate);
      }
      pendingCandidates = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await broadcast("answer", { description: peer.localDescription });
      setStatus("Answer sent. Connecting to stream...");
    } catch (error) {
      console.error(error);
      setStatus("Could not answer stream: " + error.message);
    }
  }

  if (event === "answer" && role === "host") {
    try {
      if (peer && !peer.currentRemoteDescription) {
        await peer.setRemoteDescription(payload.description);
        for (const candidate of pendingCandidates) {
          await peer.addIceCandidate(candidate);
        }
        pendingCandidates = [];
      }
    } catch (error) {
      console.error(error);
      setStatus("Could not finish connection: " + error.message);
    }
  }

  if (event === "ice-candidate" && payload.sender !== role && payload.candidate) {
    try {
      const candidate = new RTCIceCandidate(payload.candidate);
      if (peer && peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        pendingCandidates.push(candidate);
      }
    } catch (error) {
      console.warn("Could not add ICE candidate:", error);
    }
  }

  if (event === "chat-message" && payload.sender !== role) {
    addChatMessage("Other person", String(payload.message || "").slice(0, 1000));
  }

  if (event === "peer-left") {
    setStatus("The other person left the room.");
  }

  if (event === "stream-stopped" && role === "viewer") {
    remoteVideo.srcObject = null;
    setStatus("The other person stopped sharing.");
  }
}

async function connectToRoom(code, requestedRole) {
  if (!initSupabase()) throw new Error("Supabase is not configured.");
  await cleanup(false);

  role = requestedRole;
  roomCode = code;
  leaving = false;
  offerStarted = false;
  showRoom(code);
  setStatus("Connecting to room...");

  channel = supabase.channel("tabstream-" + code, {
    config: { broadcast: { self: false, ack: true } }
  });

  channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
    handleSignal(event, payload);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to room.")), 15000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error("Could not connect to Supabase Realtime. Check your project settings."));
      }
    });
  });

  setStatus(requestedRole === "host" ? "Room created. Waiting for the other person..." : "Joined room. Asking streamer to connect...");
  if (requestedRole === "viewer") await broadcast("viewer-ready", {});
}

createButton.addEventListener("click", async () => {
  createButton.disabled = true;
  createStatus.textContent = "Creating stream...";
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("This browser does not support screen sharing. Use a recent browser over HTTPS.");
    }
    const code = makeCode();
    await connectToRoom(code, "host");
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: true
    });
    createPeer();
    stopShareButton.disabled = false;
    await startHostOffer();
    createStatus.textContent = "Share this code with your friend: " + code;
    localStream.getVideoTracks()[0].addEventListener("ended", async () => {
      await broadcast("stream-stopped", {});
      setStatus("You stopped sharing.");
      stopShareButton.disabled = true;
    });
    setStatus("Sharing started. Waiting for the other person...");
  } catch (error) {
    console.error(error);
    createStatus.textContent = "Could not create stream: " + error.message;
    await cleanup(true);
  } finally {
    createButton.disabled = false;
  }
});

joinButton.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    joinStatus.textContent = "Enter a valid six-character code.";
    return;
  }
  joinButton.disabled = true;
  joinStatus.textContent = "Joining...";
  try {
    await connectToRoom(code, "viewer");
    createPeer();
    joinStatus.textContent = "Joined stream " + code + ".";
  } catch (error) {
    console.error(error);
    joinStatus.textContent = "Could not join: " + error.message;
    await cleanup(true);
  } finally {
    joinButton.disabled = false;
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !channel) return;
  addChatMessage("You", message);
  await broadcast("chat-message", { message, sender: role });
  chatInput.value = "";
  chatInput.focus();
});

stopShareButton.addEventListener("click", async () => {
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  await broadcast("stream-stopped", {});
  stopShareButton.disabled = true;
  setStatus("You stopped sharing.");
});

leaveButton.addEventListener("click", async () => {
  await cleanup(true);
  roomSection.hidden = true;
  createStatus.textContent = "No stream created.";
  joinStatus.textContent = "Not connected.";
});

async function cleanup(notify) {
  if (notify && channel) {
    try { await broadcast("peer-left", {}); } catch (_) {}
  }
  leaving = true;
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (peer) {
    peer.ontrack = null;
    peer.close();
    peer = null;
  }
  remoteVideo.srcObject = null;
  stopShareButton.disabled = true;
  if (channel && supabase) {
    const oldChannel = channel;
    channel = null;
    try { await supabase.removeChannel(oldChannel); } catch (_) {}
  }
  role = null;
  roomCode = null;
  offerStarted = false;
  viewerWaiting = false;
  pendingCandidates = [];
}

window.addEventListener("beforeunload", () => {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
});
