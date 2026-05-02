/**
 * 3D Card visualization — standalone credit-card-style agent card
 * No physics engine — just mouse-follow tilt and click-to-flip
 */

import { Canvas } from '@react-three/fiber';
import { CardScene } from './CardScene';

interface AgentData {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  provider?: {
    organization: string;
    url?: string;
  };
  iconUrl?: string;
}

export function CardApp({ agentData }: { agentData: AgentData }) {
  return (
    <Canvas camera={{ position: [0, 0, 8.7], fov: 35 }}>
      <color attach="background" args={['black']} />
      <ambientLight intensity={Math.PI} />
      <directionalLight position={[-3, 4, 8]} intensity={3.5} />
      <directionalLight position={[4, -2, 6]} intensity={1.5} />
      <pointLight position={[0, 3, 4]} intensity={8} />
      <CardScene agentData={agentData} />
    </Canvas>
  );
}
