import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

type NodeData = {
  id: string;
  gpu: number;
  temp: number;
  cooling: number;
  power: number;
  status: 'active' | 'idle' | 'offline';
};

type ClusterData = {
  name: string;
  status: 'active' | 'idle' | 'optimizing';
  nodes: NodeData[];
  gpu: number;
  cooling: number;
  power: number;
  site?: string;
};

interface DataCenter3DProps {
  cluster: ClusterData;
  onClose: () => void;
}

// Heat distortion shader
const heatShaderMaterial = {
  uniforms: {
    time: { value: 0 },
    intensity: { value: 0 },
    color: { value: new THREE.Color() },
  },
  vertexShader: `
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;
    varying vec3 vNormal;
    
    void main() {
      vUv = uv;
      vNormal = normal;
      vec3 pos = position;
      float distortion = sin(position.y * 10.0 + time * 3.0) * intensity * 0.02;
      pos.x += distortion;
      pos.z += cos(position.y * 8.0 + time * 2.5) * intensity * 0.02;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform float intensity;
    varying vec2 vUv;
    varying vec3 vNormal;
    
    void main() {
      float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
      float glow = intensity * (0.5 + 0.5 * fresnel);
      gl_FragColor = vec4(color * (0.3 + glow), 0.7 + glow * 0.3);
    }
  `,
};

// Shared layout constants for realistic airflow
// Cold aisle perforated tiles centered in front of the rack
const COLD_AISLE_VENT_TILES: { x: number; z: number; w: number; d: number }[] = [
  { x: -0.35, z: 0.70, w: 0.60, d: 0.60 },
  { x:  0.35, z: 0.70, w: 0.60, d: 0.60 },
  { x: -0.35, z: 0.95, w: 0.60, d: 0.60 },
  { x:  0.35, z: 0.95, w: 0.60, d: 0.60 },
  { x: -0.35, z: 1.20, w: 0.60, d: 0.60 },
  { x:  0.35, z: 1.20, w: 0.60, d: 0.60 },
];

// Ceiling return grilles (hot air return)
const CEILING_RETURN_GRILLES_X = [-2, 0, 2];
const CEILING_RETURN_Z = -1;

// Floor tiles with cold aisle vents
function DataCenterFloor() {
  return (
    <group position={[0, -0.6, 0]}>
      {/* Main floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial 
          color="#1a1a1a"
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>
      
      {/* Floor tiles grid */}
      {Array.from({ length: 6 }).map((_, x) =>
        Array.from({ length: 5 }).map((_, z) => (
          <mesh
            key={`tile-${x}-${z}`}
            position={[x * 2 - 5, 0.01, z * 2 - 4]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[1.9, 1.9]} />
            <meshStandardMaterial
              color="#0a0a0a"
              metalness={0.3}
              roughness={0.7}
            />
          </mesh>
        ))
      )}
      
      {/* Cold aisle floor vents (perforated tiles) in front of the rack */}
      {COLD_AISLE_VENT_TILES.map((t, idx) => (
        <group key={`vent-${idx}`} position={[t.x, 0.02, t.z]}>
          {/* Vent tile frame */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[t.w, t.d]} />
            <meshStandardMaterial color="#2a2f33" metalness={0.6} roughness={0.5} />
          </mesh>
          {/* Perforations grid */}
          {Array.from({ length: 36 }).map((_, i) => (
            <mesh
              key={i}
              position={[(i % 6) * (t.w / 7) - t.w / 2 + t.w / 7, 0.01, Math.floor(i / 6) * (t.d / 7) - t.d / 2 + t.d / 7]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[0.02, 12]} />
              <meshStandardMaterial color="#0a1e24" />
            </mesh>
          ))}
        </group>
      ))}
      
      {/* Contact shadows for depth */}
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.5}
        scale={10}
        blur={2}
        far={4}
      />
    </group>
  );
}

