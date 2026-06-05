import { useState, useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import type { Message, ConnectionState } from '../types';
import { useStore } from '../store/index';

interface ChatPanelProps {
    connectionState: ConnectionState;
    onSendMessage: (text: string) => void;
    onSendClarificationAnswer: (answer: string) => void;
}

export function ChatPanel({ connectionState, onSendMessage, onSendClarificationAnswer }: ChatPanelProps) {
    const { messages, uiState, pendingClarification } = useStore();
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Scroll automático al último mensaje
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, pendingClarification]);

    // S7.4 — mientras hay clarificación pendiente, el input envía la RESPUESTA
    // (texto libre); las opciones cerradas se muestran como botones.
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim()) return;
        if (uiState === 'awaiting_clarification') {
            onSendClarificationAnswer(inputValue);
        } else {
            onSendMessage(inputValue);
        }
        setInputValue('');
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
                {uiState === 'error' && <p>Error: Ha ocurrido un error</p>}
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
                {/* S7.4 — opciones de la clarificación como botones */}
                {uiState === 'awaiting_clarification' && pendingClarification && pendingClarification.options.length > 0 && (
                    <div className="flex flex-wrap gap-2 m-2">
                        {pendingClarification.options.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => onSendClarificationAnswer(option)}
                                className="px-3 py-1 border border-blue-600 text-blue-600 rounded-full hover:bg-blue-50"
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                )}
                <div ref={messagesEndRef} />
                {uiState === 'generating' && <span>Generando...</span>}
            </div>

            {/* Input y botón */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-300">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={uiState === 'awaiting_clarification' ? 'Responde a la pregunta del agente...' : 'Escribe un mensaje...'}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={connectionState !== 'connected' ||  uiState === 'generating'}
                    />
                    <button
                        type="submit"
                        disabled={connectionState !== 'connected' || uiState === 'generating'}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        Enviar
                    </button>
                </div>
            </form>
        </div>
    );
}
