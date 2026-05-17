import { useState, useEffect, useRef } from "react";
import { type Message, type ConnectionState, type DiagramSchema} from "../types";
import { io, Socket } from "socket.io-client";

export function useWebSocket(url: string = 'ws://localhost:3001') {
    const [messages, setMessages] = useState<Message[]>([]);
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const socketRef = useRef<Socket | null>(null);
    const [currentDiagram, setCurrentDiagram] = useState<DiagramSchema | null>(null);


    useEffect(() => {

        try {
            socketRef.current = io('http://localhost:3001');
            const socket = socketRef.current;

            socket.on('connect', () => {
                setConnectionState('connected');
                console.log("WebSocket connected");
            });

            socket.on('diagram:done', (data) => {
                try {
                    if (data.diagram) {
                        setCurrentDiagram(data.diagram);
                        const receivedMessage: Message = { 
                            id: crypto.randomUUID(),
                            text: `Diagrama generado: ${data.diagram.title}`,
                            sender: 'system',
                            timestamp: new Date(),
                            };
                            console.log("Diagrama recibido del servidor:", data.diagram);
                        setMessages((prev) => [...prev, receivedMessage]);
                    } else if (data.error) {
                        console.error("Error received from server:", data.error);
                        const receivedMessage: Message = { 
                            id: crypto.randomUUID(),
                            text: `Error: ${data.error}`,
                            sender: 'system',
                            timestamp: new Date(),
                            };
                        setMessages((prev) => [...prev, receivedMessage]);
                        return;
                    }
                } catch (e) {
                    const receivedMessage: Message = { 
                        id: crypto.randomUUID(),
                        text: 'Error al procesar el mensaje del servidor',
                        sender: 'system',
                        timestamp: new Date(),
                        };
                    console.error("Error processing server message:", e);
                    setMessages((prev) => [...prev, receivedMessage]);
                }
            });

            socket.on('disconnect', () => {
                setConnectionState('disconnected');
                console.log("WebSocket disconnected");
            });

            socket.on('connect_error', (error) => {
                setConnectionState('error');
                console.error("WebSocket error:", error);
            });
        } catch (error) {
            setConnectionState('error');
            console.error("Failed to create WebSocket:", error);
        }

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                console.log("WebSocket disconnected on cleanup");
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
        setMessages((prev) => [...prev, userMessage]);

        socketRef.current?.emit('message:send', text);
    };

    return { currentDiagram, messages, connectionState, sendMessage };
}