// Server room walls and ceiling
function ServerRoom() {
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 2, -5]} receiveShadow>
        <boxGeometry args={[12, 6, 0.2]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>
      
      {/* Left wall */}
      <mesh position={[-6, 2, 0]} receiveShadow>
        <boxGeometry args={[0.2, 6, 10]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>
      
      {/* Right wall with CRAC unit indication */}
      <mesh position={[6, 2, 0]} receiveShadow>
        <boxGeometry args={[0.2, 6, 10]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>
      
      {/* CRAC Unit (Computer Room Air Conditioning) on right wall */}
      <group position={[5.8, 1.5, -2]}>
        <mesh>
          <boxGeometry args={[0.2, 0.8, 0.8]} />
          <meshStandardMaterial color="#2a2a3e" metalness={0.6} roughness={0.4} />
        </mesh>
        <Text position={[0.11, 0, 0]} fontSize={0.06} color="#00aa00" rotation={[0, -Math.PI / 2, 0]}>
          CRAC
        </Text>
        {/* Status LED */}
        <mesh position={[0.11, 0.3, 0]}>
          <sphereGeometry args={[0.02, 16, 16]} />
          <meshStandardMaterial color="#00aa00" emissive="#00aa00" emissiveIntensity={1} />
        </mesh>
      </group>
      
      {/* Ceiling with cable trays */}
      <mesh position={[0, 5, 0]} receiveShadow>
        <boxGeometry args={[12, 0.2, 10]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.2} roughness={0.8} />
      </mesh>
      
      {/* Cable tray running along ceiling */}
      <mesh position={[0, 4.7, 0]} castShadow>
        <boxGeometry args={[0.4, 0.1, 8]} />
        <meshStandardMaterial color="#444444" metalness={0.7} roughness={0.3} />
      </mesh>
      
      {/* Emergency lights */}
      <group position={[0, 4.8, 3]}>
        <mesh>
          <boxGeometry args={[0.3, 0.1, 0.15]} />
          <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={0.2} />
        </mesh>
        <Text position={[0, -0.1, 0]} fontSize={0.05} color="#ffffff">
          EXIT
        </Text>
      </group>
      
      {/* Ceiling vents for exhaust */}
      {[-2, 0, 2].map((xPos, idx) => (
        <mesh key={`ceiling-vent-${idx}`} position={[xPos, 4.9, -1]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.8, 0.05, 0.8]} />
          <meshStandardMaterial
            color="#1a1a1a"
            metalness={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}
    </group>
  );
}

// Detailed rack enclosure with animated swinging doors
function RackEnclosure({ doorOpen }: { doorOpen: boolean }) {
  const doorRef = useRef<THREE.Group>(null);

  // Smooth door swing animation using lerp (rotates around left hinge, swings outward toward viewer)
  useFrame(() => {
    if (doorRef.current) {
      const targetRotation = doorOpen ? -Math.PI * 0.7 : 0; // -90 degrees (negative = swing outward)
      doorRef.current.rotation.y += (targetRotation - doorRef.current.rotation.y) * 0.08;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Rack frame posts (4 vertical corners) */}
      {[
        [-0.5, 0, -0.4],
        [0.5, 0, -0.4],
        [-0.5, 0, 0.4],
        [0.5, 0, 0.4],
      ].map((pos, idx) => (
        <mesh key={`post-${idx}`} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.05, 2.2, 0.05]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
      
      {/* Horizontal rack rails */}
      {Array.from({ length: 9 }).map((_, i) => (
        <group key={`rail-${i}`}>
          <mesh position={[-0.48, i * 0.27 - 0.1, 0]} castShadow>
            <boxGeometry args={[0.02, 0.02, 0.8]} />
            <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0.48, i * 0.27 - 0.1, 0]} castShadow>
            <boxGeometry args={[0.02, 0.02, 0.8]} />
            <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* 8 GPU Server Rack Slots (1U each) - visible mounting guides */}
      {Array.from({ length: 8 }).map((_, i) => (
        <group key={`slot-${i}`} position={[0, i * 0.27 + 0.15, 0]}>
          {/* Left slot guide rail */}
          <mesh position={[-0.45, 0, 0]}>
            <boxGeometry args={[0.03, 0.12, 0.75]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Right slot guide rail */}
          <mesh position={[0.45, 0, 0]}>
            <boxGeometry args={[0.03, 0.12, 0.75]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Slot number label on left rail */}
          <Text 
            position={[-0.48, 0, 0.38]} 
            fontSize={0.03} 
            color="#888888"
            anchorX="center"
            anchorY="middle"
          >
            {i + 1}
          </Text>
        </group>
      ))}
      
      {/* Front glass door (animated - swings OUTWARD from left hinge) */}
      {/* Positioned at left edge so it rotates around the hinge */}
      <group ref={doorRef} position={[-0.5, 1.1, 0.42]}>
        <mesh position={[0.5, 0, 0]} castShadow>
          <boxGeometry args={[1.0, 2.15, 0.02]} />
          <meshPhysicalMaterial
            color="#1a1a1a"
            metalness={0.1}
            roughness={0.1}
            transmission={doorOpen ? 0.3 : 0.7}
            thickness={0.5}
          />
        </mesh>
        
        {/* Door handle */}
        <mesh position={[0.9, 0, 0.01]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.15]} />
          <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
      
      {/* Back door (solid, for exhaust) */}
      <mesh position={[0, 1.1, -0.42]} castShadow>
        <boxGeometry args={[1.0, 2.15, 0.02]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Rear exhaust vents in back door */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh
          key={`exhaust-${i}`}
          position={[
            (i % 4) * 0.22 - 0.33,
            Math.floor(i / 4) * 0.6 + 0.4,
            -0.43
          ]}
          castShadow
        >
          <boxGeometry args={[0.15, 0.5, 0.01]} />
          <meshStandardMaterial color="#0a0a0a" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      
      {/* Side panels */}
      <mesh position={[-0.52, 1.1, 0]} castShadow>
        <boxGeometry args={[0.02, 2.15, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.52, 1.1, 0]} castShadow>
        <boxGeometry args={[0.02, 2.15, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Top panel */}
      <mesh position={[0, 2.18, 0]} castShadow>
        <boxGeometry args={[1.04, 0.02, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Bottom panel */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[1.04, 0.02, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Power distribution unit (PDU) on side */}
      <mesh position={[-0.54, 1.1, 0.3]} castShadow>
        <boxGeometry args={[0.04, 1.8, 0.08]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.2} />
      </mesh>
      
      {/* Cable management arm */}
      <mesh position={[0.54, 1.5, 0.2]} castShadow>
        <boxGeometry args={[0.06, 0.5, 0.05]} />
        <meshStandardMaterial color="#333333" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

// Individual server node with extreme detail
function ServerNode({ 
  position, 
  nodeData, 
  onClick 
}: { 
  position: [number, number, number]; 
  nodeData: NodeData;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const heatRef = useRef<THREE.ShaderMaterial>(null);
  const [hovered, setHovered] = useState(false);
  
  const nodeColor = useMemo(() => {
    if (nodeData.status === 'offline') return '#1a1a1a';
    if (nodeData.gpu > 75) return '#ff4444';
    if (nodeData.gpu > 30) return '#44ff88';
    return '#666666';
  }, [nodeData.gpu, nodeData.status]);

  const glowColor = useMemo(() => {
    if (nodeData.gpu > 75) return new THREE.Color(1, 0.2, 0.1);
    if (nodeData.gpu > 30) return new THREE.Color(0.2, 1, 0.5);
    return new THREE.Color(0.3, 0.3, 0.3);
  }, [nodeData.gpu]);

  useFrame((state) => {
    if (heatRef.current) {
      heatRef.current.uniforms.time.value = state.clock.elapsedTime;
      heatRef.current.uniforms.intensity.value = nodeData.gpu / 100;
      heatRef.current.uniforms.color.value = glowColor;
    }
    
    if (meshRef.current && hovered) {
      const scale = 1.02 + Math.sin(state.clock.elapsedTime * 4) * 0.01;
      meshRef.current.scale.set(scale, scale, scale);
    }
  });

  // GPU activity animation speed
  const activitySpeed = nodeData.gpu / 20; // Higher GPU = faster animation

  return (
    <group position={position}>
      {/* Main server chassis (visible rectangular tray) */}
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.9, 0.12, 0.7]} />
        <meshStandardMaterial 
          color="#2b2f35"
          metalness={0.7}
          roughness={0.45}
          emissive="#0a0a0a"
          emissiveIntensity={0.2}
        />
      </mesh>
      
      {/* GPU Activity Bar (animated) */}
      {nodeData.status !== 'offline' && (
        <mesh position={[-0.42, 0, 0.361]}>
          <boxGeometry args={[0.02, 0.09 * (nodeData.gpu / 100), 0.005]} />
          <meshStandardMaterial 
            color={nodeColor}
            emissive={nodeColor}
            emissiveIntensity={1}
          />
        </mesh>
      )}
      
      {/* Processing indicator (pulsing for active workloads) */}
      {nodeData.gpu > 30 && (
        <mesh position={[0.42, 0, 0.361]}>
          <sphereGeometry args={[0.015, 16, 16]} />
          <meshStandardMaterial 
            color="#ffaa00"
            emissive="#ffaa00"
            emissiveIntensity={1 + Math.sin(Date.now() * 0.005 * activitySpeed) * 0.5}
          />
        </mesh>
      )}
      
      {/* Front panel details */}
      <mesh position={[0, 0, 0.36]} castShadow>
        <boxGeometry args={[0.88, 0.10, 0.01]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* LED indicators array - BRIGHT for visibility */}
      {[-0.3, -0.2, -0.1, 0, 0.1].map((xPos, idx) => (
        <mesh key={`led-${idx}`} position={[xPos, 0, 0.37]}>
          <boxGeometry args={[0.03, 0.08, 0.005]} />
          <meshStandardMaterial 
            color={idx < 2 ? nodeColor : idx === 2 ? '#ffaa00' : '#0088ff'}
            emissive={idx < 2 ? nodeColor : idx === 2 ? '#ffaa00' : '#0088ff'}
            emissiveIntensity={nodeData.status === 'offline' ? 0 : 2.5}
          />
        </mesh>
      ))}
      
      {/* Power button - BRIGHT green */}
      <mesh position={[0.38, 0, 0.37]}>
        <cylinderGeometry args={[0.015, 0.015, 0.01, 16]} />
        <meshStandardMaterial 
          color="#00ff00"
          emissive="#00ff00"
          emissiveIntensity={nodeData.status === 'offline' ? 0 : 3}
        />
      </mesh>
      
      {/* Drive bay indicators */}
      {Array.from({ length: 4 }).map((_, i) => (
        <mesh key={`drive-${i}`} position={[-0.35 + i * 0.08, 0, 0.37]}>
          <boxGeometry args={[0.06, 0.04, 0.005]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      
      {/* Cooling fans (front intake) - animated */}
      {[-0.2, 0.2].map((xPos, idx) => (
        <group key={`fan-front-${idx}`} position={[xPos, 0, 0.35]}>
          <mesh>
            <cylinderGeometry args={[0.04, 0.04, 0.02, 16]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
      
      {/* Rear exhaust grille */}
      <mesh position={[0, 0, -0.36]} castShadow>
        <boxGeometry args={[0.88, 0.10, 0.01]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.5} roughness={0.5} />
      </mesh>
      
      {/* Rear exhaust fans */}
      {[-0.2, 0.2].map((xPos, idx) => (
        <group key={`fan-rear-${idx}`} position={[xPos, 0, -0.35]}>
          <mesh>
            <cylinderGeometry args={[0.045, 0.045, 0.02, 16]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
      
      {/* Heat sink visible through rear */}
      {nodeData.gpu > 50 && (
        <mesh position={[0, 0, -0.32]}>
          <boxGeometry args={[0.3, 0.08, 0.05]} />
          <meshStandardMaterial 
            color="#ff6600"
            emissive="#ff6600"
            emissiveIntensity={nodeData.gpu / 200}
          />
        </mesh>
      )}
      
      {/* Heat distortion effect */}
      {nodeData.gpu > 50 && (
        <mesh position={[0, 0.1, -0.5]} rotation={[0, 0, 0]}>
          <planeGeometry args={[1.0, 0.4, 24, 24]} />
          <shaderMaterial
            ref={heatRef}
            {...heatShaderMaterial}
            transparent
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

// Front intake airflow (blue particles from floor vents)
function FrontIntakeAirflow({ cooling }: { cooling: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 900;
  const coolingRef = useRef(cooling);

  // Track cooling changes for velocity updates
  coolingRef.current = cooling;

  const particles = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    
    // Pre-distribute particles along the full travel path from vents to rack for immediate continuous stream
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const vent = COLD_AISLE_VENT_TILES[Math.floor(Math.random() * COLD_AISLE_VENT_TILES.length)];
      
      // Distribute particles along the flow path (0 = at vent, 1 = at rack)
      const progress = Math.random();
      const startX = vent.x + (Math.random() - 0.5) * (vent.w * 0.8);
      const startY = -0.55;
      const startZ = vent.z + (Math.random() - 0.5) * (vent.d * 0.8);
      const targetX = 0;
      const targetY = 1.5;
      const targetZ = -0.2;
      
      // Lerp from start to target based on progress
      positions[i3] = startX + (targetX - startX) * progress;
      positions[i3 + 1] = startY + (targetY - startY) * progress;
      positions[i3 + 2] = startZ + (targetZ - startZ) * progress;
      
      // Flow towards rack front centerline, slight upward component
      velocities[i3] = (targetX - positions[i3]) * 0.002;
      velocities[i3 + 1] = 0.002 + (cooling / 100) * 0.004; // Upward from vent
      velocities[i3 + 2] = (targetZ - positions[i3 + 2]) * 0.003; // towards rack front
    }
    
    return { positions, velocities };
  }, []);

  useFrame(() => {
    if (!particlesRef.current) return;
    
    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const velocities = particles.velocities;
    const currentCooling = coolingRef.current;
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Update velocities based on live cooling data
      velocities[i3 + 1] = 0.002 + (currentCooling / 100) * 0.004;
      
      positions[i3] += velocities[i3];
      positions[i3 + 1] += velocities[i3 + 1];
      positions[i3 + 2] += velocities[i3 + 2];
      
      // Reset particles that enter the rack face or rise too high
      if (positions[i3 + 2] < -0.2 || positions[i3 + 1] > 1.5) {
        const vent = COLD_AISLE_VENT_TILES[Math.floor(Math.random() * COLD_AISLE_VENT_TILES.length)];
        positions[i3] = vent.x + (Math.random() - 0.5) * (vent.w * 0.8);
        positions[i3 + 1] = -0.55 + Math.random() * 0.05;
        positions[i3 + 2] = vent.z + (Math.random() - 0.5) * (vent.d * 0.8);
      }
    }
    
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={particles.positions}
          itemSize={3}
          args={[particles.positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.025}
        color="#00aaff"
        transparent
        opacity={0.7}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Rear exhaust airflow (hot air shooting out the back)
function RearExhaustAirflow({ nodes, cooling }: { nodes: NodeData[]; cooling: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 1000;
  
  const avgTemp = nodes.reduce((sum, n) => sum + n.temp, 0) / (nodes.length || 1);
  const isHot = avgTemp > 50;
  const avgTempRef = useRef(avgTemp);
  const coolingRef = useRef(cooling);

  // Track live changes
  avgTempRef.current = avgTemp;
  coolingRef.current = cooling;

  const particles = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    
    // Pre-distribute particles along the full travel path from rack rear to ceiling returns for immediate continuous stream
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Distribute particles along the flow path (0 = at rack rear, 1 = at ceiling)
      const progress = Math.random();
      const nodeHeight = Math.floor(Math.random() * 8) * 0.27 + 0.15; // align with slots
      const startX = (Math.random() - 0.5) * 0.4;
      const startY = nodeHeight;
      const startZ = -0.45;
      const targetX = CEILING_RETURN_GRILLES_X[Math.floor(Math.random() * CEILING_RETURN_GRILLES_X.length)];
      const targetY = 4.8;
      const targetZ = CEILING_RETURN_Z;
      
      // Lerp from start to target based on progress
      positions[i3] = startX + (targetX - startX) * progress;
      positions[i3 + 1] = startY + (targetY - startY) * progress;
      positions[i3 + 2] = startZ + (targetZ - startZ) * progress;
      
      // Exhaust velocity
      velocities[i3] = (targetX - positions[i3]) * 0.0008; // drift towards nearest return
      velocities[i3 + 1] = 0.004 + Math.random() * 0.004 + (cooling / 100) * 0.003; // buoyancy + stronger cooling
      velocities[i3 + 2] = (targetZ - positions[i3 + 2]) * 0.0015; // push toward returns
    }
    
    return { positions, velocities };
  }, []);

  useFrame(() => {
    if (!particlesRef.current) return;
    
    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const velocities = particles.velocities;
    const currentCooling = coolingRef.current;
    const currentIsHot = avgTempRef.current > 50;
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Update velocities based on live cooling and temperature data
      velocities[i3 + 1] = 0.004 + Math.random() * 0.004 + (currentCooling / 100) * 0.003;
      
      positions[i3] += velocities[i3];
      positions[i3 + 1] += velocities[i3 + 1];
      positions[i3 + 2] += velocities[i3 + 2];
      
      // Add volumetric expansion - particles spread outward as they rise (creates plume effect)
      const heightFactor = (positions[i3 + 1] - 0.5) / 4.5; // 0 at rack level, 1 at ceiling
      const expansionRadius = heightFactor * 0.8; // Expands up to 0.8m radius
      const angle = Math.sin(Date.now() * 0.0005 + i) * Math.PI * 2;
      positions[i3] += Math.cos(angle) * expansionRadius * 0.008; // Radial expansion
      positions[i3 + 2] += Math.sin(angle) * expansionRadius * 0.008;
      
      // Add mild turbulence once in hot aisle (reacts to live temperature)
      if (currentIsHot && positions[i3 + 2] < -0.8) {
        positions[i3] += Math.sin(Date.now() * 0.001 + i) * 0.0015;
        positions[i3 + 1] += Math.cos(Date.now() * 0.001 + i) * 0.001;
      }
      
      // Reset particles that reach ceiling or near returns
      if (positions[i3 + 1] > 4.8 || Math.abs(positions[i3 + 2] - CEILING_RETURN_Z) < 0.1) {
        const nodeHeight = Math.floor(Math.random() * 8) * 0.27 + 0.15;
        positions[i3] = (Math.random() - 0.5) * 0.4;
        positions[i3 + 1] = nodeHeight;
        positions[i3 + 2] = -0.45;
      }
    }
    
    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  // Live color update based on temperature
  const exhaustColor = isHot ? '#ff6600' : '#ffaa44';
  const materialRef = useRef<THREE.PointsMaterial>(null);

  // Update material color when temperature changes
  useFrame(() => {
    if (materialRef.current) {
      const targetColor = avgTempRef.current > 50 ? '#ff6600' : '#ffaa44';
      materialRef.current.color.set(targetColor);
    }
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={particles.positions}
          itemSize={3}
          args={[particles.positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        size={0.03}
        color={exhaustColor}
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// (Removed) TemperatureSensors UI

// Main server rack assembly
function ServerRack({ cluster }: { cluster: ClusterData }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [doorOpen, setDoorOpen] = useState(false);

  // Auto-open door after component mounts (smooth entrance effect)
  useMemo(() => {
    const timer = setTimeout(() => setDoorOpen(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Always render 8 slots; fill with real nodes or placeholders
  const slots = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const realNode = cluster.nodes[i];
      if (realNode) return realNode;
      
      // Placeholder for visual consistency - still clickable
      const nodeLabel = `Node ${i + 1}`;
      return {
        id: nodeLabel,
        gpu: 0,
        temp: 20,
        cooling: 0,
        power: 0,
        status: 'idle' as const,
      } as NodeData;
    });
  }, [cluster]);

  // Get live data for selected node (updates automatically when cluster prop changes)
  const selectedNode = selectedNodeId ? slots.find(n => n.id === selectedNodeId) || null : null;

  return (
    <group position={[0, 0, 0]}>
      {/* Rack enclosure with animated door */}
      <RackEnclosure doorOpen={doorOpen} />

      {/* Spotlight on servers to make them visible */}
      <spotLight position={[2, 3, 2]} angle={0.6} penumbra={0.5} intensity={2} castShadow />
      <pointLight position={[0, 1, 1]} intensity={1.5} distance={4} color="#ffffff" />

      {/* 8 GPU Server nodes - always filled slots */}
      {slots.map((node, index) => (
        <ServerNode
          key={node.id}
          position={[0, index * 0.27 + 0.15, 0]}
          nodeData={node}
          onClick={() => setSelectedNodeId(node.id)}
        />
      ))}

      {/* Airflow visualizations - always shown */}
      <FrontIntakeAirflow cooling={cluster.cooling} />
      <RearExhaustAirflow nodes={cluster.nodes} cooling={cluster.cooling} />

      {/* Cluster name and status - raised to avoid clipping with rack */}
      <Text
        position={[0, 2.8, 0]}
        fontSize={0.15}
        color="#00ffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#000000"
      >
        {cluster.name}
      </Text>

      <Text
        position={[0, 2.6, 0]}
        fontSize={0.08}
        color={cluster.status === 'active' ? '#44ff88' : cluster.status === 'optimizing' ? '#ffaa44' : '#666666'}
        anchorX="center"
        anchorY="middle"
      >
        {cluster.status.toUpperCase()}
      </Text>

      {/* Node detail overlay - shows live updating data */}
      {selectedNode && (
        <group position={[2.0, 1.2, 0]}>
          <mesh>
            <planeGeometry args={[1.4, 1.2]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.9} />
          </mesh>
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[1.38, 1.18]} />
            <meshBasicMaterial color="#00ffff" transparent opacity={0.1} />
          </mesh>
          <Text position={[0, 0.5, 0.01]} fontSize={0.09} color="#00ffff" anchorX="center" fontWeight="bold">
            {selectedNode.id}
          </Text>
          <Text position={[-0.6, 0.32, 0.01]} fontSize={0.07} color="#ffffff" anchorX="left">
            GPU Load: {selectedNode.gpu.toFixed(1)}%
          </Text>
          <Text position={[-0.6, 0.2, 0.01]} fontSize={0.07} color="#ffffff" anchorX="left">
            Temperature: {selectedNode.temp.toFixed(1)}°C
          </Text>
          <Text position={[-0.6, 0.08, 0.01]} fontSize={0.07} color="#ffffff" anchorX="left">
            Cooling: {selectedNode.cooling.toFixed(1)}%
          </Text>
          <Text position={[-0.6, -0.04, 0.01]} fontSize={0.07} color="#ffffff" anchorX="left">
            Power: {selectedNode.power.toFixed(1)} kW
          </Text>
          <Text position={[-0.6, -0.16, 0.01]} fontSize={0.07} color="#ffffff" anchorX="left">
            Status: {selectedNode.status}
          </Text>
          <mesh
            position={[0, -0.45, 0.01]}
            onClick={() => setSelectedNodeId(null)}
          >
            <planeGeometry args={[0.5, 0.15]} />
            <meshBasicMaterial color="#ff4444" />
          </mesh>
          <Text position={[0, -0.45, 0.02]} fontSize={0.07} color="#ffffff" anchorX="center">
            CLOSE
          </Text>
        </group>
      )}
    </group>
  );
}

// Main 3D scene
export function DataCenter3D({ cluster, onClose }: DataCenter3DProps) {
  // Calculate average temperature safely, handling empty arrays and invalid values
  const avgTemp = cluster.nodes.length > 0 
    ? cluster.nodes.reduce((sum, n) => sum + (n.temp || 0), 0) / cluster.nodes.length 
    : 0;
  
  return (
    <div style={{ width: '100%', height: '100vh', background: '#000000' }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          padding: '12px 24px',
          background: 'rgba(0, 255, 255, 0.2)',
          border: '1px solid #00ffff',
          color: '#00ffff',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: 'bold',
          borderRadius: '4px',
          backdropFilter: 'blur(10px)',
        }}
      >
        ← BACK TO DASHBOARD
      </button>

      {/* Info panel */}
      <div
        style={{
          position: 'absolute',
          top: '90px',
          left: '20px',
          zIndex: 1000,
          padding: '20px',
          background: 'rgba(0, 0, 0, 0.85)',
          border: '1px solid #00ffff',
          color: '#ffffff',
          borderRadius: '4px',
          backdropFilter: 'blur(10px)',
          maxWidth: '320px',
        }}
      >
        <h2 style={{ margin: '0 0 5px 0', color: '#00ffff', fontSize: '20px' }}>
          🏢 {cluster.name}
        </h2>
        {cluster.site && (
          <div style={{ margin: '0 0 15px 0', color: '#888888', fontSize: '13px' }}>
            📍 {cluster.site}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
          <div>
            <div style={{ color: '#888888', fontSize: '11px', marginBottom: '4px' }}>AVG GPU</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#00ffff' }}>{cluster.gpu.toFixed(1)}%</div>
          </div>
          <div>
            <div style={{ color: '#888888', fontSize: '11px', marginBottom: '4px' }}>COOLING</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#44ff88' }}>{cluster.cooling.toFixed(1)}%</div>
          </div>
          <div>
            <div style={{ color: '#888888', fontSize: '11px', marginBottom: '4px' }}>AVG TEMP</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: avgTemp > 50 ? '#ff4444' : '#ffaa44' }}>{avgTemp.toFixed(1)}°C</div>
          </div>
          <div>
            <div style={{ color: '#888888', fontSize: '11px', marginBottom: '4px' }}>POWER</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff6600' }}>{cluster.power.toFixed(0)} kW</div>
          </div>
        </div>
        
        <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #333333' }}>
          <div style={{ fontSize: '12px', color: '#aaaaaa', marginBottom: '8px' }}>
            <strong style={{ color: '#00ffff' }}>💡 Controls:</strong>
          </div>
          <div style={{ fontSize: '11px', color: '#888888', lineHeight: '1.6' }}>
            • <strong>Left drag:</strong> Rotate camera<br />
            • <strong>Right drag:</strong> Pan view<br />
            • <strong>Scroll:</strong> Zoom in/out<br />
            • <strong>Click node:</strong> View details
          </div>
        </div>
        
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #333333' }}>
          <div style={{ fontSize: '12px', color: '#aaaaaa', marginBottom: '8px' }}>
            <strong style={{ color: '#00ffff' }}>💨 Airflow Visualization:</strong>
          </div>
          <div style={{ fontSize: '11px', color: '#888888', lineHeight: '1.6' }}>
            • <span style={{ color: '#00aaff' }}>■</span> Blue particles = Cold intake (front)<br />
            • <span style={{ color: '#ff6600' }}>■</span> Orange particles = Hot exhaust (rear)<br />
            • Particle speed = Cooling intensity
          </div>
        </div>
      </div>

      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[4, 2.5, 4]} fov={60} />
        <OrbitControls 
          enableDamping
          dampingFactor={0.05}
          minDistance={2}
          maxDistance={12}
          maxPolarAngle={Math.PI / 2.1}
          target={[0, 1.1, 0]}
        />
        
        {/* Lighting */}
        <ambientLight intensity={0.3} />
        <pointLight position={[3, 4, 3]} intensity={1.5} castShadow color="#ffffff" />
        <pointLight position={[-3, 3, -2]} intensity={0.8} color="#0088ff" />
        <spotLight
          position={[0, 5, 2]}
          angle={0.5}
          penumbra={0.5}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        
        {/* Rim light from behind */}
        <pointLight position={[0, 2, -4]} intensity={0.6} color="#ff6600" />

        {/* Environment */}
        <Environment preset="warehouse" />
        
        {/* Server room */}
        <ServerRoom />
        
        {/* Floor */}
        <DataCenterFloor />
        
        {/* Server rack */}
        <ServerRack cluster={cluster} />
        
        {/* Fog for depth */}
        <fog attach="fog" args={['#000000', 8, 20]} />
      </Canvas>
    </div>
  );
}
