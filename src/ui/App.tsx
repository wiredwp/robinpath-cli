import React, { useState, useCallback } from 'react';
import { Box, Static, Text } from 'ink';
import { Banner } from './Banner';
import { StatusBar } from './StatusBar';
import { InputBox } from './InputBox';
import { ChatMessage } from './ChatMessage';
import { Spinner } from './Spinner';

export interface AppMessage {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface AppProps {
    version: string;
    model: string;
    mode: string;
    dir: string;
    shell: string;
    onSubmit: (text: string) => Promise<string | null>;
}

let msgId = 0;

export function App({ version, model, mode, dir, shell, onSubmit }: AppProps) {
    const [messages, setMessages] = useState<AppMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [streamText, setStreamText] = useState('');
    const [spinnerLabel, setSpinnerLabel] = useState('Thinking');
    const [totalTokens, setTotalTokens] = useState(0);
    const [totalCost, setTotalCost] = useState(0);

    // Expose UI control for the REPL engine
    const ui = (global as any).__rpUI = (global as any).__rpUI || {};
    ui.setStreamText = setStreamText;
    ui.setSpinnerLabel = setSpinnerLabel;
    ui.setLoading = setIsLoading;
    ui.setTokens = setTotalTokens;
    ui.setCost = setTotalCost;
    ui.addMessage = (role: 'user' | 'assistant' | 'system', content: string) => {
        setMessages(prev => [...prev, { id: ++msgId, role, content }]);
    };

    const handleSubmit = useCallback(async (text: string) => {
        setMessages(prev => [...prev, { id: ++msgId, role: 'user', content: text }]);
        setIsLoading(true);
        setStreamText('');
        setSpinnerLabel('Thinking');

        try {
            const response = await onSubmit(text);
            if (response) {
                setMessages(prev => [...prev, { id: ++msgId, role: 'assistant', content: response }]);
            }
        } catch (err: any) {
            setMessages(prev => [...prev, { id: ++msgId, role: 'assistant', content: `Error: ${err.message}` }]);
        } finally {
            setIsLoading(false);
            setStreamText('');
        }
    }, [onSubmit]);

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Banner version={version} />

            {/* Completed messages */}
            <Static items={messages}>
                {(msg) => (
                    <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
                )}
            </Static>

            {/* Streaming */}
            {isLoading && streamText ? (
                <ChatMessage role="assistant" content={streamText} isStreaming />
            ) : null}

            {/* Loading */}
            {isLoading && !streamText ? <Spinner label={spinnerLabel} /> : null}

            {/* Input */}
            <InputBox
                onSubmit={handleSubmit}
                isActive={!isLoading}
                placeholder={messages.length === 0 ? 'What do you want to automate?' : 'Ask anything...'}
            />

            {/* Status bar */}
            <StatusBar
                model={model}
                shell={shell}
                mode={mode}
                tokens={totalTokens}
                cost={totalCost}
            />
        </Box>
    );
}
