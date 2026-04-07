import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { World, Vec3, Body, Sphere, Material, ContactMaterial, NaiveBroadphase, Plane } from 'cannon-es';
import { TrackerService } from '../services/TrackerService';

function ParticleCanvas() {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const isFrozenRef = useRef(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const showOverlayRef = useRef(true);

  const toggleFreeze = () => {
    setIsFrozen(prev => {
      const next = !prev;
      isFrozenRef.current = next;
      return next;
    });
  };

  const toggleOverlay = () => {
    setShowOverlay(prev => {
      const next = !prev;
      showOverlayRef.current = next;
      if (!next && maskCanvasRef.current) {
        const ctx = maskCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      }
      return next;
    });
  };

  useEffect(() => {
    let animationFrameId;
    let poseResults = null;
    const PARTICLE_COUNT = 150; // Increased to 150 to support higher spawn volume

    const GROUP_WALL = 1;
    const GROUP_PARTICLE = 2;

    // Start Camera Tracking
    const tracker = new TrackerService();
    tracker.initialize().then(() => {
      if (videoRef.current) {
        tracker.startCamera(videoRef.current, (results) => {
          poseResults = results;
        }).catch(err => console.error(err));
      }
    }).catch(err => console.error(err));

    // --- Three.js Setup ---
    const scene = new THREE.Scene();

    // Pass live webcam into WebGL environment mapping so glass materials actually refract real content
    if (videoRef.current) {
      const videoTexture = new THREE.VideoTexture(videoRef.current);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      videoTexture.minFilter = THREE.LinearFilter;
      videoTexture.magFilter = THREE.LinearFilter;
      // Mirror the webcam image natively in 3D
      videoTexture.center.set(0.5, 0.5);
      videoTexture.repeat.set(-1, 1);

      scene.background = videoTexture;
      scene.environment = videoTexture;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(renderer.domElement);
    }

    // --- Lighting ---
    // Flood the scene with bright light to help the fluid glint
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 3.0, 100);
    pointLight.position.set(10, 10, 20);
    scene.add(pointLight);

    const pointLight2 = new THREE.PointLight(0xaaccff, 2.0, 100);
    pointLight2.position.set(-10, -10, 20);
    scene.add(pointLight2);

    // --- Physics Setup ---
    const world = new World({
      gravity: new Vec3(0, 0, 0),
    });

    world.broadphase = new NaiveBroadphase();
    world.solver.iterations = 5; // Reduced from 10 to halve collision calculation time

    const physicsMaterial = new Material("standard");
    const physicsContactMaterial = new ContactMaterial(
      physicsMaterial,
      physicsMaterial,
      {
        friction: 0.1,
        restitution: 0.7,
      }
    );
    world.addContactMaterial(physicsContactMaterial);

    const vFov = camera.fov * Math.PI / 180;
    const hDist = 2 * Math.tan(vFov / 2) * camera.position.z;
    const wDist = hDist * camera.aspect;

    const dX = wDist / 2;
    const dY = hDist / 2;
    const dZ = 5;

    // --- Marching Cubes Setup (Metaballs) ---
    // Increased grid resolution up to 64 for incredibly high fidelity liquid rendering!
    const resolution = 64;
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 1.0,
      ior: 1.33,
      thickness: 0.5,
      transparent: true,
      opacity: 1.0,
      envMapIntensity: 2.0
    });

    // Custom shader injection for precise geometric center-coloring
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // Calculate view reflection dot normal
         float inwardFresnel = max( 0.0, dot( normalize(vViewPosition), normalize(vNormal) ) );
         
         // Fainter icy cyan tint
         vec3 coreBlue = vec3( 0.65, 0.92, 1.0 ); 
         
         // Using a much higher power (5.0) sharply shrinks the tinted area tightly into the absolute center
         diffuseColor.rgb *= mix( vec3(1.0), coreBlue, pow(inwardFresnel, 5.0) );
        `
      );
    };

    const effect = new MarchingCubes(resolution, material, false, false, 100000);
    effect.position.set(0, 0, 0);
    effect.scale.set(dX, dY, dZ);
    effect.isolation = 80;
    scene.add(effect);


    // --- Physics Bodies ---
    const bodies = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Shrunk particle geometrical and blob sizes drastically
      const randRad = 0.1 + Math.random() * 0.3;
      const shape = new Sphere(randRad);

      const body = new Body({
        mass: 1,
        material: physicsMaterial,
        shape: shape,
        position: new Vec3(0, 0, -1000), // Start suspended off-screen
        velocity: new Vec3(0, 0, 0),
        linearDamping: 0.85,
        angularDamping: 0.85,
        collisionFilterGroup: GROUP_PARTICLE,
        collisionFilterMask: GROUP_PARTICLE // Particles only collide statically with other particles now, walls are eliminated!
      });

      body.blobStrength = randRad * 0.15; // Decreased base strength for smaller visual footprint
      body.isActive = false;
      body.spawnTime = 0;
      body.lifeSpan = 0;
      
      world.addBody(body);
      bodies.push(body);
    }

    // --- Hand Tracking Drag Interaction ---
    let prevHandPos = [new Vec3(), new Vec3()];
    let hasPrevHand = [false, false];

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    const timeStep = 1 / 60;

    const animate = () => {
      try {
        if (!isFrozenRef.current) {
          world.step(timeStep);
        }

        /* -- COMMENTED OUT BLANKET OVERLAY OVERHEAD TESTING --
        if (showOverlayRef.current && poseResults && poseResults.segmentationMasks && poseResults.segmentationMasks.length > 0) {
          const mask = poseResults.segmentationMasks[0];
          
          if (maskCanvasRef.current) {
            const canvas = maskCanvasRef.current;
            if (canvas.width !== mask.width || canvas.height !== mask.height) {
              canvas.width = mask.width;
              canvas.height = mask.height;
            }

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            let imageData = ctx.getImageData(0, 0, mask.width, mask.height);
            const data = imageData.data;
            const maskFloat = mask.getAsFloat32Array();
            mask.close(); // Prevent canvas memory leak from MediaPipe mask object

            for (let j = 0; j < maskFloat.length; j++) {
              if (maskFloat[j] > 0.1) {
                data[j * 4] = 0;
                data[j * 4 + 1] = 0;
                data[j * 4 + 2] = 255;
                data[j * 4 + 3] = 255; // Solid blue coverage
              } else {
                data[j * 4 + 3] = 0;
              }
            }

            ctx.putImageData(imageData, 0, 0);
          }
        } else if (showOverlayRef.current && maskCanvasRef.current) {
          const ctx = maskCanvasRef.current.getContext('2d');
          ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        }
        */

        if (poseResults && poseResults.landmarks && poseResults.landmarks.length > 0) {
          const landmarks = poseResults.landmarks[0];
          const hands = [landmarks[15], landmarks[16]];

          hands.forEach((hand, index) => {
            // Increased visibility threshold prevents out-of-frame guessing
            if (hand && hand.visibility > 0.75) {
              const px = -(hand.x - 0.5) * wDist;
              const py = -(hand.y - 0.5) * hDist;
              const pz = 0;
              const currPos = new Vec3(px, py, pz);

              if (hasPrevHand[index]) {
                const dx = currPos.x - prevHandPos[index].x;
                const dy = currPos.y - prevHandPos[index].y;
                const dz = currPos.z - prevHandPos[index].z;

                if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                  const speed = Math.sqrt(dx * dx + dy * dy);
                  
                  // Min 1.0 for noise bypass. Max 15.0 to ignore tracking camera "teleports" when hands enter/exit.
                  if (speed > 1.0 && speed < 15.0 && !isFrozenRef.current) {
                    
                    // Massively scale the spawn rate linearly with the physical speed of the hand!
                    // A slow wave (speed ~1.0) yields 1-2 particles. A fast whip (speed ~3.0+) yields 6 particles per frame!
                    let spawnVolume = Math.min(Math.floor(speed * 2.0), 6) || 1;
                    
                    for (let s = 0; s < spawnVolume; s++) {
                      const inactiveBody = bodies.find(b => !b.isActive);
                      if (inactiveBody) {
                        inactiveBody.isActive = true;
                        inactiveBody.spawnTime = performance.now();
                        // Decay faster: 2-3 seconds lifespan
                        inactiveBody.lifeSpan = 2000 + Math.random() * 1000;
                        
                        // Completely randomize the visual liquid injection size upon spawn
                        inactiveBody.blobStrength = 0.04 + Math.random() * 0.15;
                        
                        inactiveBody.position.set(
                           currPos.x + (Math.random() - 0.5) * 1.5,
                           currPos.y + (Math.random() - 0.5) * 1.5,
                           0
                        );
                        
                        inactiveBody.velocity.set(dx * 20, dy * 20, 0); 
                      }
                    }
                  }
                }
              }

              prevHandPos[index].copy(currPos);
              hasPrevHand[index] = true;
            } else {
              hasPrevHand[index] = false;
            }
          });
        } else {
          hasPrevHand = [false, false];
        }

        effect.reset();
        const now = performance.now();
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];

          if (!b.isActive) {
             b.position.set(0, 0, -1000);
             b.velocity.set(0, 0, 0);
             continue; // Skip inactive pool members
          }

          if (now - b.spawnTime > b.lifeSpan) {
             b.isActive = false;
             continue; // Immediately suspend
          }

          // Absolutely lock depth to 0 
          b.position.z = 0;
          b.velocity.z = 0;
          // After spawning, the object relies entirely on its inherited velocity and standard Cannon physics.
          // Removed manual randomized Brownian forces to preserve clean trajectories.

          const nx = (b.position.x / (dX * 2)) + 0.5;
          const ny = (b.position.y / (dY * 2)) + 0.5;
          const nz = (b.position.z / (dZ * 2)) + 0.5;

          if (nx > 0 && nx < 1 && ny > 0 && ny < 1 && nz > 0 && nz < 1) {
             // Smoothly shrink geometry before despawn
             const ageRatio = (now - b.spawnTime) / b.lifeSpan;
             let strength = b.blobStrength;
             if (ageRatio > 0.8) {
                strength *= (1.0 - ageRatio) / 0.2; // Linear zero scale out
             }
             effect.addBall(nx, ny, nz, strength, 12);
          }
        }
        effect.update();

        renderer.render(scene, camera);
      } catch (e) {
        console.error("Render Loop Error:", e);
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      tracker.stop();
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', onResize);

      if (containerRef.current) containerRef.current.innerHTML = '';
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Hide video element fully so WebGL is the sole display */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline autoPlay muted />
      <div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'default', touchAction: 'none' }} />
      <canvas 
        ref={maskCanvasRef} 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          pointerEvents: 'none', 
          objectFit: 'cover', // Mirror the full coverage of the webcam
          transform: 'scaleX(-1)' // Mirror to match WebGL 3D texture
        }} 
      />
      <div style={{
        position: 'absolute',
        bottom: '30px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        display: 'flex',
        gap: '20px'
      }}>
        <button
          onClick={toggleOverlay}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#fff',
            backgroundColor: showOverlay ? '#2c3e50' : '#8e44ad',
            border: 'none',
            borderRadius: '25px',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.3s ease',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {showOverlay ? 'Hide Mask' : 'Show Mask'}
        </button>
        <button
          onClick={toggleFreeze}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#fff',
            backgroundColor: isFrozen ? '#e74c3c' : '#3498db',
            border: 'none',
            borderRadius: '25px',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.3s ease',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isFrozen ? 'Unfreeze' : 'Freeze'}
        </button>
      </div>
    </div>
  );
}

export default ParticleCanvas;
