import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { Banner } from './Banner';
import { InputBox } from './InputBox';
import { ChatMessage } from './ChatMessage';
import { Spinner } from './Spinner';

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface AppProps {
    model: string;
    mode: string;
    dir: string;
    shell: string;
    projectInfo?: string;
    onMessage: (message: string) => Promise<void>;
    initialPrompt?: string | null;
}

export function App({ model, mode, dir, shell, projectInfo, onMessage, initialPrompt }: AppProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const { exit } = useApp();

    // Expose state setters for the REPL engine to use
    (global as any).__rpUI = {
        addMessage: (msg: Message) => setMessages(prev => [...prev, msg]),
        setLoading: (v: boolean) => setIsLoading(v),
        setStreaming: (v: string) => setStreamingContent(v),
        clearMessages: () => setMessages([]),
        getMessages: () => messages,
        exit: () => exit(),
    };

    const handleSubmit = useCallback(async (value: string) => {
        setMessages(prev => [...prev, { role: 'user', content: value }]);
        setIsLoading(true);
        setStreamingContent('');

        try {
            await onMessage(value);
        } finally {
            setIsLoading(false);
            setStreamingContent('');
        }
    }, [onMessage]);

    // Handle initial prompt
    useEffect(() => {
        if (initialPrompt) {
            handleSubmit(initialPrompt);
        }
    }, []);

    return (
        <Box flexDirection="column">
            <Banner model={model} mode={mode} dir={dir} shell={shell} projectInfo={projectInfo} />

            {/* Chat messages */}
            {messages.map((msg, i) => (
                <ChatMessage key={i} role={msg.role} content={msg.content} />
            ))}

            {/* Streaming response */}
            {isLoading && streamingContent && (
                <ChatMessage role="assistant" content={streamingContent} isStreaming />
            )}

            {/* Spinner */}
            {isLoading && !streamingContent && (
                <Spinner />
            )}

            {/* Input */}
            <InputBox
                placeholder="What do you want to automate today?"
                onSubmit={handleSubmit}
                isLoading={isLoading}
            />
        </Box>
    );
}
