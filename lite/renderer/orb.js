const orb = document.getElementById("orb");
let mediaRecorder = null;
let chunks = [];
let stream = null;

function setState(state) {
  orb.className = state;
}

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();
    setState("listening");
  } catch (err) {
    console.error("getUserMedia failed:", err);
    setState("idle");
  }
}

async function handleStop() {
  setState("processing");
  const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
  chunks = [];
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (blob.size < 1000) {
    // Too short — likely empty
    setState("idle");
    return;
  }
  try {
    const buf = await blob.arrayBuffer();
    await window.api.transcribeAndPaste(buf);
    // Main process will send 'set-state' = 'idle' when done
  } catch (err) {
    console.error("transcribeAndPaste failed:", err);
    setState("idle");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  } else {
    setState("idle");
  }
}

window.api.onStartRecording(() => startRecording());
window.api.onStopRecording(() => stopRecording());
window.api.onSetState((state) => setState(state));
