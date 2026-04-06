import React from 'react';
import ParticleCanvas from '../components/ParticleCanvas';

function Home() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#000000' }}>
      <ParticleCanvas />
    </div>
  );
}

export default Home;
