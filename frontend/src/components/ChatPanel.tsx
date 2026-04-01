import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import type { Message, ConnectionState } from '../types';

interface ChatPanelProps {
    messages: Message[];
    connectionState: ConnectionState;
    onSendMessage: (text: string) => void;
}

export function ChatPanel({ messages, connectionState, onSendMessage }: ChatPanelProps) {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Scroll automático al último mensaje
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (inputValue.trim()) {
            onSendMessage(inputValue);
            setInputValue('');
        }
    };

    const getConnectionStatusText = (): string => {
        switch (connectionState) {
            case 'connecting':
                return 'Conectando...';
            case 'connected':
                return 'Conectado';
            case 'disconnected':
                return 'Desconectado';
            case 'error':
                return 'Error';
            default:
                return 'Desconocido';
        }
    };

    const getConnectionStatusColor = (): string => {
        switch (connectionState) {
            case 'connecting':
                return 'text-yellow-600';
            case 'connected':
                return 'text-green-600';
            case 'disconnected':
                return 'text-red-600';
            case 'error':
                return 'text-red-800';
            default:
                return 'text-gray-600';
        }
    };

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-300">
            {/* Header con indicador de estado */}
            <div className="p-4 border-b border-gray-300">
                <h2 className="text-lg font-bold">Chat</h2>
                <p className={`text-sm ${getConnectionStatusColor()}`}>
                    {getConnectionStatusText()}
                </p>
            </div>

            {/* Lista de mensajes */}
            <div className="flex-1 overflow-y-auto p-4">
                {messages.length === 0 && (
                    <p className="text-gray-500 text-center">Sin mensajes aún</p>
                )}
                {messages.map((msg) => (
                    <ChatMessage
                        key={msg.id}
                        text={msg.text}
                        sender={msg.sender}
                        timestamp={msg.timestamp}
                    />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input y botón */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-300">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Escribe un mensaje..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={connectionState !== 'connected'}
                    />
                    <button
                        type="submit"
                        disabled={connectionState !== 'connected'}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        Enviar
                    </button>
                </div>
            </form>
        </div>
    );
}
