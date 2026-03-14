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
            <Box marginBottom={1}>
                <Text bold color="cyan">❯ </Text>
                <Text>{content}</Text>
            </Box>
        );
    }

    // Assistant message
    return (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
            <Text>{content}{isStreaming ? <Text color="cyan">▎</Text> : null}</Text>
        </Box>
    );
}
