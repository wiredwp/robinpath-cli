import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
    model: string;
    shell: string;
    mode: string;
    cost?: number;
    tokens?: number;
}

export function StatusBar({ model, shell, mode, cost = 0, tokens = 0 }: StatusBarProps) {
    return (
        <Box paddingX={2} marginTop={0}>
            <Text dimColor>
                {model}
                <Text> · </Text>
                {shell}
                <Text> · </Text>
                {mode}
                {tokens > 0 && <Text> · {tokens.toLocaleString()} tokens</Text>}
                {cost > 0 && <Text> · ${cost.toFixed(4)}</Text>}
            </Text>
        </Box>
    );
}
