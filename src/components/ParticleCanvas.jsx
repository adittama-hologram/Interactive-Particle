import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { World, Vec3, Body, Sphere, Material, ContactMaterial, NaiveBroadphase, Plane } from 'cannon-es';
import { TrackerService } from '../services/TrackerService';

function ParticleCanvas() {
  const containerRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    let animationFrameId;
    let poseResults = null;
    const PARTICLE_COUNT = 3000; // "Denser"
    const PARTICLE_RAD = 0.05; // "Way more small"
    
    // Collision Groups
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
    scene.background = new THREE.Color(0x0e111a);
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 30);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    if (containerRef.current) {
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(renderer.domElement);
    }

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0x00f0ff, 1.5, 100);
    pointLight.position.set(10, 10, 20);
    scene.add(pointLight);

    const pointLight2 = new THREE.PointLight(0xff0040, 1.5, 100);
    pointLight2.position.set(-10, -10, 20);
    scene.add(pointLight2);
    
    // --- Physics Setup ---
    const world = new World({
      gravity: new Vec3(0, 0, 0), // Floating freely
    });
    
    world.broadphase = new NaiveBroadphase();
    world.solver.iterations = 10;
    
    const physicsMaterial = new Material("standard");
    const physicsContactMaterial = new ContactMaterial(
      physicsMaterial,
      physicsMaterial,
      {
        friction: 0.1,
        restitution: 0.8, // Bouncy against walls
      }
    );
    world.addContactMaterial(physicsContactMaterial);
    
    // Walls calculation
    const vFov = camera.fov * Math.PI / 180;
    const hDist = 2 * Math.tan(vFov / 2) * camera.position.z;
    const wDist = hDist * camera.aspect;
    
    const dX = wDist / 2;
    const dY = hDist / 2;
    const dZ = 5; // A bit more depth since they are tiny 
    
    const wallShape = new Plane();
    const walls = [
      { pos: [0, -dY, 0], rot: [-Math.PI / 2, 0, 0] }, // Bottom
      { pos: [0, dY, 0], rot: [Math.PI / 2, 0, 0] },   // Top
      { pos: [-dX, 0, 0], rot: [0, Math.PI / 2, 0] },  // Left
      { pos: [dX, 0, 0], rot: [0, -Math.PI / 2, 0] },  // Right
      { pos: [0, 0, -dZ], rot: [0, 0, 0] },            // Back
      { pos: [0, 0, dZ], rot: [Math.PI, 0, 0] }        // Front
    ];
    
    walls.forEach(config => {
      const wallBody = new Body({
        mass: 0,
        material: physicsMaterial,
        shape: wallShape,
        collisionFilterGroup: GROUP_WALL,
        collisionFilterMask: GROUP_PARTICLE // Walls only interact with particles
      });
      wallBody.position.set(...config.pos);
      wallBody.quaternion.setFromEuler(...config.rot);
      world.addBody(wallBody);
    });
    
    // --- Instanced Mesh Setup for Performance ---
    const geometry = new THREE.SphereGeometry(PARTICLE_RAD, 12, 12); // Reduced segments for extreme density perf
    const material = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,     // Clean uniform water/neon blue
        roughness: 0.1,
        metalness: 0.5,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.3
    });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);
    scene.add(instancedMesh);

    // --- Physics Bodies ---
    const bodies = [];
    const shape = new Sphere(PARTICLE_RAD);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const body = new Body({
            mass: 1,
            material: physicsMaterial,
            shape: shape,
            position: new Vec3(
                (Math.random() - 0.5) * wDist * 0.9,
                (Math.random() - 0.5) * hDist * 0.9,
                0 // Spawned at a flat, uniform distance from camera
            ),
            velocity: new Vec3(
                (Math.random() - 0.5) * 1, // Start gently
                (Math.random() - 0.5) * 1,
                (Math.random() - 0.5) * 1
            ),
            linearDamping: 0.85, // Thick fluid deceleration
            angularDamping: 0.85,
            collisionFilterGroup: GROUP_PARTICLE,
            collisionFilterMask: GROUP_WALL // Particles interact ONLY with walls, passing through each other
        });
        world.addBody(body);
        bodies.push(body);
    }
    
    // --- Mouse Interaction ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;
    let dragTarget = new THREE.Vector3();
    let prevDragTarget = new THREE.Vector3();
    let hasPrevDrag = false;
    const zeroPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    
    const updateDragTarget = (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        raycaster.ray.intersectPlane(zeroPlane, dragTarget);
    };

    const onPointerDown = (e) => {
        isDragging = true;
        updateDragTarget(e);
        prevDragTarget.copy(dragTarget);
        hasPrevDrag = true;
    };
    
    const onPointerMove = (e) => {
        if (isDragging) {
            updateDragTarget(e);
        }
    };
    
    const onPointerUp = () => {
        isDragging = false;
        hasPrevDrag = false;
    };
    
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
    
    // --- Resize ---
    const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // --- Animation Loop ---
    const dummyObj = new THREE.Object3D();
    const timeStep = 1 / 60;
    
    const animate = () => {
        try {
            world.step(timeStep);
            
            // Fluid Mouse Drag effect (reduced force for natural effect)
            if (isDragging && hasPrevDrag) {
                const dx = dragTarget.x - prevDragTarget.x;
                const dy = dragTarget.y - prevDragTarget.y;
                const dz = dragTarget.z - prevDragTarget.z;
                
                if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                    const moveVec = new Vec3(dx, dy, dz);
                    const dragPos = new Vec3(dragTarget.x, dragTarget.y, dragTarget.z);
                    const effectRadius = 6.0; // Increased radius for fluid feeling
                    
                    for (let i = 0; i < bodies.length; i++) {
                        const b = bodies[i];
                        const dist = b.position.distanceTo(dragPos);
                        
                        if (dist < effectRadius) {
                            const influence = 1.0 - (dist / effectRadius); 
                            
                            // Increased drag to match heavy deceleration
                            const forceMag = 180 * influence;  
                            const force = moveVec.scale(forceMag);
                            
                            // Responsive gentle ripple
                            const repulse = b.position.vsub(dragPos);
                            repulse.normalize();
                            const repulseForce = repulse.scale(30 * influence); 
                            
                            const totalForce = force.vadd(repulseForce);
                            b.applyForce(totalForce, b.position);
                        }
                    }
                }
                prevDragTarget.copy(dragTarget);
            }
            
            // Body Tracking physics repulsions
            if (poseResults && poseResults.landmarks && poseResults.landmarks.length > 0) {
                const landmarks = poseResults.landmarks[0];
                const effectors = [landmarks[15], landmarks[16], landmarks[31], landmarks[32]].filter(Boolean);
                
                effectors.forEach(pt => {
                    if (pt.visibility > 0.3) {
                        const px = -(pt.x - 0.5) * wDist;
                        const py = -(pt.y - 0.5) * hDist;
                        const pz = 0;
                        const effPos = new Vec3(px, py, pz);
                        
                        for (let i = 0; i < bodies.length; i++) {
                            const b = bodies[i];
                            const dist = b.position.distanceTo(effPos);
                            if (dist < 4.0) {
                                const forceDir = b.position.vsub(effPos);
                                forceDir.normalize();
                                const magnitude = 80 / Math.max(0.1, dist); // Reduced to match new scale
                                const force = forceDir.scale(magnitude);
                                b.applyForce(force, b.position);
                            }
                        }
                    }
                });
            }
            
            // Sync bodies to instanced mesh
            for (let i = 0; i < bodies.length; i++) {
                const b = bodies[i];
                
                // Add tiny random continuous forces to prevent physics sleep
                b.applyForce(new Vec3(
                   (Math.random() - 0.5) * 0.1,
                   (Math.random() - 0.5) * 0.1,
                   (Math.random() - 0.5) * 0.1
                ), b.position);

                dummyObj.position.copy(b.position);
                dummyObj.quaternion.copy(b.quaternion);
                dummyObj.updateMatrix();
                instancedMesh.setMatrixAt(i, dummyObj.matrix);
            }
            instancedMesh.instanceMatrix.needsUpdate = true;
            
            renderer.render(scene, camera);
        } catch(e) {
            console.error("Render Loop Error:", e);
        }
        animationFrameId = requestAnimationFrame(animate);
    };
    
    animate();

    // --- Cleanup ---
    return () => {
        tracker.stop();
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('touchcancel', onPointerUp);
        window.removeEventListener('resize', onResize);
        
        if (containerRef.current) containerRef.current.innerHTML = '';
        renderer.dispose();
    };
  }, []);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }} />
      {/* Hidden video element for MediaPipe feed */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
    </>
  );
}

export default ParticleCanvas;
