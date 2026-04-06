import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { World, Vec3, Body, Sphere, Material, ContactMaterial, NaiveBroadphase, Plane } from 'cannon-es';
import { TrackerService } from '../services/TrackerService';

function ParticleCanvas() {
  const containerRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    let animationFrameId;
    let poseResults = null;
    const PARTICLE_COUNT = 100; // Reduced for performance with true refraction

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
    world.solver.iterations = 10;

    const physicsMaterial = new Material("standard");
    const physicsContactMaterial = new ContactMaterial(
      physicsMaterial,
      physicsMaterial,
      {
        friction: 0.1,
        restitution: 0.8,
      }
    );
    world.addContactMaterial(physicsContactMaterial);

    const vFov = camera.fov * Math.PI / 180;
    const hDist = 2 * Math.tan(vFov / 2) * camera.position.z;
    const wDist = hDist * camera.aspect;

    const dX = wDist / 2;
    const dY = hDist / 2;
    const dZ = 5;

    const wallShape = new Plane();
    const walls = [
      { pos: [0, -dY, 0], rot: [-Math.PI / 2, 0, 0] },
      { pos: [0, dY, 0], rot: [Math.PI / 2, 0, 0] },
      { pos: [-dX, 0, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [dX, 0, 0], rot: [0, -Math.PI / 2, 0] },
      { pos: [0, 0, -dZ], rot: [0, 0, 0] },
      { pos: [0, 0, dZ], rot: [Math.PI, 0, 0] }
    ];

    walls.forEach(config => {
      const wallBody = new Body({
        mass: 0,
        material: physicsMaterial,
        shape: wallShape,
      });
      wallBody.position.set(...config.pos);
      wallBody.quaternion.setFromEuler(...config.rot);
      world.addBody(wallBody);
    });

    // --- Marching Cubes Setup (Metaballs) ---
    // Use lower resolution for 500 blobs CPU limits
    const resolution = 32;
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
      const randRad = 0.3 + Math.random() * 1.0;
      const shape = new Sphere(randRad);

      const body = new Body({
        mass: 1,
        material: physicsMaterial,
        shape: shape,
        position: new Vec3(
          (Math.random() - 0.5) * wDist * 0.9,
          (Math.random() - 0.5) * hDist * 0.9,
          0
        ),
        velocity: new Vec3(
          (Math.random() - 0.5) * 1,
          (Math.random() - 0.5) * 1,
          (Math.random() - 0.5) * 1
        ),
        linearDamping: 0.85,
        angularDamping: 0.85,
        collisionFilterGroup: GROUP_PARTICLE,
        collisionFilterMask: GROUP_WALL
      });

      body.blobStrength = randRad * 0.3;
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
        world.step(timeStep);

        if (poseResults && poseResults.landmarks && poseResults.landmarks.length > 0) {
          const landmarks = poseResults.landmarks[0];
          const hands = [landmarks[15], landmarks[16]];

          hands.forEach((hand, index) => {
            if (hand && hand.visibility > 0.4) {
              const px = -(hand.x - 0.5) * wDist;
              const py = -(hand.y - 0.5) * hDist;
              const pz = 0;
              const currPos = new Vec3(px, py, pz);

              if (hasPrevHand[index]) {
                const dx = currPos.x - prevHandPos[index].x;
                const dy = currPos.y - prevHandPos[index].y;
                const dz = currPos.z - prevHandPos[index].z;

                if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                  const moveVec = new Vec3(dx, dy, dz);
                  const effectRadius = 6.0;

                  for (let i = 0; i < bodies.length; i++) {
                    const b = bodies[i];
                    const dist = b.position.distanceTo(currPos);

                    if (dist < effectRadius) {
                      const influence = 1.0 - (dist / effectRadius);
                      const forceMag = 150 * influence;
                      const force = moveVec.scale(forceMag);

                      const repulse = b.position.vsub(currPos);
                      repulse.normalize();
                      const repulseForce = repulse.scale(15 * influence);

                      const totalForce = force.vadd(repulseForce);
                      b.applyForce(totalForce, b.position);
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
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];

          // Absolutely lock depth to 0 
          b.position.z = 0;
          b.velocity.z = 0;

          b.applyForce(new Vec3(
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.1,
            0
          ), b.position);

          const nx = (b.position.x / (dX * 2)) + 0.5;
          const ny = (b.position.y / (dY * 2)) + 0.5;
          const nz = (b.position.z / (dZ * 2)) + 0.5;

          if (nx > 0 && nx < 1 && ny > 0 && ny < 1 && nz > 0 && nz < 1) {
            effect.addBall(nx, ny, nz, b.blobStrength, 12);
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
    </div>
  );
}

export default ParticleCanvas;
