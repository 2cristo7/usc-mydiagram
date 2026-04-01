interface ChatMessageProps {
    text: string;
    sender: 'user' | 'system';
    timestamp: Date;
}

export function ChatMessage({ text, sender, timestamp }: ChatMessageProps) {
    const timeString = timestamp.toLocaleTimeString();

    const containerClass = sender === 'user'
        ? 'flex justify-end'
        : 'flex justify-start';

    const messageClass = sender === 'user'
        ? 'bg-blue-600 text-white'
        : 'bg-gray-300 text-gray-900';

    return (
        <div className={`${containerClass} m-2`}>
            <div className={`rounded-lg p-3 max-w-xs ${messageClass}`}>
                <p className="break-words">{text}</p>
                <span className="text-sm opacity-70">{timeString}</span>
            </div>
        </div>
    );
}
