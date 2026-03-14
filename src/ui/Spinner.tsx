import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
    label?: string;
}

export function Spinner({ label = 'Thinking' }: SpinnerProps) {
    return (
        <Box paddingX={2} paddingLeft={4} marginBottom={1}>
            <Text dimColor>
                <InkSpinner type="dots" />
                {' '}{label}
            </Text>
        </Box>
    );
}
