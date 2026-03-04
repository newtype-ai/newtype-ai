import { createRoot } from 'react-dom/client';
import { CardApp } from './CardApp';

declare global {
  interface Window {
    __AGENT_DATA__: {
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
    };
  }
}

const agentData = window.__AGENT_DATA__;

if (agentData) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<CardApp agentData={agentData} />);
}
