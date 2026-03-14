import React, { useState, useCallback } from 'react';
import { Box, Static, Text } from 'ink';
import { Banner } from './Banner';
import { InputBox } from './InputBox';
import { ChatMessage } from './ChatMessage';
import { Spinner } from './Spinner';

export interface AppMessage {
    id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface AppProps {
    model: string;
    mode: string;
    dir: string;
    shell: string;
    projectInfo?: string;
    onSubmit: (text: string) => Promise<string | null>;
}

let msgId = 0;

export function App({ model, mode, dir, shell, projectInfo, onSubmit }: AppProps) {
    const [messages, setMessages] = useState<AppMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [streamText, setStreamText] = useState('');
    const [spinnerLabel, setSpinnerLabel] = useState('Thinking...');

    // Expose setters for external code to drive the UI
    const ui = (global as any).__rpUI = (global as any).__rpUI || {};
    ui.setStreamText = setStreamText;
    ui.setSpinnerLabel = setSpinnerLabel;
    ui.setLoading = setIsLoading;
    ui.addMessage = (role: 'user' | 'assistant' | 'system', content: string) => {
        setMessages(prev => [...prev, { id: ++msgId, role, content }]);
    };

    const handleSubmit = useCallback(async (text: string) => {
        // Add user message
        setMessages(prev => [...prev, { id: ++msgId, role: 'user', content: text }]);
        setIsLoading(true);
        setStreamText('');
        setSpinnerLabel('Thinking...');

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
            <Banner model={model} mode={mode} dir={dir} shell={shell} projectInfo={projectInfo} />

            {/* Completed messages — Static prevents re-rendering */}
            <Static items={messages}>
                {(msg) => (
                    <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
                )}
            </Static>

            {/* Streaming response */}
            {isLoading && streamText ? (
                <ChatMessage role="assistant" content={streamText} isStreaming />
            ) : null}

            {/* Spinner */}
            {isLoading && !streamText ? (
                <Box marginBottom={1}>
                    <Spinner label={spinnerLabel} />
                </Box>
            ) : null}

            {/* Input box */}
            <InputBox
                onSubmit={handleSubmit}
                isActive={!isLoading}
                placeholder={messages.length === 0 ? 'What do you want to automate today?' : 'Type a message...'}
            />
        </Box>
    );
}
