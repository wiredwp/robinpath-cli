import React from 'react';
import { Box, Text } from 'ink';

interface BannerProps {
    model: string;
    mode: string;
    dir: string;
    shell: string;
    projectInfo?: string;
}

export function Banner({ model, mode, dir, shell, projectInfo }: BannerProps) {
    const modeColor = mode === 'confirm' ? 'green' : 'yellow';

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box borderStyle="round" flexDirection="column" paddingX={1}>
                <Text bold> RobinPath AI</Text>
                <Text>  Model: <Text color="cyan">{model}</Text></Text>
                <Text>  Mode:  <Text color={modeColor}>{mode}</Text></Text>
                <Text>  Dir:   <Text dimColor>{dir}</Text></Text>
                <Text>  Shell: <Text dimColor>{shell}</Text></Text>
            </Box>
            {projectInfo && (
                <Text dimColor>  {projectInfo}</Text>
            )}
        </Box>
    );
}
