"use client";
// ParticleBackground.tsx
// Animated Three.js particle background for Next.js (React)
import { useEffect, useRef } from 'react';

export default function ParticleBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let renderer: any, scene: any, camera: any, particleSystem: any, animationId: number;
    let THREE: any;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let isMounted = true;

    console.log('[ParticleBackground] useEffect running, ref:', ref.current);
    // Dynamically import Three.js for SSR safety
    import('three').then((three) => {
      console.log('[ParticleBackground] three.js loaded', three);
      if (!isMounted) return;
      THREE = three;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      camera.position.z = 2.5; // Move camera closer
      renderer = new THREE.WebGLRenderer({ alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.position = 'fixed';
      renderer.domElement.style.top = '0';
      renderer.domElement.style.left = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.zIndex = '-1';
      renderer.domElement.style.pointerEvents = 'none';
      renderer.domElement.style.background = 'transparent';
      if (ref.current) {
        ref.current.appendChild(renderer.domElement);
        console.log('[ParticleBackground] Canvas appended to ref', ref.current, renderer.domElement);
      } else {
        console.error('[ParticleBackground] ref.current is null, cannot append canvas');
      }


      // Particle system parameters
      let isMobile = width < 600;
      let isTablet = width >= 600 && width < 1024;
      let PARTICLE_COUNT = isMobile ? 500 : isTablet ? 1000 : 2000;
      let PARTICLE_SIZE = isMobile ? 1.2 : 1.8; // Subtle, like reference
      const COLORS = [0x7a9b76, 0x5a7a56, 0x9ab896, 0x6a8b66];
      // Geometry and material
      let geometry = new THREE.BufferGeometry();
      let positions = new Float32Array(PARTICLE_COUNT * 3);
      let velocities = new Float32Array(PARTICLE_COUNT * 3);
      let colors = new Float32Array(PARTICLE_COUNT * 3);
      function initParticles() {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          positions[i * 3] = (Math.random() - 0.5) * 20;
          positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
          velocities[i * 3] = (Math.random() - 0.5) * 0.01;
          velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
          velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
          const color = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      initParticles();
      const material = new THREE.PointsMaterial({
        size: PARTICLE_SIZE,
        vertexColors: true,
        opacity: 0.7, // Subtle, like reference
        transparent: true,
        depthWrite: false,
      });
        renderer.domElement.style.background = '#222'; // Debug background
      const particles = new THREE.Points(geometry, material);
      scene.add(particles);

      let stopped = false;


      // Mouse interactivity
      const mouse = { x: 0, y: 0 };
      function onMouseMove(e: MouseEvent) {
        // Convert mouse position to world coordinates
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 20 - 10;
        mouse.y = -(((e.clientY - rect.top) / rect.height) * 12 - 6);
      }
      window.addEventListener('mousemove', onMouseMove);

      // Animation loop with FPS throttle
      function animate() {
        if (stopped) return;
        animationId = requestAnimationFrame(animate);
        // Update particle positions
        const pos = geometry.getAttribute('position');
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          // Repel from mouse if close
          const dx = pos.array[i * 3] - mouse.x;
          const dy = pos.array[i * 3 + 1] - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 2.5) {
            const force = (2.5 - dist) * 0.02;
            pos.array[i * 3] += dx / dist * force;
            pos.array[i * 3 + 1] += dy / dist * force;
          } else {
            pos.array[i * 3] += velocities[i * 3];
            pos.array[i * 3 + 1] += velocities[i * 3 + 1];
          }
          pos.array[i * 3 + 2] += velocities[i * 3 + 2];
          // Boundary wrapping
          if (pos.array[i * 3] > 10) pos.array[i * 3] = -10;
          if (pos.array[i * 3] < -10) pos.array[i * 3] = 10;
          if (pos.array[i * 3 + 1] > 6) pos.array[i * 3 + 1] = -6;
          if (pos.array[i * 3 + 1] < -6) pos.array[i * 3 + 1] = 6;
        }
        pos.needsUpdate = true;
        renderer.render(scene, camera);
      }
      animate();

      // Resize handler with particle count adjustment
      function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        isMobile = width < 600;
        isTablet = width >= 600 && width < 1024;
        const newCount = isMobile ? 500 : isTablet ? 1000 : 2000;
        if (newCount !== PARTICLE_COUNT) {
          PARTICLE_COUNT = newCount;
          PARTICLE_SIZE = isMobile ? 1.2 : 1.8;
          scene.remove(particles);
          geometry.dispose();
          material.dispose();
          geometry = new THREE.BufferGeometry();
          positions = new Float32Array(PARTICLE_COUNT * 3);
          velocities = new Float32Array(PARTICLE_COUNT * 3);
          colors = new Float32Array(PARTICLE_COUNT * 3);
          initParticles();
          const newMaterial = new THREE.PointsMaterial({
            size: PARTICLE_SIZE,
            vertexColors: true,
            opacity: 0.7,
            transparent: true,
            depthWrite: false,
          });
          const newParticles = new THREE.Points(geometry, newMaterial);
          scene.add(newParticles);
        }
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
      window.addEventListener('resize', onResize);

      // Cleanup
      return () => {
        isMounted = false;
        stopped = true;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('resize', onResize);
        cancelAnimationFrame(animationId);
        scene.remove(particles);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    });
    // eslint-disable-next-line
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        background: 'linear-gradient(180deg, #1d1d23 0%, #23232a 100%)',
      }}
      aria-hidden="true"
    />
  );
}
