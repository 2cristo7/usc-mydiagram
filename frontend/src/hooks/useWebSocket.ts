import { useState, useEffect, useRef } from "react";
import type { Message, ConnectionState} from "../types";
import { io, Socket } from "socket.io-client";
import { useStore } from "../store/index";

export function useWebSocket(url: string = 'ws://localhost:3001') {
    const { addNode, addEdge, addMessage, setUiState } = useStore();
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const socketRef = useRef<Socket | null>(null);


    useEffect(() => {

        try {
            socketRef.current = io('http://localhost:3001', { transports: ['websocket'] });
            const socket = socketRef.current;

            socket.on('connect', () => {
                setConnectionState('connected');
                console.log("WebSocket connected");
            });

            socket.on('diagram:node_ready', (node) => {
                addNode(node);
            });

            socket.on('diagram:edge_ready', (edge) => {
                addEdge(edge);
            });

            socket.on('diagram:done', (data) => {
                addMessage({
                    id: crypto.randomUUID(),
                    text: `Diagrama generado: ${data?.title ?? 'sin título'}`,
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('ready');
            });

            socket.on('diagram:error', (data) => {
                addMessage({
                    id: crypto.randomUUID(),
                    text: data?.error ?? 'Error generando el diagrama',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('error');
            });

            socket.on('disconnect', () => {
                setConnectionState('disconnected');
                addMessage({
                    id: crypto.randomUUID(),
                    text: 'Conexión perdida durante la generación. Inténtalo de nuevo.',
                    sender: 'system',
                    timestamp: new Date(),
                });
                setUiState('error');
            });

            socket.on('connect_error', (error) => {
                setConnectionState('error');
                setUiState('error');
                console.error("WebSocket error:", error);
            });
        } catch (error) {
            setConnectionState('error');
            setUiState('error');
            console.error("Failed to create WebSocket:", error);
        }

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        }
    }, [url]);

    const sendMessage = (text: string) => {
        if (!text.trim()) return;

        // Añadir mensaje del usuario al estado
        const userMessage: Message = {
            id: crypto.randomUUID(),
            text,
            sender: 'user',
            timestamp: new Date(),
        };
        addMessage(userMessage);

        socketRef.current?.emit('message:send', text);
        setUiState('generating');
    };

    return {connectionState, sendMessage };
}

