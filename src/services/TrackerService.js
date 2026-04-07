import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export class TrackerService {
  constructor() {
    this.poseLandmarker = null;
    this.videoElement = null;
    this.animationId = null;
    this.onResults = null;
    this.lastVideoTime = -1;
  }

  async initialize() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    
    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
      // outputSegmentationMasks: true // COMMENTED OUT FOR PERFORMANCE TESTING
    });
  }

  async startCamera(videoElement, onResults) {
    this.videoElement = videoElement;
    this.onResults = onResults;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera API not available. Ensure you are on HTTPS or localhost.");
      throw new Error("Browser API navigator.mediaDevices.getUserMedia not available");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" }
      });
      this.videoElement.srcObject = stream;
      
      return new Promise((resolve) => {
        this.videoElement.onloadeddata = () => {
          this.videoElement.play().then(() => {
            this.detectPose();
            resolve();
          }).catch(e => {
            console.error("Video play failed:", e);
            resolve();
          });
        };
      });
    } catch(err) {
      alert("Failed to start camera: " + err.message);
      throw err;
    }
  }

  detectPose = () => {
    if (!this.videoElement || !this.poseLandmarker) return;

    if (this.videoElement.readyState >= 2) {
      const startTimeMs = performance.now();
      if (this.lastVideoTime !== this.videoElement.currentTime) {
        this.lastVideoTime = this.videoElement.currentTime;
        
        try {
            const results = this.poseLandmarker.detectForVideo(this.videoElement, startTimeMs);
            if (this.onResults && results) {
              this.onResults(results);
            }
        } catch(e) {
            console.error("Pose detection error:", e);
        }
      }
    }
    
    this.animationId = requestAnimationFrame(this.detectPose);
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.videoElement && this.videoElement.srcObject) {
      const tracks = this.videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
    }
  }
}
