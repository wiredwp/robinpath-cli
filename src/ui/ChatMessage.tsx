import React from 'react';
import { Box, Text } from 'ink';

interface ChatMessageProps {
    role: 'user' | 'assistant' | 'system';
    content: string;
    isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming = false }: ChatMessageProps) {
    if (role === 'system') return null;

    if (role === 'user') {
        return (
            <Box paddingX={2} marginBottom={0}>
                <Text>
                    <Text color="cyan" bold>{'❯ '}</Text>
                    <Text bold>{content}</Text>
                </Text>
            </Box>
        );
    }

    // Assistant
    return (
        <Box flexDirection="column" paddingX={2} paddingLeft={4} marginBottom={1}>
            <Text wrap="wrap">
                {content}
                {isStreaming ? <Text color="cyan">{'▍'}</Text> : null}
            </Text>
        </Box>
    );
}
