import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text, Environment } from '@react-three/drei';
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
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 14]} />
        <meshStandardMaterial 
          color="#1a1a1a"
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>
      
      {/* Floor tiles grid — reduced count */}
      {Array.from({ length: 5 }).map((_, x) =>
        Array.from({ length: 4 }).map((_, z) => (
          <mesh
            key={`tile-${x}-${z}`}
            position={[x * 4 - 8, 0.01, z * 3 - 5]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[3.8, 2.8]} />
            <meshStandardMaterial
              color="#0a0a0a"
              metalness={0.3}
              roughness={0.7}
            />
          </mesh>
        ))
      )}
    </group>
  );
}

// Server room walls and ceiling
function ServerRoom() {
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 2, -7]}>
        <boxGeometry args={[20, 6, 0.2]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Azure logo on back wall */}
      <group position={[0, 3.5, -6.88]}>
        {/* Logo background panel */}
        <mesh>
          <planeGeometry args={[3.2, 1.2]} />
          <meshStandardMaterial color="#0f1520" metalness={0.3} roughness={0.7} />
        </mesh>
        {/* Azure icon — simplified geometric mark */}
        <group position={[-0.9, 0, 0.01]}>
          {/* Azure triangle shape (left piece) */}
          <mesh position={[-0.12, 0.05, 0]} rotation={[0, 0, 0.15]}>
            <boxGeometry args={[0.28, 0.38, 0.02]} />
            <meshStandardMaterial color="#0078D4" emissive="#0078D4" emissiveIntensity={0.6} />
          </mesh>
          {/* Azure triangle shape (right piece) */}
          <mesh position={[0.15, -0.08, 0]} rotation={[0, 0, -0.1]}>
            <boxGeometry args={[0.22, 0.28, 0.02]} />
            <meshStandardMaterial color="#50E6FF" emissive="#50E6FF" emissiveIntensity={0.4} />
          </mesh>
        </group>
        <Text position={[0.15, 0.05, 0.01]} fontSize={0.28} color="#50E6FF" anchorX="left" fontWeight="bold">
          Microsoft
        </Text>
        <Text position={[0.15, -0.25, 0.01]} fontSize={0.16} color="#0078D4" anchorX="left">
          Azure
        </Text>
      </group>
      
      {/* Left wall */}
      <mesh position={[-10, 2, -1]}>
        <boxGeometry args={[0.2, 6, 12]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>
      
      {/* Right wall with CRAC unit indication */}
      <mesh position={[10, 2, -1]}>
        <boxGeometry args={[0.2, 6, 12]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.1} roughness={0.9} />
      </mesh>
      
      {/* CRAC Units (Computer Room Air Conditioning) on right wall — two units */}
      {[-3, 1].map((zPos, cIdx) => (
        <group key={`crac-${cIdx}`} position={[9.8, 1.5, zPos]}>
          <mesh>
            <boxGeometry args={[0.2, 0.8, 0.8]} />
            <meshStandardMaterial color="#2a2a3e" metalness={0.6} roughness={0.4} />
          </mesh>
          <Text position={[0.11, 0, 0]} fontSize={0.06} color="#00aa00" rotation={[0, -Math.PI / 2, 0]}>
            CRAC {cIdx + 1}
          </Text>
          {/* Status LED */}
          <mesh position={[0.11, 0.3, 0]}>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial color="#00aa00" emissive="#00aa00" emissiveIntensity={1} />
          </mesh>
        </group>
      ))}
      
      {/* Ceiling */}
      <mesh position={[0, 5, -1]}>
        <boxGeometry args={[20, 0.2, 12]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.2} roughness={0.8} />
      </mesh>
      
      {/* Cable trays running along ceiling (one per row) */}
      {[-3.5, 3.5].map((xPos, idx) => (
        <mesh key={`cable-tray-${idx}`} position={[xPos, 4.7, -1]} castShadow>
          <boxGeometry args={[0.4, 0.1, 10]} />
          <meshStandardMaterial color="#444444" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      
      {/* Emergency lights */}
      {[-5, 5].map((xPos, idx) => (
        <group key={`exit-${idx}`} position={[xPos, 4.8, 4]}>
          <mesh>
            <boxGeometry args={[0.3, 0.1, 0.15]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={0.2} />
          </mesh>
          <Text position={[0, -0.1, 0]} fontSize={0.05} color="#ffffff">
            EXIT
          </Text>
        </group>
      ))}
      
      {/* Ceiling vents for exhaust — spread across wider room */}
      {[-6, -3, 0, 3, 6].map((xPos, idx) => (
        <mesh key={`ceiling-vent-${idx}`} position={[xPos, 4.9, -2]} rotation={[0, 0, 0]}>
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

  useFrame(() => {
    if (doorRef.current) {
      const targetRotation = doorOpen ? -Math.PI * 0.7 : 0;
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
        <mesh key={`post-${idx}`} position={pos as [number, number, number]}>
          <boxGeometry args={[0.05, 2.2, 0.05]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
      
      {/* Front glass door (animated) */}
      <group ref={doorRef} position={[-0.5, 1.1, 0.42]}>
        <mesh position={[0.5, 0, 0]}>
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
        <mesh position={[0.9, 0, 0.01]}>
          <boxGeometry args={[0.03, 0.15, 0.02]} />
          <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
      
      {/* Back door (solid) */}
      <mesh position={[0, 1.1, -0.42]}>
        <boxGeometry args={[1.0, 2.15, 0.02]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Side panels */}
      <mesh position={[-0.52, 1.1, 0]}>
        <boxGeometry args={[0.02, 2.15, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.52, 1.1, 0]}>
        <boxGeometry args={[0.02, 2.15, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Top panel */}
      <mesh position={[0, 2.18, 0]}>
        <boxGeometry args={[1.04, 0.02, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* Bottom panel */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[1.04, 0.02, 0.84]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
      </mesh>
      
      {/* PDU on side */}
      <mesh position={[-0.54, 1.1, 0.3]}>
        <boxGeometry args={[0.04, 1.8, 0.08]} />
        <meshStandardMaterial color="#ff4444" emissive="#ff4444" emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

// Individual server node (optimized — fewer meshes, no per-node shader)
function ServerNode({ 
  position, 
  nodeData, 
  onClick 
}: { 
  position: [number, number, number]; 
  nodeData: NodeData;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  
  const nodeColor = useMemo(() => {
    if (nodeData.status === 'offline') return '#1a1a1a';
    if (nodeData.gpu > 75) return '#ff4444';
    if (nodeData.gpu > 30) return '#44ff88';
    return '#666666';
  }, [nodeData.gpu, nodeData.status]);

  return (
    <group position={position}>
      {/* Main server chassis */}
      <mesh
        onClick={onClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? [1.02, 1.02, 1.02] : [1, 1, 1]}
      >
        <boxGeometry args={[0.9, 0.12, 0.7]} />
        <meshStandardMaterial 
          color="#2b2f35"
          metalness={0.7}
          roughness={0.45}
        />
      </mesh>
      
      {/* Front panel */}
      <mesh position={[0, 0, 0.36]}>
        <boxGeometry args={[0.88, 0.10, 0.01]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Status LED strip (single mesh instead of 5 individual LEDs) */}
      {nodeData.status !== 'offline' && (
        <mesh position={[-0.15, 0, 0.37]}>
          <boxGeometry args={[0.35, 0.06, 0.005]} />
          <meshStandardMaterial 
            color={nodeColor}
            emissive={nodeColor}
            emissiveIntensity={2}
          />
        </mesh>
      )}
      
      {/* Power LED */}
      <mesh position={[0.38, 0, 0.37]}>
        <boxGeometry args={[0.03, 0.03, 0.005]} />
        <meshStandardMaterial 
          color="#00ff00"
          emissive="#00ff00"
          emissiveIntensity={nodeData.status === 'offline' ? 0 : 2}
        />
      </mesh>
      
      {/* Rear panel */}
      <mesh position={[0, 0, -0.36]}>
        <boxGeometry args={[0.88, 0.10, 0.01]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.5} roughness={0.5} />
      </mesh>
      
      {/* Heat glow (simple emissive bar instead of shader) */}
      {nodeData.gpu > 50 && (
        <mesh position={[0, 0, -0.37]}>
          <boxGeometry args={[0.5, 0.06, 0.005]} />
          <meshStandardMaterial 
            color="#ff6600"
            emissive="#ff6600"
            emissiveIntensity={nodeData.gpu / 150}
          />
        </mesh>
      )}
    </group>
  );
}

// Front intake airflow (blue particles from floor vents)
function FrontIntakeAirflow({ cooling }: { cooling: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 300;
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
  const particleCount = 350;
  
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

      <Canvas shadows={false} dpr={[1, 1.5]} performance={{ min: 0.5 }}>
        <PerspectiveCamera makeDefault position={[10, 5, 8]} fov={60} />
        <OrbitControls 
          enableDamping
          dampingFactor={0.05}
          minDistance={3}
          maxDistance={20}
          maxPolarAngle={Math.PI / 2.1}
          target={[0, 1.1, -2]}
        />
        
        {/* Lighting — simplified for performance */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[6, 5, 4]} intensity={1.2} color="#ffffff" />
        <pointLight position={[-6, 3, -3]} intensity={0.6} color="#0088ff" />
        <pointLight position={[0, 2, -6]} intensity={0.4} color="#ff6600" />

        {/* Environment */}
        <Environment preset="warehouse" />
        
        {/* Server room */}
        <ServerRoom />
        
        {/* Floor */}
        <DataCenterFloor />
        
        {/* 6 Server racks in two facing rows (cold aisle / hot aisle layout)
            Front row: 3 racks at z=0, facing toward viewer (front = +z)
            Back row:  3 racks at z=-4, rotated 180° to face the front row
            This creates a cold aisle between the two rows */}
        {/* Front row — racks face forward */}
        {[-5, 0, 5].map((xPos, idx) => (
          <group key={`rack-front-${idx}`} position={[xPos, 0, 0]}>
            <ServerRack cluster={cluster} />
          </group>
        ))}
        {/* Back row — racks rotated 180° to face front row (hot aisles face outward) */}
        {[-5, 0, 5].map((xPos, idx) => (
          <group key={`rack-back-${idx}`} position={[xPos, 0, -4]} rotation={[0, Math.PI, 0]}>
            <ServerRack cluster={cluster} />
          </group>
        ))}
        
        {/* Fog for depth */}
        <fog attach="fog" args={['#000000', 12, 28]} />
      </Canvas>
    </div>
  );
}
