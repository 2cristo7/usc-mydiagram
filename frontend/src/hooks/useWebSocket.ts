import { useState, useEffect, useRef } from "react";
import type { Message, ConnectionState } from "../types";

export function useWebSocket(url: string = 'ws://localhost:3001') {
    const [messages, setMessages] = useState<Message[]>([]);
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldReconnectRef = useRef(true);

    useEffect(() => {
        shouldReconnectRef.current = true;

        const connectWebSocket = () => {
            try {
                const ws = new WebSocket(url);
                socketRef.current = ws;

                ws.onopen = () => {
                    setConnectionState('connected');
                    console.log("WebSocket connected");
                    // Limpiar timeout de reconexión si existía
                    if (reconnectTimeoutRef.current) {
                        clearTimeout(reconnectTimeoutRef.current);
                        reconnectTimeoutRef.current = null;
                    }
                };

                ws.onmessage = (event) => {
                    const receivedMessage: Message = {
                        id: crypto.randomUUID(),
                        text: event.data,
                        sender: 'system',
                        timestamp: new Date(),
                    };
                    setMessages((prev) => [...prev, receivedMessage]);
                };

                ws.onclose = () => {
                    setConnectionState('disconnected');
                    if (shouldReconnectRef.current) {
                        console.log("WebSocket disconnected, attempting reconnection in 3s...");
                        reconnectTimeoutRef.current = setTimeout(() => {
                            connectWebSocket();
                        }, 3000);
                    }
                };

                ws.onerror = (error) => {
                    setConnectionState('error');
                    console.error("WebSocket error:", error);
                };
            } catch (error) {
                setConnectionState('error');
                console.error("Failed to create WebSocket:", error);
            }
        };

        connectWebSocket();

        return () => {
            shouldReconnectRef.current = false;
            if (socketRef.current) {
                socketRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };
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
        setMessages((prev) => [...prev, userMessage]);

        // Enviar por WebSocket si está abierto
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(text);
        } else {
            console.warn("WebSocket is not open. Message queued but not sent.");
        }
    };

    return { messages, connectionState, sendMessage };
}

