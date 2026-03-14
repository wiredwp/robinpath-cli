import React from 'react';
import { Box, Text } from 'ink';

interface BannerProps {
    version: string;
}

export function Banner({ version }: BannerProps) {
    return (
        <Box flexDirection="column" marginBottom={1} marginTop={1}>
            <Text>
                <Text bold color="cyan">{'  ◆ '}</Text>
                <Text bold>RobinPath</Text>
                <Text dimColor> v{version}</Text>
            </Text>
        </Box>
    );
}
