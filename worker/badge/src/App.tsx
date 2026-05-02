import { Canvas } from '@react-three/fiber';
import { Band } from './Band';

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

export function App({ agentData }: { agentData: AgentData }) {
  return (
    <Canvas camera={{ position: [0, 0, 13], fov: 25 }}>
      <color attach="background" args={['black']} />
      <ambientLight intensity={Math.PI} />
      <directionalLight position={[-3, 4, 8]} intensity={3.5} />
      <directionalLight position={[4, -2, 6]} intensity={1.5} />
      <pointLight position={[0, 3, 4]} intensity={8} />
      <Band agentData={agentData} />
    </Canvas>
  );
}
