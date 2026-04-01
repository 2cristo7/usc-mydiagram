export interface Message {
    id: string;
    text: string;
    sender: 'user' | 'system';
    timestamp: Date;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
