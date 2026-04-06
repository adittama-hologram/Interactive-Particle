import React from 'react';
import ParticleCanvas from '../components/ParticleCanvas';

function Home() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: 'transparent' }}>
      <ParticleCanvas />
    </div>
  );
}

export default Home;
